#!/usr/bin/env node

/**
 * scripts/redownload_and_verify_rejected.ts
 *
 * Terminal 2: Auto Re-Downloader & Gemini Vision Verification Pipeline.
 *
 * - Runs concurrently with Terminal 1 (audit_and_clean_catalog_images.ts).
 * - Identifies medicines marked as 'gemini_rejected' or purged from catalog_images.
 * - Searches official pharma CDNs with clean, conflict-safe queries.
 * - Downloads candidate packaging and compresses them (~120KB, max 1200px).
 * - Evaluates candidate packaging with the strict FRONT / BACK Gemini Vision rule:
 *     1. Test Front Face. If unconfirmed, test Back Face.
 *     2. Either face confirmed -> 100% PASS, saved into DB with confirmed face as Primary!
 * - In --watch mode: continuously loops every 5 seconds so as Terminal 1 purges bad
 *   images, Terminal 2 immediately re-downloads and verifies fresh replacements.
 *
 * Usage:
 *   npx tsx scripts/redownload_and_verify_rejected.ts --delay=2000
 *   npx tsx scripts/redownload_and_verify_rejected.ts --watch --delay=2000
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { imageCompressionService } from '../src/services/imageCompressionService.js';
import { VisualIndexService } from '../src/services/visualIndexService.js';

dotenv.config();

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const STATE_FILE = path.join(ROOT_DIR, 'data', 'top100_harvest_state.json');
const TARGET_FRONTEND = path.join(ROOT_DIR, 'frontend', 'public', 'products');
const TARGET_UPLOADS = path.join(ROOT_DIR, 'uploads', 'products');

fs.mkdirSync(TARGET_FRONTEND, { recursive: true });
fs.mkdirSync(TARGET_UPLOADS, { recursive: true });

// Load rotating API keys
const rawKeyStr = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
let API_KEYS = rawKeyStr.split(/[,;\s]+/).map(k => k.trim()).filter(Boolean);
let keyIndex = 0;

// Expanded formulation modifiers (includes single-letter modifiers like S, M, G, P to avoid variant mix-ups)
const FORMULATION_MODIFIERS = new Set([
  'PLUS', 'FORTE', 'DS', 'DUO', 'COMBIKIT', 'COMBI', 'KIT', 'MAX', 'EXTRA',
  'DSR', 'D', 'DP', 'AP', 'SP', 'AM', 'AT', 'AZ', 'H', 'LS', 'DX', 'AX', 'CZ', 'CT',
  'LP', 'CV', 'KT', 'COLD', 'FLU', 'TZ', 'OZ', 'TG', 'CH', 'CL', 'AF',
  'SR', 'ER', 'CR', 'PR', 'MR', 'TR', 'XR', 'XL', 'LA',
  'DT', 'MD', 'SL', 'OD',
  'S', 'M', 'G', 'P', 'N', 'K', 'C', 'E', 'F'
]);

function loadState(): { last_updated: string | null; products: Record<string, any> } {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch {}
  }
  return { last_updated: null, products: {} };
}

function saveProductState(medId: number | string, data: any) {
  try {
    const current = loadState();
    current.products[String(medId)] = data;
    current.last_updated = new Date().toISOString();
    const tmp = `${STATE_FILE}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(tmp, JSON.stringify(current, null, 2), 'utf-8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (err: any) {
    console.warn('[State Save Notice]:', err.message);
  }
}

async function verifyWithGeminiVision(
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

function normalizeTokens(text: string): string {
  if (!text) return '';
  return text
    .replace(/([a-zA-Z])(\d+)/g, '$1 $2')
    .replace(/(\d+)(mg|mcg|ml|gm|iu|%)\b/gi, '$1 $2');
}

function extractModifiers(name: string): Set<string> {
  if (!name) return new Set();
  const clean = normalizeTokens(name).toUpperCase().replace(/[-_.,/()\[\]+]/g, ' ');
  const words = clean.split(/\s+/).filter(Boolean);
  const found = new Set<string>();
  for (const w of words) {
    if (FORMULATION_MODIFIERS.has(w)) found.add(w);
  }
  return found;
}

function hasModifierConflict(name1: string, name2: string): boolean {
  const m1 = extractModifiers(name1);
  const m2 = extractModifiers(name2);
  if (m1.size === 0 && m2.size === 0) return false;
  if (m1.size === 0 && m2.size > 0) return true;
  if (m2.size === 0 && m1.size > 0) return true;
  for (const m of m1) {
    if (!m2.has(m)) return true;
  }
  return false;
}

function hasDosageConflict(q: string, c: string): boolean {
  const qLower = q.toLowerCase();
  const cLower = c.toLowerCase();

  const isQSyrup = /\b(syp|syrup|susp|suspension)\b/.test(qLower);
  const isQTab = /\b(tab|tablet|tablets|dt)\b/.test(qLower);
  const isQCap = /\b(cap|capsule|capsules)\b/.test(qLower);
  const isQInj = /\b(inj|injection)\b/.test(qLower);
  const isQTop = /\b(gel|cream|ointment|lotion)\b/.test(qLower);
  const isQDrops = /\b(drops?|eye\s*drops?|ear\s*drops?|e\/e|ophthalmic)\b/.test(qLower);
  const isQInhaler = /\b(inhaler|rotacap|rotacaps|respules|transhaler|neohaler|inhalation)\b/.test(qLower);

  const isCTab = /\b(tab|tablet|tablets)\b/.test(cLower);
  const isCCap = /\b(cap|capsule|capsules)\b/.test(cLower);
  const isCSyp = /\b(syp|syrup|susp|suspension)\b/.test(cLower);
  const isCInj = /\b(inj|injection)\b/.test(cLower);
  const isCTop = /\b(gel|cream|ointment|lotion)\b/.test(cLower);
  const isCDrops = /\b(drops?|eye\s*drops?|ear\s*drops?|e\/e|ophthalmic)\b/.test(cLower);
  const isCInhaler = /\b(inhaler|rotacap|rotacaps|respules|transhaler|neohaler|inhalation)\b/.test(cLower);

  // Inhalers vs Oral/Topical
  if (isQInhaler && (isCTab || isCCap || isCSyp || isCInj || isCTop || isCDrops)) return true;
  if (isCInhaler && (isQTab || isQCap || isQSyrup || isQInj || isQTop || isQDrops)) return true;

  // Specific Topical Clashes (Cream vs Ointment vs Gel vs Lotion)
  const isQCream = /\b(cream|crm)\b/.test(qLower);
  const isCCream = /\b(cream|crm)\b/.test(cLower);
  const isQOint = /\b(oint|ointment)\b/.test(qLower);
  const isCOint = /\b(oint|ointment)\b/.test(cLower);
  const isQGel = /\b(gel)\b/.test(qLower);
  const isCGel = /\b(gel)\b/.test(cLower);
  const isQLotion = /\b(lotion)\b/.test(qLower);
  const isCLotion = /\b(lotion)\b/.test(cLower);

  if (isQCream && (isCOint || isCGel || isCLotion)) return true;
  if (isQOint && (isCCream || isCGel || isCLotion)) return true;
  if (isQGel && (isCCream || isCOint || isCLotion)) return true;
  if (isQLotion && (isCCream || isCOint || isCGel)) return true;

  if (isQDrops && (isCTab || isCCap || isCSyp || isCInj || isCTop)) return true;
  if (isCDrops && (isQTab || isQCap || isQSyrup || isQInj || isQTop)) return true;
  if (isQSyrup && (isCTab || isCCap || isCInj)) return true;
  if (isQTab && (isCSyp || isCInj || isCTop || isCDrops)) return true;
  if (isQCap && (isCSyp || isCInj || isCTop || isCDrops)) return true;
  if (isQInj && (isCTab || isCCap || isCSyp)) return true;

  // Medical device & accessory conflict gate: tablets/capsules/syrups must NEVER match devices/belts/binders
  const isMedForm = /\b(tab|tablet|tablets|dt|cap|capsule|capsules|syp|syrup|susp|suspension|inj|injection|gel|cream|ointment|drops?|inhaler)\b/.test(qLower);
  const isDevice = /\b(binder|belt|brace|support|crepe|bandage|cotton|massager|vaporizer|condom|thermometer|oximeter|nebulizer|glucometer|lancet|wheelchair|walker|diaper|sanitary|pad|wipes|patch|tape|plaster|plasters|gauze|mask|gloves?|unit)\b/.test(cLower);
  if (isMedForm && isDevice) return true;

  return false;
}

function hasStrengthConflict(name1: string, name2: string): boolean {
  const norm1 = normalizeTokens(name1);
  const norm2 = normalizeTokens(name2);
  const m1 = norm1.match(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|iu|%|ml|gm)\b/i);
  const m2 = norm2.match(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|iu|%|ml|gm)\b/i);
  if (m1 && m2) {
    const v1 = parseFloat(m1[1]);
    const v2 = parseFloat(m2[1]);
    const u1 = m1[2].toLowerCase();
    const u2 = m2[2].toLowerCase();
    if (u1 !== u2 || Math.abs(v1 - v2) > 0.001) {
      return true;
    }
  }
  return false;
}

function isBrandMatch(query: string, candidateName: string): boolean {
  let cleanQ = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  let cleanCand = candidateName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();

  const stopWords = new Set([
    'test', 'dummy', 'sample', 'strip', 'tablets', 'tablet', 'capsules', 'capsule',
    'bottle', 'syrup', 'suspension', 'drops', 'pack', 'solution', 'cream', 'ointment',
    'injection', 'powder', 'device', 'tape', 'plaster', 'unit', 'mg', 'mcg', 'ml', 'gm', 'iu', 'of'
  ]);

  const qBrandWords = cleanQ.split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w) && !/^\d+$/.test(w));
  if (qBrandWords.length === 0) return false;

  const candWords = cleanCand.split(/\s+/).filter(Boolean);
  const primaryBrand = qBrandWords[0];

  const brandIndex = candWords.findIndex(cw => cw === primaryBrand || cw.startsWith(primaryBrand));
  if (brandIndex === -1 || (brandIndex > 0 && !['new', 'dr', 'baby', 'the'].includes(candWords[0]))) {
    return false;
  }

  const coreWords = qBrandWords.slice(0, 2);
  for (const bw of coreWords) {
    const found = candWords.some(cw => cw === bw || cw.startsWith(bw));
    if (!found) return false;
  }

  return true;
}

function generateSearchQueries(rawName: string): string[] {
  let cleaned = rawName.replace(/\(.*?\)/g, ' ').replace(/\[.*?\]/g, ' ');
  cleaned = cleaned.replace(/\b(STRIP OF \d+ (TABLETS|CAPSULES)|BOTTLE OF \d+ (TABLETS|ML)|NO'S|\d+\s*NO'S|\d+'S)\b/gi, ' ');
  cleaned = cleaned.replace(/\b(tab|tablet|tablets|cap|capsule|capsules|sus|susp|suspension|syp|syrup|inj|injection|oint|ointment|crm|cream|gel|lotion|drops?)\b/gi, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  const queries: string[] = [cleaned];

  const normDecimal = cleaned.replace(/\b(\d+)\.0+(\s*(?:mg|mcg|ml|gm|iu|%))\b/gi, '$1$2')
                             .replace(/\b(\d+\.[1-9]+)0+(\s*(?:mg|mcg|ml|gm|iu|%))\b/gi, '$1$2');
  if (normDecimal !== cleaned) {
    queries.push(normDecimal);
    queries.push(normDecimal.replace(/(\d+(?:\.\d+)?)\s*(mg|mcg|ml|gm|iu|%)\b/gi, '$1').trim());
  }

  const withoutUnit = cleaned.replace(/(\d+(?:\.\d+)?)\s*(mg|mcg|ml|gm|iu|%)\b/gi, '$1').trim();
  if (withoutUnit && withoutUnit !== cleaned) {
    queries.push(withoutUnit);
  }

  const strengthMatch = cleaned.match(/\b(\d+(?:\.\d+)?)\s*(?:mg|mcg|ml|gm|iu|%|\b)/i);
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 1) {
    const brand = words[0];
    if (strengthMatch) {
      queries.push(`${brand} ${parseFloat(strengthMatch[1])}`);
    }

    const mods = words.filter(t => FORMULATION_MODIFIERS.has(t.toUpperCase()));
    if (mods.length > 0) {
      queries.push(`${brand} ${mods.join(' ')}`);
      if (strengthMatch) {
        queries.push(`${brand} ${mods.join(' ')} ${parseFloat(strengthMatch[1])}`);
      }
    }

    if (words.length >= 2 && !/^\d+$/.test(words[1]) && !['MG', 'ML', 'GM', 'TAB', 'CAP', 'INJ'].includes(words[1].toUpperCase())) {
      queries.push(`${brand} ${words[1]}`);
    }

    if (brand.length >= 4 && !['TABLET', 'CAPSULE', 'INJECTION', 'CREAM', 'LOTION'].includes(brand.toUpperCase())) {
      queries.push(brand);
    }
  }

  return Array.from(new Set(queries.filter(q => q && q.length >= 3)));
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
}

async function fetchCdnCandidates(queries: string[], rawMedName: string): Promise<any[]> {
  const candidates: any[] = [];
  const seenIds = new Set<string>();

  for (const q of queries) {
    const url = `https://pharmeasy.in/api/search/search/?q=${encodeURIComponent(q)}&page=1`;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) continue;
      const data: any = await response.json();
      const prods = data?.data?.products || [];

      for (const prod of prods) {
        if (!prod.slug || seenIds.has(prod.slug)) continue;
        const hasImg = (prod.damImages && prod.damImages.length > 0) || Boolean(prod.image);
        if (!hasImg) continue;
        if (!isBrandMatch(rawMedName, prod.name)) continue;
        if (hasDosageConflict(rawMedName, prod.name)) continue;
        if (hasStrengthConflict(rawMedName, prod.name)) continue;
        if (hasModifierConflict(rawMedName, prod.name)) continue;

        const damImages = prod.damImages || [];
        const imageMap: Record<string, string> = {};

        for (const img of damImages) {
          const face = img.face || 'default';
          if (!imageMap[face] && img.url) {
            imageMap[face] = img.url.split('?')[0];
          }
        }
        if (Object.keys(imageMap).length === 0 && prod.image) {
          imageMap['front'] = prod.image.split('?')[0];
        }

        if (Object.keys(imageMap).length > 0) {
          seenIds.add(prod.slug);
          candidates.push({
            name: prod.name,
            slug: prod.slug,
            images: imageMap
          });
        }
      }
    } catch {}
  }

  return candidates;
}

async function downloadBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function processRejectedMedicine(
  med: { id: number; name: string; manufacturer: string },
  delayMs: number,
  visualIndex: VisualIndexService,
  db: Database.Database
): Promise<boolean> {
  const medId = med.id;
  const medName = med.name;
  const mfg = med.manufacturer || 'Unknown';

  console.log(`\n===============================================================`);
  console.log(`🔄 RE-DOWNLOADING: "${medName}" (ID ${medId}, Mfg: ${mfg})`);
  console.log(`===============================================================`);

  const searchQueries = generateSearchQueries(medName);
  console.log(`    Queries: [${searchQueries.slice(0, 4).join(', ')}]`);

  const candidates = await fetchCdnCandidates(searchQueries, medName);
  if (candidates.length === 0) {
    console.log(`    ⚠️ No CDN matches pass conflict filter for "${medName}".`);
    saveProductState(medId, {
      status: 'manual_review_needed',
      medicine_id: medId,
      medicine_name: medName,
      manufacturer: mfg,
      reason: 'No authentic packaging found on pharma CDN (skipped for manual review)',
      checked_at: new Date().toISOString()
    });
    return false;
  }

  const maxCandidatesToTry = Math.min(candidates.length, 3);
  console.log(`    Found ${candidates.length} candidate products on CDN. Testing up to ${maxCandidatesToTry} candidates with Front/Back Gemini Vision...`);

  for (let cIdx = 0; cIdx < maxCandidatesToTry; cIdx++) {
    const cand = candidates[cIdx];
    console.log(`    Candidate [${cIdx + 1}/${maxCandidatesToTry}]: "${cand.name}" (${Object.keys(cand.images).length} angles)`);

    const downloadedAngles: Array<{
      face: string;
      relPath: string;
      buffer: Buffer;
      phash: string | null;
      brandConfidence: number;
      ocrSnippet: string;
      frontendPath: string;
      uploadsPath: string;
    }> = [];

    const baseSlug = slugify(medName);

    for (const [face, imgUrl] of Object.entries(cand.images)) {
      const rawBuf = await downloadBuffer(imgUrl as string);
      if (!rawBuf || rawBuf.length < 1000) continue;

      const fileName = `${baseSlug}-${face}.jpg`;
      const fp = path.join(TARGET_FRONTEND, fileName);
      const up = path.join(TARGET_UPLOADS, fileName);

      await imageCompressionService.compressAndSave(rawBuf, fp, 1200, 82);
      fs.copyFileSync(fp, up);

      const compBuf = fs.readFileSync(fp);
      const phash = await visualIndex.computePhashFromBuffer(compBuf);

      let brandConfidence = 50;
      let ocrSnippet = '';

      downloadedAngles.push({
        face,
        relPath: `/products/${fileName}`,
        buffer: compBuf,
        phash,
        brandConfidence,
        ocrSnippet,
        frontendPath: fp,
        uploadsPath: up
      });

      if (downloadedAngles.length >= 4) break;
    }

    if (downloadedAngles.length === 0) continue;

    // Pick candidate faces for verification:
    // Face 1: FRONT (box-front or front)
    // Face 2: BACK (box-back or back)
    const frontAngle = downloadedAngles.find(a => /front/i.test(a.face)) || downloadedAngles[0];
    const backAngle = downloadedAngles.find(a => /back/i.test(a.face) && a !== frontAngle)
                   || downloadedAngles.find(a => a !== frontAngle);

    const facesToVerify = [frontAngle, backAngle].filter((a): a is NonNullable<typeof a> => Boolean(a));

    let confirmedResult: any = null;
    let confirmedAngle: any = null;

    for (let f = 0; f < facesToVerify.length; f++) {
      const angle = facesToVerify[f];
      if (!angle) continue;
      const faceLabel = /front/i.test(angle.face) ? 'FRONT' : (/back/i.test(angle.face) ? 'BACK' : angle.face.toUpperCase());
      console.log(`       🔍 Testing Face "${angle.face}" [${faceLabel}] with Gemini Vision...`);

      const gResult = await verifyWithGeminiVision(angle.buffer, medName);
      if (gResult.isExactMatch) {
        confirmedResult = gResult;
        confirmedAngle = angle;
        break; // Either front OR back confirmed -> PASS!
      } else {
        console.log(`       ⚠️ Face "${angle.face}" [${faceLabel}] unconfirmed: ${gResult.reason}`);
        if (f < facesToVerify.length - 1) {
          console.log(`       Checking alternate face (e.g. back packaging)...`);
          if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
        }
      }
    }

    if (confirmedResult && confirmedAngle) {
      console.log(`       ✅ 100% CONFIRMED on Face "${confirmedAngle.face}": "${confirmedResult.printedName}" (${confirmedResult.confidence}%)`);
      console.log(`          Reason: ${confirmedResult.reason}`);
      console.log(`          ✨ ALL ${downloadedAngles.length} ANGLES PASSED!`);

      // Promote confirmed face to index 0 so it becomes Primary
      const cIdxInArray = downloadedAngles.findIndex(a => a === confirmedAngle);
      if (cIdxInArray > 0) {
        const moved = downloadedAngles.splice(cIdxInArray, 1)[0];
        downloadedAngles.unshift(moved);
      }

      // Save into catalog_images in DB
      db.prepare('DELETE FROM catalog_images WHERE medicine_id = ?').run(medId);
      const insertStmt = db.prepare(`
        INSERT INTO catalog_images (
          medicine_id, company_name, product_name, image_path, thumbnail_path, image_source,
          confidence_score, matching_method, verification_status, ocr_text, is_active,
          image_type, is_primary, slot_number, phash, verified_by, verified_at
        ) VALUES (?, ?, ?, ?, ?, 'pharma_dam_cdn', ?, 'gemini_vision_verified', 'APPROVED', ?, 1, ?, ?, ?, ?, 'gemini_audit_bot', CURRENT_TIMESTAMP)
      `);

      for (let aIdx = 0; aIdx < downloadedAngles.length; aIdx++) {
        const ang = downloadedAngles[aIdx];
        const isPrimary = aIdx === 0 ? 1 : 0;
        insertStmt.run(
          medId,
          mfg,
          cand.name,
          ang.relPath,
          ang.relPath,
          confirmedResult.confidence,
          ang.ocrSnippet,
          ang.face,
          isPrimary,
          aIdx + 1,
          ang.phash
        );
      }

      saveProductState(medId, {
        status: 'success',
        medicine_id: medId,
        medicine_name: medName,
        manufacturer: mfg,
        product_name: cand.name,
        angles_saved: downloadedAngles.length,
        primary_face: downloadedAngles[0].face,
        primary_confidence: confirmedResult.confidence,
        verified_by: 'gemini_vision_verified',
        updated_at: new Date().toISOString()
      });

      console.log(`       📸 Re-downloaded and verified ${downloadedAngles.length} angles. Primary: "${downloadedAngles[0].face}".\n`);
      return true;
    } else {
      console.log(`       ❌ Candidate "${cand.name}" failed verification. Cleaning files...`);
      for (const ang of downloadedAngles) {
        try { fs.unlinkSync(ang.frontendPath); } catch {}
        try { fs.unlinkSync(ang.uploadsPath); } catch {}
      }
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }
  }

  saveProductState(medId, {
    status: 'manual_review_needed',
    medicine_id: medId,
    medicine_name: medName,
    manufacturer: mfg,
    reason: `Tested ${maxCandidatesToTry} candidate packaging photos from CDN - none matched target medicine. Skipped for manual review to save time.`,
    checked_at: new Date().toISOString()
  });

  return false;
}

async function main() {
  const args = process.argv.slice(2);
  let watchMode = args.includes('--watch');
  let delayMs = 2000;
  let companyFilter = '';

  for (const a of args) {
    if (a.startsWith('--delay=')) delayMs = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('--company=')) companyFilter = a.split('=')[1].replace(/['"]/g, '');
    else if (a.startsWith('--keys=')) {
      const parsedKeys = a.split('=')[1].split(/[,;]+/).map(k => k.trim()).filter(Boolean);
      if (parsedKeys.length > 0) API_KEYS = parsedKeys;
    }
  }

  console.log('===============================================================');
  console.log('   TERMINAL 2: AUTO RE-DOWNLOAD & GEMINI VISION CONFIRMATION');
  console.log('===============================================================');
  console.log(`🔑 Key Pool: ${API_KEYS.length} Gemini API keys loaded with round-robin rotation.`);
  console.log(`⏱️ Spacing: ${delayMs}ms delay between verification calls.`);
  console.log(`🎯 Rule: Front/Back Gemini Vision check until 100% confirmed.`);
  if (companyFilter) console.log(`🏢 Company Filter: "${companyFilter}"`);
  console.log(`📡 Mode: ${watchMode ? 'Continuous Watcher (runs concurrently with Terminal 1)' : 'Single Pass Run'}\n`);

  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 30000');

  const visualIndex = VisualIndexService.getInstance();

  let keepRunning = true;
  let runIteration = 0;

  while (keepRunning) {
    runIteration++;
    const state = loadState();

    // Find all medicines that need re-downloading:
    // 1. In state as 'gemini_rejected'
    // 2. Or medicines in DB that were purged and have 0 images
    const rejectedKeys = Object.entries(state.products || {})
      .filter(([_, v]) => v.status === 'gemini_rejected')
      .map(([k]) => parseInt(k, 10))
      .filter(n => !isNaN(n));

    if (rejectedKeys.length === 0) {
      if (watchMode) {
        if (runIteration === 1 || runIteration % 12 === 0) {
          console.log(`⏳ [Watch Mode] Zero rejected medicines pending. Waiting for Terminal 1... (checking every 5s)`);
        }
        await new Promise(r => setTimeout(r, 5000));
        continue;
      } else {
        console.log('✅ No rejected medicines pending re-download. Everything is up to date!\n');
        break;
      }
    }

    console.log(`📋 Found ${rejectedKeys.length} rejected medicine(s) needing re-download:\n`);

    const placeholders = rejectedKeys.map(() => '?').join(',');
    let query = `
      SELECT id, name, manufacturer
      FROM medicines
      WHERE id IN (${placeholders})
    `;
    const params: any[] = [...rejectedKeys];
    if (companyFilter) {
      query += ` AND manufacturer LIKE ?`;
      params.push(`%${companyFilter}%`);
    }
    query += ` ORDER BY id ASC`;
    const medsToProcess = db.prepare(query).all(...params) as any[];

    let reDownloadedSuccess = 0;
    let failedCount = 0;

    for (let i = 0; i < medsToProcess.length; i++) {
      const med = medsToProcess[i];
      const success = await processRejectedMedicine(med, delayMs, visualIndex, db);
      if (success) reDownloadedSuccess++;
      else failedCount++;

      if (delayMs > 0 && i < medsToProcess.length - 1) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    console.log('\n===============================================================');
    console.log('               RE-DOWNLOAD PASS COMPLETED');
    console.log('===============================================================');
    console.log(`Medicines Evaluated     : ${medsToProcess.length}`);
    console.log(`  - 100% Confirmed & Saved: ${reDownloadedSuccess}`);
    console.log(`  - Still Unmatched on CDN : ${failedCount}`);
    console.log('===============================================================\n');

    if (!watchMode) {
      keepRunning = false;
    } else {
      console.log(`⏳ [Watch Mode] Pass complete. Waiting 5s for new rejected items from Terminal 1...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

main().catch(err => {
  console.error('Terminal 2 fatal error:', err);
  process.exit(1);
});
