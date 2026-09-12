#!/usr/bin/env node

/**
 * scripts/audit_and_clean_catalog_images.ts
 *
 * Dedicated AI Packaging Audit & Purge Tool:
 * Rule: Check front or back. Some medicines have the name on the front (carton/bottle),
 * some have the name printed on the back foil (blister strips).
 * Either front OR back confirmed by Gemini Vision -> Entire product packaging PASSES!
 * The confirmed face is automatically set as Primary (is_primary = 1).
 * Only if NEITHER front nor back matches is the product packaging purged.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

dotenv.config();

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const STATE_FILE = path.join(ROOT_DIR, 'data', 'top100_harvest_state.json');
const TARGET_FRONTEND = path.join(ROOT_DIR, 'frontend', 'public', 'products');
const TARGET_UPLOADS = path.join(ROOT_DIR, 'uploads', 'products');

// Load API key pool
const rawKeyStr = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
let API_KEYS = rawKeyStr.split(/[,;\s]+/).map(k => k.trim()).filter(Boolean);

let keyIndex = 0;

async function verifyWithGemini(
  imgBuffer: Buffer,
  targetName: string
): Promise<{ isExactMatch: boolean; printedName: string; confidence: number; reason: string }> {
  const base64Data = imgBuffer.toString('base64');
  const prompt = `You are a strict pharmaceutical verification AI.
Examine this medicine packaging photo.
Target Medicine to Verify: "${targetName}"

Tasks:
1. Read the printed brand name and active strength from the packaging photo.
2. Confirm if this image genuinely depicts the target medicine brand.
3. Pack quantity differences (e.g. 10 tablets vs 15 tablets of the same brand and strength) ARE ALLOWED and count as a match (is_exact_match: true).
4. If the image is for a DIFFERENT drug brand, a medical device, or has a conflicting strength/formulation, mark is_exact_match: false.

Return valid JSON with:
{
  "is_exact_match": boolean,
  "printed_name": string,
  "printed_strength": string,
  "confidence": number (0-100),
  "reason": string
}`;

  const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];

  for (const model of models) {
    for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
      const activeKey = API_KEYS[(keyIndex + attempt) % API_KEYS.length];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeKey}`;
      const payload = {
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: base64Data } }
          ]
        }],
        generationConfig: { responseMimeType: 'application/json' }
      };

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20000)
        });

        if (res.status === 503 || res.status === 429) {
          if (API_KEYS.length > 1) {
            console.log(`    ⏳ Gemini ${model} returned ${res.status} on Key #${(keyIndex + attempt) % API_KEYS.length + 1}, rotating key...`);
          }
          keyIndex = (keyIndex + 1) % API_KEYS.length;
          continue;
        }

        if (!res.ok) continue;

        const data: any = await res.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) continue;

        const parsed = JSON.parse(rawText);
        keyIndex = (keyIndex + attempt + 1) % API_KEYS.length;

        return {
          isExactMatch: Boolean(parsed.is_exact_match),
          printedName: parsed.printed_name || '',
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 90,
          reason: parsed.reason || ''
        };
      } catch {
        continue;
      }
    }
  }

  return { isExactMatch: false, printedName: '', confidence: 0, reason: 'Gemini service unreachable' };
}

function loadHarvestState(): { last_updated: string | null; products: Record<string, any> } {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch {}
  }
  return { last_updated: null, products: {} };
}

function saveHarvestState(entryMedId?: number | string, entryData?: any) {
  try {
    const current = loadHarvestState();
    if (entryMedId !== undefined && entryData !== undefined) {
      current.products[String(entryMedId)] = entryData;
    }
    current.last_updated = new Date().toISOString();
    const tmp = `${STATE_FILE}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(tmp, JSON.stringify(current, null, 2), 'utf-8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (err: any) {
    console.warn('[State Save Notice]:', err.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  let auditAll = args.includes('--all');
  let force = args.includes('--force');
  let limit = 0;
  let delayMs = 1000; // 1 second spacing between requests
  let companyFilter = '';

  for (const a of args) {
    if (a.startsWith('--limit=')) limit = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('--delay=')) delayMs = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('--company=')) companyFilter = a.split('=')[1].replace(/['"]/g, '');
    else if (a.startsWith('--keys=')) {
      const parsedKeys = a.split('=')[1].split(/[,;]+/).map(k => k.trim()).filter(Boolean);
      if (parsedKeys.length > 0) API_KEYS = parsedKeys;
    }
  }

  console.log('===============================================================');
  console.log('   CATALOG IMAGE AUDIT: FRONT / BACK CONFIRMATION RULE');
  console.log('===============================================================');
  console.log(`🔑 Key Pool: ${API_KEYS.length} Gemini API keys loaded with round-robin rotation.`);
  console.log(`⏱️ Spacing: ${delayMs}ms delay between verification calls.`);
  console.log(`🎯 Rule: Either Front OR Back confirmed -> Entire product passes!`);
  if (companyFilter) console.log(`🏢 Company Filter: "${companyFilter}"`);
  console.log(`🎯 Scope: ${auditAll ? (force ? 'All catalog medicines (force recheck)' : 'All pending un-audited catalog medicines') : 'Medicines with OCR fallback images'}\n`);

  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 30000');

  let query = `
    SELECT DISTINCT ci.medicine_id, m.name as med_name, m.manufacturer as med_mfg
    FROM catalog_images ci
    JOIN medicines m ON m.id = ci.medicine_id
  `;

  if (auditAll) {
    if (!force) {
      query += " WHERE (ci.verified_by IS NULL OR ci.verified_by != 'gemini_audit_bot')";
    }
  } else {
    query += " WHERE ci.matching_method = 'ai_ocr_verified'";
  }

  if (companyFilter) {
    query += query.includes('WHERE') ? " AND" : " WHERE";
    query += ` m.manufacturer LIKE '%${companyFilter.replace(/'/g, "''")}%'`;
  }

  query += " ORDER BY ci.medicine_id ASC";

  if (limit > 0) {
    query += ` LIMIT ${limit}`;
  }

  const distinctMeds = db.prepare(query).all() as any[];
  console.log(`Found ${distinctMeds.length} distinct medicines to evaluate.\n`);

  if (distinctMeds.length === 0) {
    console.log('✅ No medicines require auditing. All catalog images are verified!\n');
    return;
  }

  let auditedMedsCount = 0;
  let confirmedMedsCount = 0;
  let purgedMedsCount = 0;
  let totalAuditedCalls = 0;

  const updateStmt = db.prepare(`
    UPDATE catalog_images
    SET matching_method = 'gemini_vision_verified',
        confidence_score = ?,
        verification_status = 'VERIFIED',
        verification_reason = ?,
        is_primary = ?,
        verified_by = 'gemini_audit_bot',
        verified_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const deleteStmt = db.prepare(`
    DELETE FROM catalog_images WHERE id = ?
  `);

  for (let i = 0; i < distinctMeds.length; i++) {
    const med = distinctMeds[i];
    const medId = med.medicine_id;
    const medName = med.med_name;

    const imgRows = db.prepare(`
      SELECT * FROM catalog_images WHERE medicine_id = ? ORDER BY is_primary DESC, id ASC
    `).all(medId) as any[];

    if (imgRows.length === 0) continue;

    auditedMedsCount++;
    console.log(`[${i + 1}/${distinctMeds.length}] Medicine: "${medName}" (ID ${medId}, ${imgRows.length} angles stored)`);

    // Strictly scan ONLY Front and Back faces:
    // 1. FRONT Candidate (carton front, bottle front, or primary)
    // 2. BACK Candidate (foil back, carton back, composition)
    const frontCand = imgRows.find(r => /front/i.test(r.image_type)) || imgRows.find(r => r.is_primary) || imgRows[0];
    const backCand = imgRows.find(r => /back/i.test(r.image_type) && r.id !== frontCand?.id)
                  || imgRows.find(r => r.id !== frontCand?.id);

    const candidatesToTest = [frontCand, backCand].filter((c): c is NonNullable<typeof c> => Boolean(c));

    let confirmedResult: any = null;
    let confirmedRow: any = null;

    // Test up to 2 key faces: Front first, and if unconfirmed, Back
    for (let t = 0; t < candidatesToTest.length; t++) {
      const cand = candidatesToTest[t];
      if (!cand) continue;
      const fileName = path.basename(cand.image_path);
      const p1 = path.join(TARGET_FRONTEND, fileName);
      const p2 = path.join(TARGET_UPLOADS, fileName);
      let imgBuf: Buffer | null = null;
      if (fs.existsSync(p1)) imgBuf = fs.readFileSync(p1);
      else if (fs.existsSync(p2)) imgBuf = fs.readFileSync(p2);

      if (!imgBuf || imgBuf.length < 500) continue;

      totalAuditedCalls++;
      const faceLabel = /front/i.test(cand.image_type) ? 'FRONT' : (/back/i.test(cand.image_type) ? 'BACK' : cand.image_type.toUpperCase());
      console.log(`    🔍 Testing Face "${cand.image_type}" [${faceLabel}] with Gemini Vision...`);
      const res = await verifyWithGemini(imgBuf, medName);

      if (res.isExactMatch) {
        confirmedResult = res;
        confirmedRow = cand;
        break; // Either front OR back confirmed -> Entire product PASSES!
      } else {
        console.log(`    ⚠️ Face "${cand.image_type}" [${faceLabel}] not confirmed: ${res.reason}`);
        if (t < candidatesToTest.length - 1) {
          console.log(`    Checking alternate face (e.g. back foil packaging)...`);
          if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
        }
      }
    }

    if (confirmedResult && confirmedRow) {
      console.log(`    ✅ 100% CONFIRMED on Face "${confirmedRow.image_type}": "${confirmedResult.printedName}" (${confirmedResult.confidence}%)`);
      console.log(`       Reason: ${confirmedResult.reason}`);
      console.log(`       ✨ ALL ${imgRows.length} ANGLES PASSED! Setting "${confirmedRow.image_type}" as Primary.\n`);

      // Update all images for this medicine to verified, with confirmed face as Primary
      for (const row of imgRows) {
        const isPrimary = (row.id === confirmedRow.id) ? 1 : 0;
        updateStmt.run(confirmedResult.confidence, confirmedResult.reason, isPrimary, row.id);
      }
      confirmedMedsCount++;

      saveHarvestState(medId, {
        status: 'success',
        medicine_id: medId,
        medicine_name: medName,
        manufacturer: med.med_mfg,
        primary_face: confirmedRow.image_type,
        confidence: confirmedResult.confidence,
        verified_by: 'gemini_audit_bot',
        checked_at: new Date().toISOString()
      });
    } else {
      console.log(`    ❌ WRONG PACKAGING: Neither front nor back matched target "${medName}".`);
      console.log(`       🗑️ Purging all ${imgRows.length} angles from disk and database...\n`);

      for (const row of imgRows) {
        const fn = path.basename(row.image_path);
        try { fs.unlinkSync(path.join(TARGET_FRONTEND, fn)); } catch {}
        try { fs.unlinkSync(path.join(TARGET_UPLOADS, fn)); } catch {}
        deleteStmt.run(row.id);
      }

      saveHarvestState(medId, {
        status: 'gemini_rejected',
        medicine_id: medId,
        medicine_name: medName,
        manufacturer: med.med_mfg,
        reason: 'Neither front nor back matched medicine packaging',
        checked_at: new Date().toISOString()
      });
      purgedMedsCount++;
    }

    if (delayMs > 0 && i < distinctMeds.length - 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  const finalVerifiedCount = db.prepare("SELECT count(*) as c FROM catalog_images WHERE matching_method = 'gemini_vision_verified'").get() as any;
  const remainingOcrCount = db.prepare("SELECT count(*) as c FROM catalog_images WHERE matching_method = 'ai_ocr_verified'").get() as any;

  console.log('===============================================================');
  console.log('                    AUDIT COMPLETED');
  console.log('===============================================================');
  console.log(`Total Medicines Audited             : ${auditedMedsCount}`);
  console.log(`  - Confirmed & Passed (Front/Back) : ${confirmedMedsCount}`);
  console.log(`  - Wrong Packaging Purged & Deleted: ${purgedMedsCount}`);
  console.log(`Total Gemini API Calls Used         : ${totalAuditedCalls}`);
  console.log(`\nCurrent Database Status:`);
  console.log(`  - Total Gemini Verified in DB     : ${finalVerifiedCount.c}`);
  console.log(`  - Remaining OCR Fallback in DB    : ${remainingOcrCount.c}`);
  console.log('===============================================================\n');
}

main().catch(err => {
  console.error('Audit fatal error:', err);
  process.exit(1);
});
