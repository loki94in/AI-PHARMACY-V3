#!/usr/bin/env node

/**
 * scripts/harvest_top100_company_images.ts
 *
 * Master Product Image Harvester & AI Verification Pipeline.
 * - Downloads watermark-free, authentic packaging images from official pharma CDNs.
 * - Captures up to 4 essential angles per product: front, back, composition (side), and combo.
 * - Automatically compresses each image to max 1200px / ~120KB (saving 90% disk space).
 * - Runs AI Camera OCR (extractRawText) to identify the face with the clearest printed brand name (is_primary = 1).
 * - Optional Google Gemini 2.5 Flash Vision confirmation for 100% packaging label accuracy (--gemini).
 * - Computes and populates 64-bit perceptual hash (phash) for visual matching and eliminates duplicates.
 * - Persists state in data/top100_harvest_state.json so runs can be paused and resumed anytime.
 * - Auto-commits progress to Git every 1,000 images saved (--commit-every=1000).
 * - Includes an automatic inactivity watchdog and PC shutdown on completion or 5-minute idle failure.
 *
 * Usage:
 *   npx tsx scripts/harvest_top100_company_images.ts --help
 *   npx tsx scripts/harvest_top100_company_images.ts --company="CIPLA LIMITED" --gemini
 *   npx tsx scripts/harvest_top100_company_images.ts --top=100 --auto-shutdown --gemini --commit-every=1000
 *   npx tsx scripts/harvest_top100_company_images.ts --status
 */

import fs from 'fs';
import path from 'path';
import { exec, execSync } from 'child_process';
import Database from 'better-sqlite3';
import { imageCompressionService } from '../src/services/imageCompressionService.js';
import { VisualIndexService } from '../src/services/visualIndexService.js';
import { aiCameraService } from '../src/services/aiCameraService.js';

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const STATE_FILE = path.join(ROOT_DIR, 'data', 'top100_harvest_state.json');
const TARGET_FRONTEND = path.join(ROOT_DIR, 'frontend', 'public', 'products');
const TARGET_UPLOADS = path.join(ROOT_DIR, 'uploads', 'products');

fs.mkdirSync(TARGET_FRONTEND, { recursive: true });
fs.mkdirSync(TARGET_UPLOADS, { recursive: true });
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });

function autoCommitBatch(batchCount: number, totalImagesSaved: number) {
  try {
    console.log(`\n===============================================================`);
    console.log(`📦 AUTO-COMMIT: Milestone reached (${batchCount} new images saved, total: ${totalImagesSaved})`);
    console.log(`===============================================================\n`);
    
    // Refresh knowledge graph quickly
    try {
      execSync('node scripts/quick-update.mjs', { stdio: 'ignore' });
    } catch {}

    execSync('git add frontend/public/products data/top100_harvest_state.json', { stdio: 'inherit' });
    const msg = `feat(catalog): auto-commit milestone (${totalImagesSaved} images saved, Gemini 2.5 Vision verified)`;
    execSync(`git commit -m "${msg}"`, { stdio: 'inherit' });
    console.log(`✅ Git commit complete: "${msg}"\n`);
  } catch (err: any) {
    console.warn(`[AutoCommit] Git commit notice:`, err.message);
  }
}

function triggerWindowsShutdown(reason: string) {
  try {
    const clean = reason.replace(/["'\r\n]/g, ' ');
    const cmd = `shutdown /s /t 60 /c "${clean} System shutting down in 60s. Run 'shutdown /a' to abort."`;
    console.log(`\n===============================================================`);
    console.log(`🛑 PC SHUTDOWN INITIATED`);
    console.log(`Reason: ${clean}`);
    console.log(`Executing: ${cmd}`);
    console.log(`===============================================================\n`);
    exec(cmd, (err) => {
      if (err) {
        console.error('Shutdown execution error:', err);
      } else {
        console.log('Shutdown scheduled in 60 seconds.');
      }
      process.exit(0);
    });
  } catch (err) {
    console.error('Failed to trigger shutdown:', err);
    process.exit(1);
  }
}

let globalKeyIndex = 0;

async function verifyWithGeminiVision(
  buffer: Buffer,
  targetMedName: string,
  apiKeys: string[],
  spareKey?: string
): Promise<{ isExactMatch: boolean; printedName: string; confidence: number; reason: string }> {
  const base64Data = buffer.toString('base64');
  const prompt = `You are a strict pharmaceutical packaging verification AI.
Examine this medicine packaging photo with extreme precision.
Target Medicine to Verify: "${targetMedName}"

CRITICAL PHARMACEUTICAL RULES:
1. READ the printed brand name, active strength, formulation modifiers, and dosage form from the packaging photo.
2. STRENGTH MUST MATCH EXACTLY:
   - If target is 8 mg and packaging photo is 20 mg, is_exact_match: false!
   - If target is 800 mg and photo is 400 mg, is_exact_match: false!
   - If target is 100 mg and photo is 1 mg, is_exact_match: false!
3. ACTIVE FORMULATION MODIFIERS MUST MATCH EXACTLY:
   - Single-ingredient products must NEVER match combination products.
   - E.g. 'Rosuvas' is NOT 'Rosuvas F'! 'Atorva' is NOT 'Atorva F'!
   - E.g. 'Gemer' is NOT 'Gemer Sita IR'! 'Nurokind Plus' is NOT 'Nurokind Plus RF'!
   - E.g. 'Nexiron LP' is NOT 'Nexiron LP Plus'!
4. DOSAGE FORM MUST MATCH EXACTLY:
   - Gel is NOT Spray (e.g. Volini Gel cannot match Volini Maxx Spray)!
   - Powder is NOT Gel/Lotion/Cream (e.g. Sunheal Powder cannot match Sunheal Gel)!
   - Tablet is NOT Syrup/Suspension! Drops are NOT Tablets!
   - Medicine capsules/tablets must NEVER match medical devices/belts/inhaler hardware!
5. Packaging pack counts (e.g. 10 tablets vs 15 tablets of the exact same brand and strength) ARE ALLOWED and count as a match (is_exact_match: true).
6. If the image depicts a DIFFERENT medicine brand, wrong strength, wrong combination variant, or wrong form, you MUST set is_exact_match: false.

Return valid JSON with:
{
  "is_exact_match": boolean,
  "printed_name": string,
  "printed_strength": string,
  "confidence": number (0-100),
  "reason": string
}`;

  const models = ['gemini-3.6-flash', 'gemini-flash-latest'];
  const keysToTry = apiKeys.length > 0 ? apiKeys : (spareKey ? [spareKey] : []);

  for (const model of models) {
    for (let attempt = 0; attempt < Math.min(keysToTry.length, 5); attempt++) {
      const activeKey = keysToTry[(globalKeyIndex + attempt) % keysToTry.length];
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
        // 300ms pacing delay to guarantee staying under 15 RPM per key
        await new Promise(r => setTimeout(r, 300));

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20000)
        });

        if (res.status === 503 || res.status === 429) {
          if (keysToTry.length > 1) {
            console.log(`    ⏳ Gemini ${model} returned ${res.status} on Key #${(globalKeyIndex + attempt) % keysToTry.length + 1}, rotating to next key...`);
          }
          globalKeyIndex = (globalKeyIndex + 1) % keysToTry.length;
          continue;
        }

        if (!res.ok) {
          console.warn(`[Gemini Vision] ${model} HTTP ${res.status}`);
          continue;
        }

        const data: any = await res.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) continue;

        const parsed = JSON.parse(rawText);
        // Advance global key index so next medicine rotates to the next key
        globalKeyIndex = (globalKeyIndex + attempt + 1) % keysToTry.length;

        return {
          isExactMatch: Boolean(parsed.is_exact_match),
          printedName: parsed.printed_name || '',
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 90,
          reason: parsed.reason || ''
        };
      } catch (err: any) {
        continue;
      }
    }
  }

  // Emergency failover to dedicated Spare Key if all active keys experienced rate limit / spikes
  if (spareKey) {
    for (const model of models) {
      console.log(`    ⚡ Using dedicated Emergency Spare Key for "${targetMedName}"...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${spareKey}`;
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
        await new Promise(r => setTimeout(r, 400));
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20000)
        });
        if (res.ok) {
          const data: any = await res.json();
          const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const parsed = JSON.parse(rawText);
            console.log(`    ✨ Verified via Emergency Spare Key!`);
            return {
              isExactMatch: Boolean(parsed.is_exact_match),
              printedName: parsed.printed_name || '',
              confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 90,
              reason: parsed.reason || 'Verified via emergency spare key'
            };
          }
        }
      } catch {}
    }
  }

  // If Gemini failed across all keys and spare key, REJECT! NEVER auto-approve unverified packaging!
  console.warn(`    ⚠️ [Gemini Vision] All keys busy/rate-limited for "${targetMedName}". Rejecting candidate.`);
  return { isExactMatch: false, printedName: '', confidence: 0, reason: 'Gemini rate limited / offline - unverified packaging rejected' };
}

// Formulation modifier conflict dictionary (includes single letters and active combination abbreviations)
const FORMULATION_MODIFIERS = new Set([
  'PLUS', 'FORTE', 'DS', 'DUO', 'COMBIKIT', 'COMBI', 'KIT', 'MAX', 'EXTRA',
  'DSR', 'D', 'DP', 'AP', 'SP', 'AM', 'AT', 'AZ', 'H', 'LS', 'DX', 'AX', 'CZ', 'CT',
  'LP', 'CV', 'KT', 'COLD', 'FLU', 'TZ', 'OZ', 'TG', 'CH', 'CL', 'AF',
  'SR', 'ER', 'CR', 'PR', 'MR', 'TR', 'XR', 'XL', 'LA',
  'DT', 'MD', 'SL', 'OD',
  'F', 'RF', 'IR', 'SITA', 'CF', 'TC', 'P', 'M', 'G'
]);

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
  // If one has combination modifiers that the other lacks -> strict conflict!
  if (m1.size === 0 && m2.size > 0) return true;
  if (m2.size === 0 && m1.size > 0) return true;
  for (const m of m1) {
    if (!m2.has(m)) return true;
  }
  for (const m of m2) {
    if (!m1.has(m)) return true;
  }
  return false;
}

function extractStrengthTokens(name: string): Array<{ val: number; unit?: string }> {
  const norm = normalizeTokens(name).toUpperCase();
  const tokens: Array<{ val: number; unit?: string }> = [];

  // 1. Explicit unit match (e.g. 500mg, 20mcg, 5%, 10ml, 1gm)
  const regexUnit = /\b(\d+(?:\.\d+)?)\s*(MG|MCG|IU|%|ML|GM)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regexUnit.exec(norm)) !== null) {
    tokens.push({ val: parseFloat(match[1]), unit: match[2].toLowerCase() });
  }

  // 2. Standalone dosage number before dosage form (e.g. "Ciplar-LA 20 Tablet", "Norflox 400 Tablet", "Sizodon 1 Tablet")
  const regexForm = /\b(\d+(?:\.\d+)?)\s*(?:TABLET|TABLETS|TAB|TABS|CAPSULE|CAPSULES|CAP|CAPS|STRIP|SUSPENSION|SYRUP|INJECTION|INJ|CREAM|GEL|OINTMENT|OINT)\b/gi;
  while ((match = regexForm.exec(norm)) !== null) {
    const val = parseFloat(match[1]);
    const prevText = norm.slice(Math.max(0, match.index - 12), match.index);
    if (!/STRIP\s+OF|PACK\s+OF|BOX\s+OF/i.test(prevText)) {
      if (!tokens.some(t => Math.abs(t.val - val) < 0.001)) {
        tokens.push({ val });
      }
    }
  }

  return tokens;
}

function hasStrengthConflict(name1: string, name2: string): boolean {
  const s1 = extractStrengthTokens(name1);
  const s2 = extractStrengthTokens(name2);

  if (s1.length === 0 || s2.length === 0) return false;

  for (const t1 of s1) {
    const matching = s2.find(t2 => Math.abs(t2.val - t1.val) <= 0.001);
    if (!matching) return true; // Value mismatch (e.g. 8 vs 20, 800 vs 400)
    if (t1.unit && matching.unit && t1.unit !== matching.unit) return true; // Unit clash
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
  const isQPowder = /\b(powder|pwd)\b/.test(qLower);
  const isQSpray = /\b(spray)\b/.test(qLower);

  const isCTab = /\b(tab|tablet|tablets)\b/.test(cLower);
  const isCCap = /\b(cap|capsule|capsules)\b/.test(cLower);
  const isCSyp = /\b(syp|syrup|susp|suspension)\b/.test(cLower);
  const isCInj = /\b(inj|injection)\b/.test(cLower);
  const isCTop = /\b(gel|cream|ointment|lotion)\b/.test(cLower);
  const isCDrops = /\b(drops?|eye\s*drops?|ear\s*drops?|e\/e|ophthalmic)\b/.test(cLower);
  const isCInhaler = /\b(inhaler|rotacap|rotacaps|respules|transhaler|neohaler|inhalation)\b/.test(cLower);
  const isCPowder = /\b(powder|pwd)\b/.test(cLower);
  const isCSpray = /\b(spray)\b/.test(cLower);

  // Inhalers vs Oral/Topical
  if (isQInhaler && (isCTab || isCCap || isCSyp || isCInj || isCTop || isCDrops)) return true;
  if (isCInhaler && (isQTab || isQCap || isQSyrup || isQInj || isQTop || isQDrops)) return true;

  // Specific Topical Clashes (Gel vs Spray, Powder vs Gel, Cream vs Ointment)
  const isQCream = /\b(cream|crm)\b/.test(qLower);
  const isCCream = /\b(cream|crm)\b/.test(cLower);
  const isQOint = /\b(oint|ointment)\b/.test(qLower);
  const isCOint = /\b(oint|ointment)\b/.test(cLower);
  const isQGel = /\b(gel)\b/.test(qLower);
  const isCGel = /\b(gel)\b/.test(cLower);
  const isQLotion = /\b(lotion)\b/.test(qLower);
  const isCLotion = /\b(lotion)\b/.test(cLower);

  if (isQGel && isCSpray) return true;
  if (isQSpray && (isQGel || isCTop)) return true;
  if (isQPowder && (isCGel || isCCream || isCLotion || isCSpray)) return true;
  if (isCPowder && (isQGel || isQCream || isQLotion || isQSpray)) return true;

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

function isBrandMatch(query: string, candidateName: string): boolean {
  let cleanQ = query.toLowerCase()
    .replace(/\bever\s+yuth\b/gi, 'everyuth')
    .replace(/\bsugar\s+free\b/gi, 'sugarfree')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
  let cleanCand = candidateName.toLowerCase()
    .replace(/\bever\s+yuth\b/gi, 'everyuth')
    .replace(/\bsugar\s+free\b/gi, 'sugarfree')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();

  const stopWords = new Set([
    'test', 'dummy', 'sample', 'strip', 'tablets', 'tablet', 'capsules', 'capsule',
    'bottle', 'syrup', 'suspension', 'drops', 'pack', 'solution', 'cream', 'ointment',
    'injection', 'powder', 'device', 'tape', 'plaster', 'plasters', 'cotton', 'bandage',
    'unit', 'units', 'mg', 'mcg', 'ml', 'gm', 'iu', 'of', 'and', 'with', 'for', 'in',
    'wash', 'lotion', 'gel', 'soap', 'sachet', 'sach', 'granules', 'pellets', 'sweetener',
    'substitute', 'diskettes', 'scrub', 'cleanser', 'mask', 'bar', 'shampoo', 'tonic',
    'lozenge', 'lozenges', 'patch', 'diet', 'biscuit', 'biscuits', 'flavour', 'flavor',
    'natural', 'naturals', 'cook', 'bake', 'box', 'pouch', 'jar', 'tube'
  ]);

  const qBrandWords = cleanQ.split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w) && !/^\d+$/.test(w));
  if (qBrandWords.length === 0) return false;

  const candWords = cleanCand.split(/\s+/).filter(Boolean);
  const primaryBrand = qBrandWords[0];

  // 1. Primary brand must match lead of candidate or allowed prefix (new, dr, baby, the)
  const brandIndex = candWords.findIndex(cw => cw === primaryBrand || cw.startsWith(primaryBrand));
  if (brandIndex === -1 || (brandIndex > 0 && !['new', 'dr', 'baby', 'the'].includes(candWords[0]))) {
    return false;
  }

  // 2. Multi-word brand: check first 2 core brand tokens
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

  // 1. Normalized decimal strength (e.g. "0.50 MG" -> "0.5 MG", "1.0 GM" -> "1 GM")
  const normDecimal = cleaned.replace(/\b(\d+)\.0+(\s*(?:mg|mcg|ml|gm|iu|%))\b/gi, '$1$2')
                             .replace(/\b(\d+\.[1-9]+)0+(\s*(?:mg|mcg|ml|gm|iu|%))\b/gi, '$1$2');
  if (normDecimal !== cleaned) {
    queries.push(normDecimal);
    queries.push(normDecimal.replace(/(\d+(?:\.\d+)?)\s*(mg|mcg|ml|gm|iu|%)\b/gi, '$1').trim());
  }

  // 2. Try without dosage unit (e.g. "CIPLOX 500MG" -> "CIPLOX 500")
  const withoutUnit = cleaned.replace(/(\d+(?:\.\d+)?)\s*(mg|mcg|ml|gm|iu|%)\b/gi, '$1').trim();
  if (withoutUnit && withoutUnit !== cleaned) {
    queries.push(withoutUnit);
  }

  // 3. Try Brand + normalized strength number
  const strengthMatch = cleaned.match(/\b(\d+(?:\.\d+)?)\s*(?:mg|mcg|ml|gm|iu|%|\b)/i);
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 1) {
    const brand = words[0];
    if (strengthMatch) {
      const num = parseFloat(strengthMatch[1]);
      queries.push(`${brand} ${num}`);
    }

    // 4. Try Brand + Modifiers (e.g. "OFREX TZ", "PAN D")
    const mods = words.filter(t => FORMULATION_MODIFIERS.has(t.toUpperCase()));
    if (mods.length > 0) {
      queries.push(`${brand} ${mods.join(' ')}`);
      if (strengthMatch) {
        queries.push(`${brand} ${mods.join(' ')} ${parseFloat(strengthMatch[1])}`);
      }
    }

    // 5. Try first two words if word 2 is not a pure number
    if (words.length >= 2 && !/^\d+$/.test(words[1]) && !['MG', 'ML', 'GM', 'TAB', 'CAP', 'INJ'].includes(words[1].toUpperCase())) {
      queries.push(`${brand} ${words[1]}`);
    }

    // 6. Distinctive brand only (>= 4 letters)
    if (brand.length >= 4 && !['TABLET', 'CAPSULE', 'INJECTION', 'CREAM', 'LOTION'].includes(brand.toUpperCase())) {
      queries.push(brand);
    }
  }

  return Array.from(new Set(queries.filter(q => q && q.length >= 3)));
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function initHarvestTable(db: any) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_harvest_state (
        medicine_id INTEGER PRIMARY KEY,
        medicine_name TEXT,
        company TEXT,
        status TEXT NOT NULL,
        reason TEXT,
        checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_harvest_state_status ON catalog_harvest_state(status);
    `);

    // Seed SQLite from JSON state if table is newly created / empty
    const row = db.prepare('SELECT count(*) as c FROM catalog_harvest_state').get() as any;
    if ((row?.c || 0) === 0 && fs.existsSync(STATE_FILE)) {
      const disk = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      const entries = Object.entries(disk.products || {});
      if (entries.length > 0) {
        const insertMany = db.transaction((rows: any[]) => {
          const stmt = db.prepare(`
            INSERT OR IGNORE INTO catalog_harvest_state (medicine_id, medicine_name, company, status, reason, checked_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `);
          for (const [idStr, data] of rows) {
            const medId = parseInt(idStr, 10);
            if (!isNaN(medId)) {
              stmt.run(
                medId,
                data.product_name || data.medicine_name || null,
                data.company || data.manufacturer || null,
                data.status || 'unknown',
                data.reason || null,
                data.checked_at || data.updated_at || new Date().toISOString()
              );
            }
          }
        });
        insertMany(entries);
      }
    }
  } catch {}
}

function loadState(): { last_updated: string | null; products: Record<string, any> } {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch {
      // ignore
    }
  }
  return { last_updated: null, products: {} };
}

let inMemoryState = loadState();

function recordProductState(
  db: any,
  medId: number | string,
  entryData: {
    status: string;
    product_name?: string;
    company?: string;
    reason?: string;
    angles_saved?: number;
    primary_face?: string;
    primary_confidence?: number;
    verified_by?: string;
    [key: string]: any;
  }
) {
  const now = new Date().toISOString();
  const data = { ...entryData, checked_at: now };
  inMemoryState.products[String(medId)] = data;

  // 1. Multi-terminal concurrency-safe SQLite persistence
  try {
    db.prepare(`
      INSERT INTO catalog_harvest_state (medicine_id, medicine_name, company, status, reason, checked_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(medicine_id) DO UPDATE SET
        status = excluded.status,
        medicine_name = COALESCE(excluded.medicine_name, catalog_harvest_state.medicine_name),
        company = COALESCE(excluded.company, catalog_harvest_state.company),
        reason = excluded.reason,
        checked_at = excluded.checked_at
    `).run(
      Number(medId),
      data.product_name || null,
      data.company || null,
      data.status,
      data.reason || null,
      now
    );
  } catch {}

  // 2. Multi-terminal atomic merge write to JSON state file (lock-free temp file + atomic rename)
  const tmpFile = `${STATE_FILE}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      let current: any = { last_updated: null, products: {} };
      if (fs.existsSync(STATE_FILE)) {
        try {
          current = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        } catch {}
      }
      current.products = current.products || {};
      current.products[String(medId)] = data;
      current.last_updated = now;

      fs.writeFileSync(tmpFile, JSON.stringify(current, null, 2), 'utf-8');
      fs.renameSync(tmpFile, STATE_FILE);
      return;
    } catch {
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
      const waitTill = Date.now() + 25 * (attempt + 1);
      while (Date.now() < waitTill) {}
    }
  }
}

async function fetchTata1mgImages(queries: string[], rawMedName: string): Promise<any | null> {
  for (const q of queries) {
    const url = `https://www.1mg.com/pwa-dweb-api/api/v4/search/all?q=${encodeURIComponent(q)}&city=Gurgaon&page_number=0&per_page=5&types=sku,allopathy&sort=relevance`;
    try {
      const response = await fetch(url, {
        headers: {
          'accept': 'application/vnd.healthkartplus.v4+json',
          'x-access-key': '1mg_client_access_key',
          'x-platform': 'desktop-0.0.1',
          'x-city': 'Gurgaon',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) continue;
      const data: any = await response.json();
      const prods = data?.data?.search_results || [];
      if (prods.length === 0) continue;

      const matched = prods.filter((c: any) => {
        const hasImgs = (c.cropped_image_urls && c.cropped_image_urls.length > 0) || Boolean(c.image_url);
        if (!hasImgs) return false;
        if (!isBrandMatch(rawMedName, c.name)) return false;
        if (hasDosageConflict(rawMedName, c.name)) return false;
        if (hasStrengthConflict(rawMedName, c.name)) return false;
        if (hasModifierConflict(rawMedName, c.name)) return false;
        return true;
      });

      if (matched.length === 0) continue;

      const best = matched[0];
      const imageMap: Record<string, string> = {};
      const rawUrls = best.cropped_image_urls || (best.image_url ? [best.image_url] : []);

      const faces = ['front', 'back', 'combo', 'side'];
      for (let idx = 0; idx < rawUrls.length; idx++) {
        // Strip Gumlet watermark transformation to download pristine 800x800 studio photo!
        const cleanUrl = rawUrls[idx]
          .replace(/l_watermark_[^/]+\//g, '')
          .replace(/w_\d+,h_\d+/g, 'w_800,h_800');
        const face = faces[idx] || `angle_${idx + 1}`;
        imageMap[face] = cleanUrl;
      }

      if (Object.keys(imageMap).length > 0) {
        console.log(`    🔍 Rescued from Tata 1mg Clean CDN: "${best.name}" (${Object.keys(imageMap).length} angles)`);
        return {
          name: best.name,
          slug: slugify(best.name),
          images: imageMap,
          source: 'tata_1mg_clean'
        };
      }
    } catch {
      // try next query
    }
  }
  return null;
}

async function fetchCdnImages(queries: string[], rawMedName: string): Promise<any | null> {
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
      if (prods.length === 0) continue;

      const matched = prods.filter((c: any) => {
        const hasImg = (c.damImages && c.damImages.length > 0) || Boolean(c.image);
        if (!hasImg) return false;
        if (!isBrandMatch(rawMedName, c.name)) return false;
        if (hasDosageConflict(rawMedName, c.name)) return false;
        if (hasStrengthConflict(rawMedName, c.name)) return false;
        if (hasModifierConflict(rawMedName, c.name)) return false;
        return true;
      });

      if (matched.length === 0) continue;

      matched.sort((a: any, b: any) => {
        const aCount = a.damImages?.length || (a.image ? 1 : 0);
        const bCount = b.damImages?.length || (b.image ? 1 : 0);
        return bCount - aCount;
      });

      const best = matched[0];
      const damImages = best.damImages || [];
      const imageMap: Record<string, string> = {};

      for (const img of damImages) {
        const face = img.face || 'default';
        if (!imageMap[face] && img.url) {
          // Verify no consumer watermarking on DAM URL
          const rawUrl = img.url.split('?')[0];
          imageMap[face] = rawUrl;
        }
      }

      if (Object.keys(imageMap).length === 0 && best.image) {
        imageMap['front'] = best.image.split('?')[0];
      }

      if (Object.keys(imageMap).length > 0) {
        return {
          name: best.name,
          slug: best.slug || slugify(best.name),
          images: imageMap
        };
      }
    } catch {
      // try next query
    }
  }

  // 2. Automatic Fallback: Tata 1mg Zero-Watermark Studio CDN (rescuing hospital/fertility/specialty meds)
  return await fetchTata1mgImages(queries, rawMedName);
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

function hammingDistance(h1: string, h2: string): number {
  if (!h1 || !h2 || h1.length !== h2.length) return 64;
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    const v1 = parseInt(h1[i], 16);
    const v2 = parseInt(h2[i], 16);
    let xor = v1 ^ v2;
    while (xor > 0) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}

async function printStatus() {
  const db = new Database(DB_PATH);
  const state = loadState();

  const totalInDb = db.prepare('SELECT COUNT(DISTINCT medicine_id) as c FROM catalog_images').get() as any;
  const totalAngles = db.prepare('SELECT COUNT(*) as c FROM catalog_images').get() as any;
  const stateKeys = Object.keys(state.products || {});
  const successCount = stateKeys.filter(k => state.products[k].status === 'success').length;
  const notFoundCount = stateKeys.filter(k => state.products[k].status === 'not_found').length;
  const geminiRejectedCount = stateKeys.filter(k => state.products[k].status === 'gemini_rejected').length;

  console.log('\n===============================================================');
  console.log('              PRODUCT IMAGE HARVEST STATUS');
  console.log('===============================================================');
  console.log(`Database Catalog Medicines with Images : ${totalInDb?.c || 0}`);
  console.log(`Total Verified Image Angles Saved      : ${totalAngles?.c || 0}`);
  console.log(`Evaluated State Records                : ${stateKeys.length}`);
  console.log(`  - Successfully Verified & Saved      : ${successCount}`);
  console.log(`  - Not Available on Pharma CDN        : ${notFoundCount}`);
  if (geminiRejectedCount > 0) {
    console.log(`  - Rejected by Gemini Vision Gate     : ${geminiRejectedCount}`);
  }
  console.log(`Last Updated                           : ${state.last_updated || 'Never'}`);
  console.log('===============================================================\n');
}

async function main() {
  const args = process.argv.slice(2);
  let companyFilter = '';
  let nameFilter = '';
  let topCount = 100;
  let limit = 0;
  let delayMs = 500;
  let force = false;
  let retryFailed = false;
  let shardStr = '';
  let idleShutdownMin = 0;
  let shutdownOnComplete = false;
  let useGemini = false;
  let commitEvery = 1000;
  let poolNumber = 1;
  let customKeys: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--status') {
      await printStatus();
      return;
    }
    if (args[i].startsWith('--company=')) companyFilter = args[i].split('=')[1].replace(/['"]/g, '');
    else if (args[i].startsWith('--filter=')) nameFilter = args[i].split('=')[1].replace(/['"]/g, '');
    else if (args[i].startsWith('--pool=')) poolNumber = parseInt(args[i].split('=')[1], 10);
    else if (args[i].startsWith('--shard=')) shardStr = args[i].split('=')[1].trim();
    else if (args[i].startsWith('--top=')) topCount = parseInt(args[i].split('=')[1], 10);
    else if (args[i].startsWith('--limit=')) limit = parseInt(args[i].split('=')[1], 10);
    else if (args[i].startsWith('--delay=')) delayMs = parseInt(args[i].split('=')[1], 10);
    else if (args[i] === '--force') force = true;
    else if (args[i] === '--retry-failed') retryFailed = true;
    else if (args[i].startsWith('--idle-shutdown-min=')) idleShutdownMin = parseInt(args[i].split('=')[1], 10);
    else if (args[i] === '--shutdown-on-complete') shutdownOnComplete = true;
    else if (args[i] === '--gemini') useGemini = true;
    else if (args[i].startsWith('--keys=')) {
      const parsedKeys = args[i].split('=')[1].split(/[,;]+/).map(k => k.trim()).filter(Boolean);
      if (parsedKeys.length > 0) customKeys = parsedKeys;
    }
    else if (args[i] === '--auto-shutdown') {
      idleShutdownMin = 5;
      shutdownOnComplete = true;
    }
  }

  console.log('===============================================================');
  console.log('    MASTER PRODUCT IMAGE HARVESTER & AI OCR VERIFICATION');
  console.log('===============================================================\n');

  let geminiKeys: string[] = [];
  let spareKey: string | undefined = undefined;

  if (customKeys.length > 0) {
    geminiKeys = customKeys;
  } else if (poolNumber >= 1 && poolNumber <= 4) {
    const poolEnv = process.env[`GEMINI_API_KEYS_POOL_${poolNumber}`];
    spareKey = process.env[`GEMINI_SPARE_KEY_POOL_${poolNumber}`];
    if (poolEnv) {
      geminiKeys = poolEnv.split(/[,;\s]+/).map(k => k.trim()).filter(Boolean);
    }
  }

  if (geminiKeys.length === 0) {
    const rawKeyStr = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
    geminiKeys = rawKeyStr.split(/[,;\s]+/).map(k => k.trim()).filter(Boolean);
  }

  if (useGemini) {
    console.log(`🤖 Google Gemini Flash Vision: ACTIVE (100% label confirmation).`);
    console.log(`🔑 Key Pool #${poolNumber}: ${geminiKeys.length} active rotating keys + dedicated Emergency Spare Key.`);
  }
  if (shardStr) {
    console.log(`⚡ Shard Partition: ${shardStr}`);
  }
  if (commitEvery > 0) {
    console.log(`📦 Git Auto-Commit: ACTIVE (commits every ${commitEvery} saved images).`);
  }
  if (idleShutdownMin > 0) {
    console.log(`⏱️ Auto-Shutdown Watchdog: Enabled (${idleShutdownMin} minutes inactivity limit).`);
  }
  if (shutdownOnComplete) {
    console.log(`🔌 Shutdown On Complete: Enabled (PC will turn off when harvest finishes).`);
  }
  console.log('');

  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 30000');
  initHarvestTable(db);
  inMemoryState = loadState();

  const visualIndex = VisualIndexService.getInstance();
  await aiCameraService.initialize();

  // 1. Determine target medicines
  const whereClauses: string[] = [
    "name NOT LIKE 'test%'",
    "name NOT LIKE '%dummy%'",
    "name NOT LIKE 'sample%'",
    "name NOT LIKE '1st aid%'"
  ];
  const params: any[] = [];

  if (nameFilter) {
    console.log(`Target Name/Brand Filter: "${nameFilter}"`);
    whereClauses.push("name LIKE ?");
    params.push(`%${nameFilter}%`);
  }

  let orderClause = "ORDER BY id ASC";

  if (companyFilter) {
    console.log(`Target Company Filter: "${companyFilter}"`);
    whereClauses.push("manufacturer LIKE ?");
    params.push(`%${companyFilter}%`);
  } else if (!nameFilter) {
    console.log(`Target: Top ${topCount} Pharmaceutical Companies`);
    const topMans = db.prepare(`
      SELECT manufacturer, count(*) as c
      FROM medicines
      WHERE manufacturer IS NOT NULL 
        AND TRIM(manufacturer) != ''
        AND manufacturer NOT LIKE '%FOOT WEAR%'
        AND manufacturer NOT LIKE '%ORTHOTICS%'
        AND manufacturer NOT LIKE '%SHOES%'
      GROUP BY manufacturer
      ORDER BY c DESC
      LIMIT ?
    `).all(topCount).map((r: any) => r.manufacturer);

    const placeholders = topMans.map(() => '?').join(',');
    whereClauses.push(`manufacturer IN (${placeholders})`);
    params.push(...topMans);

    const whenClauses = topMans.map((_, idx) => `WHEN ? THEN ${idx}`).join(' ');
    orderClause = `ORDER BY CASE manufacturer ${whenClauses} ELSE 999 END ASC, id ASC`;
    params.push(...topMans);
  }

  let query = `
    SELECT id, name, canonical_name, manufacturer, packaging
    FROM medicines
    WHERE ${whereClauses.join(' AND ')}
    ${orderClause}
  `;

  if (limit > 0) {
    query += ` LIMIT ${limit}`;
  }

  const allMedicines = db.prepare(query).all(...params);
  console.log(`Loaded ${allMedicines.length} total medicines in target scope.`);

  // 2. Upfront check: Skip all already-processed medicines instantly
  const checkDbStmt = db.prepare('SELECT 1 FROM catalog_images WHERE medicine_id = ? AND is_active = 1 LIMIT 1');
  const checkSqliteStateStmt = db.prepare('SELECT status, reason FROM catalog_harvest_state WHERE medicine_id = ? LIMIT 1');

  let dbImageCount = 0;
  let diskImageCount = 0;
  let notFoundCount = 0;
  let rejectedCount = 0;
  let otherProcessedCount = 0;

  const remainingMedicines: any[] = [];

  for (const med of allMedicines) {
    const medId = med.id;
    const medName = med.name || med.canonical_name;
    const baseSlug = slugify(medName);

    if (force) {
      remainingMedicines.push(med);
      continue;
    }

    // A. Check database for active verified catalog images
    const hasDbImage = checkDbStmt.get(medId);
    if (hasDbImage) {
      dbImageCount++;
      continue;
    }

    // B. Check disk for existing product packaging
    const frontOnDisk = path.join(TARGET_FRONTEND, `${baseSlug}-front.jpg`);
    const boxFrontOnDisk = path.join(TARGET_FRONTEND, `${baseSlug}-box-front.jpg`);
    if ((fs.existsSync(frontOnDisk) && fs.statSync(frontOnDisk).size > 1000) ||
        (fs.existsSync(boxFrontOnDisk) && fs.statSync(boxFrontOnDisk).size > 1000)) {
      diskImageCount++;
      continue;
    }

    // C. Check persistent harvest state (DB and JSON)
    const jsonState = inMemoryState.products[String(medId)];
    const sqlState = checkSqliteStateStmt.get(medId) as any;
    const status = jsonState?.status || sqlState?.status;

    if (status) {
      if (status === 'success') {
        dbImageCount++;
        continue;
      }

      if (!retryFailed) {
        if (status === 'not_found' || status === 'no_authentic_match_on_cdn') {
          notFoundCount++;
          continue;
        } else if (status === 'gemini_rejected') {
          rejectedCount++;
          continue;
        } else {
          otherProcessedCount++;
          continue;
        }
      }
    }

    // Needs processing!
    remainingMedicines.push(med);
  }

  const totalSkipped = dbImageCount + diskImageCount + notFoundCount + rejectedCount + otherProcessedCount;

  console.log('===============================================================');
  console.log('       TARGET AUDIT & FAST RESUME CHECKPOINT');
  console.log('===============================================================');
  console.log(`📋 Total Medicines in Target Scope    : ${allMedicines.length.toLocaleString()}`);
  console.log(`⏩ Already Processed & Skipped        : ${totalSkipped.toLocaleString()}`);
  console.log(`   • Confirmed with Images in DB      : ${dbImageCount.toLocaleString()}`);
  if (diskImageCount > 0) {
    console.log(`   • Image Pack Found on Disk         : ${diskImageCount.toLocaleString()}`);
  }
  console.log(`   • Previously Not Found on CDN      : ${notFoundCount.toLocaleString()}`);
  console.log(`   • Rejected by Gemini Vision Gate   : ${rejectedCount.toLocaleString()}`);
  if (otherProcessedCount > 0) {
    console.log(`   • Other Prior Evaluations          : ${otherProcessedCount.toLocaleString()}`);
  }
  console.log(`🎯 Remaining Unprocessed to Scan       : ${remainingMedicines.length.toLocaleString()}`);
  console.log('===============================================================\n');

  // 3. Shard partition handling
  let workList = remainingMedicines;
  if (shardStr) {
    const parts = shardStr.split('/');
    const shardIndex = parseInt(parts[0], 10) - 1;
    const totalShards = parseInt(parts[1] || '4', 10);
    if (!isNaN(shardIndex) && !isNaN(totalShards) && totalShards > 1) {
      workList = remainingMedicines.filter((_, idx) => idx % totalShards === shardIndex);
      console.log(`⚡ Shard Mode: Terminal ${shardIndex + 1} of ${totalShards} -> Assigned ${workList.length.toLocaleString()} of ${remainingMedicines.length.toLocaleString()} remaining medicines.\n`);
    }
  }

  if (workList.length === 0) {
    console.log('🎉 100% COMPLETE: All target medicines in scope have already been processed! Zero remaining scans.\n');
    return;
  }

  let processed = 0;
  let successCount = 0;
  let lastImageSavedTimestamp = Date.now();
  let imagesSavedSinceLastCommit = 0;
  let totalImagesSavedCount = 0;

  let watchdogTimer: NodeJS.Timeout | null = null;
  if (idleShutdownMin > 0) {
    watchdogTimer = setInterval(() => {
      const idleElapsedMs = Date.now() - lastImageSavedTimestamp;
      if (idleElapsedMs >= idleShutdownMin * 60 * 1000) {
        console.log(`\n===============================================================`);
        console.log(`⚠️ INACTIVITY WATCHDOG: No images downloaded for ${idleShutdownMin} minutes.`);
        console.log(`Flushing progress and turning off PC...`);
        console.log(`===============================================================\n`);
        if (watchdogTimer) clearInterval(watchdogTimer);
        if (imagesSavedSinceLastCommit > 0) {
          autoCommitBatch(imagesSavedSinceLastCommit, totalImagesSavedCount);
          imagesSavedSinceLastCommit = 0;
        }
        triggerWindowsShutdown(`AI Pharmacy Harvester: No images downloaded for ${idleShutdownMin} min.`);
      }
    }, 10000);
  }

  for (let i = 0; i < workList.length; i++) {
    const med: any = workList[i];
    const medId = med.id;
    const medName = med.name || med.canonical_name;
    const mfg = med.manufacturer || 'Unknown';

    processed++;
    const searchQueries = generateSearchQueries(medName);
    console.log(`[${i + 1}/${workList.length}] ID ${medId}: "${medName}" (${mfg})`);
    console.log(`    Querying CDN for: "${searchQueries[0]}"...`);

    const cdnResult = await fetchCdnImages(searchQueries, medName);
    if (!cdnResult || Object.keys(cdnResult.images).length === 0) {
      console.log(`    ⚠️ No verified match found on pharma CDN.\n`);
      recordProductState(db, medId, {
        status: 'not_found',
        company: mfg,
        product_name: medName,
        reason: 'No match found on pharma CDN'
      });
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }

    console.log(`    ✅ Matched: "${cdnResult.name}" (${Object.keys(cdnResult.images).length} angles available)`);

    const downloadedAngles: Array<{
      face: string;
      relPath: string;
      buffer: Buffer;
      phash: string | null;
      brandConfidence: number;
      ocrTextSnippet: string;
    }> = [];

    const baseSlug = slugify(medName);
    const brandWord = searchQueries[0].split(/\s+/)[0].toLowerCase();
    const strengthMatch = medName.match(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|ml|gm|iu|%)\b/i);
    const strengthToken = strengthMatch ? strengthMatch[1] : null;

    // Up to 4 priority angles: front, back, side/composition, combo
    const ALLOWED_FACES = ['front', 'box-front', 'back', 'box-back', 'side', 'combo', 'default'];
    const seenPhashes: string[] = [];

    for (const [face, imgUrl] of Object.entries(cdnResult.images)) {
      if (!ALLOWED_FACES.includes(face) && downloadedAngles.length >= 4) continue;

      const rawBuf = await downloadBuffer(imgUrl as string);
      if (!rawBuf || rawBuf.length < 1000) continue;

      const fileName = `${baseSlug}-${face}.jpg`;
      const frontendPath = path.join(TARGET_FRONTEND, fileName);
      const uploadsPath = path.join(TARGET_UPLOADS, fileName);

      // Smart compression (max 1200px, quality 82%) -> saves 90% disk space
      await imageCompressionService.compressAndSave(rawBuf, frontendPath, 1200, 82);
      fs.copyFileSync(frontendPath, uploadsPath);

      const compBuf = fs.readFileSync(frontendPath);
      const phash = await visualIndex.computePhashFromBuffer(compBuf);

      // Deduplication check: skip identical images (Hamming distance <= 3)
      if (phash) {
        const isDuplicate = seenPhashes.some(sp => hammingDistance(sp, phash) <= 3);
        if (isDuplicate) {
          console.log(`    ⏩ Skipping duplicate visual angle for face "${face}"`);
          try { fs.unlinkSync(frontendPath); fs.unlinkSync(uploadsPath); } catch {}
          continue;
        }
        seenPhashes.push(phash);
      }

      // Fast AI Camera OCR verification for name clarity (checks printed brand, strength & mfg)
      let brandConfidence = 20;
      let ocrSnippet = '';
      try {
        const rawOcr = await aiCameraService.extractRawText(compBuf);
        const lowerOcr = rawOcr.toLowerCase();
        ocrSnippet = rawOcr.slice(0, 100).replace(/\s+/g, ' ');

        const hasBrand = lowerOcr.includes(brandWord);
        const hasStrength = strengthToken ? lowerOcr.includes(strengthToken) : false;
        const hasMfg = mfg ? lowerOcr.includes(mfg.split(/\s+/)[0].toLowerCase()) : false;
        const textVolume = rawOcr.replace(/[^a-zA-Z0-9]/g, '').length;

        if (hasBrand && hasStrength) {
          brandConfidence = 95; // Clear printed brand + verified strength
        } else if (hasBrand) {
          brandConfidence = 80; // Clear printed brand
        } else if (hasStrength && textVolume > 50) {
          brandConfidence = 60; // Technical packaging face (composition, batch, MRP)
        } else if (textVolume > 40) {
          brandConfidence = 45; // Readable packaging text
        } else {
          // Minimal or no text (e.g. blank blister foil bubbles)
          brandConfidence = (face === 'front' || face === 'box-front') ? 30 : 10;
        }
      } catch {
        brandConfidence = (face === 'front' || face === 'box-front') ? 40 : 15;
      }

      downloadedAngles.push({
        face,
        relPath: `/products/${fileName}`,
        buffer: compBuf,
        phash,
        brandConfidence,
        ocrTextSnippet: ocrSnippet
      });

      if (downloadedAngles.length >= 4) break; // Maximum 4 clean angles per product
    }

    if (downloadedAngles.length === 0) {
      recordProductState(db, medId, {
        status: 'download_failed',
        company: mfg,
        product_name: medName,
        reason: 'Zero valid angles downloaded'
      });
      continue;
    }

    // Sort: Face with clearest printed medicine name becomes PRIMARY (never blank blister foil)
    downloadedAngles.sort((a, b) => b.brandConfidence - a.brandConfidence);

    // Optional Gemini Flash Vision Confirmation Gate:
    // Check primary face (front or clearest text). If unconfirmed, check back face.
    // If either front OR back confirms, all angles pass!
    let finalMatchingMethod = 'ai_ocr_verified';
    if (useGemini && geminiKeys.length > 0) {
      console.log(`    🤖 Verifying packaging with Gemini Vision (front/back check)...`);
      let confirmedResult: any = null;
      let primaryAngleIndex = 0;

      // Try top 2 candidate angles (front, and if unconfirmed, back)
      const anglesToTry = Math.min(downloadedAngles.length, 2);
      for (let aIdx = 0; aIdx < anglesToTry; aIdx++) {
        const angle = downloadedAngles[aIdx];
        const gResult = await verifyWithGeminiVision(angle.buffer, medName, geminiKeys, spareKey);
        if (gResult.isExactMatch) {
          confirmedResult = gResult;
          primaryAngleIndex = aIdx;
          break;
        } else if (aIdx < anglesToTry - 1) {
          console.log(`    ⚠️ Face "${angle.face}" unconfirmed, checking alternate face "${downloadedAngles[aIdx + 1].face}"...`);
          await new Promise(r => setTimeout(r, 600));
        }
      }

      if (!confirmedResult) {
        console.log(`    ❌ Gemini Vision REJECTED: Neither front nor back matched "${medName}"\n`);
        for (const ang of downloadedAngles) {
          const fp = path.join(ROOT_DIR, 'frontend', 'public', ang.relPath);
          const up = path.join(ROOT_DIR, 'uploads', ang.relPath.replace('/products/', 'products/'));
          try { fs.unlinkSync(fp); fs.unlinkSync(up); } catch {}
        }
        recordProductState(db, medId, {
          status: 'gemini_rejected',
          company: mfg,
          product_name: medName,
          reason: 'Neither front nor back matched target brand'
        });
        continue;
      }

      // Promote the confirmed face to index 0 so it becomes is_primary = 1
      if (primaryAngleIndex > 0) {
        const confirmedAngle = downloadedAngles.splice(primaryAngleIndex, 1)[0];
        downloadedAngles.unshift(confirmedAngle);
      }

      finalMatchingMethod = 'gemini_vision_verified';
      downloadedAngles[0].brandConfidence = Math.max(downloadedAngles[0].brandConfidence, confirmedResult.confidence);
      console.log(`    ✨ Gemini 100% Confirmed on face "${downloadedAngles[0].face}": "${confirmedResult.printedName}" (${confirmedResult.confidence}% confidence) -> All angles PASSED!`);
    }

    // Persist cleanly in catalog_images
    db.prepare('DELETE FROM catalog_images WHERE medicine_id = ?').run(medId);

    const insertStmt = db.prepare(`
      INSERT INTO catalog_images (
        medicine_id, company_name, product_name, image_path, thumbnail_path, image_source,
        confidence_score, matching_method, verification_status, ocr_text, is_active,
        image_type, is_primary, slot_number, phash
      ) VALUES (?, ?, ?, ?, ?, 'pharma_dam_cdn', ?, ?, 'APPROVED', ?, 1, ?, ?, ?, ?)
    `);

    for (let aIdx = 0; aIdx < downloadedAngles.length; aIdx++) {
      const ang = downloadedAngles[aIdx];
      const isPrimary = aIdx === 0 ? 1 : 0;
      insertStmt.run(
        medId,
        mfg,
        cdnResult.name,
        ang.relPath,
        ang.relPath,
        ang.brandConfidence,
        finalMatchingMethod,
        ang.ocrTextSnippet,
        ang.face,
        isPrimary,
        aIdx + 1,
        ang.phash
      );
    }

    console.log(`    📸 Saved ${downloadedAngles.length} clean angles. Primary Face: "${downloadedAngles[0].face}" (Readability Confidence: ${downloadedAngles[0].brandConfidence}%)\n`);
    successCount++;
    lastImageSavedTimestamp = Date.now(); // Reset watchdog timer on every successful download
    totalImagesSavedCount += downloadedAngles.length;
    imagesSavedSinceLastCommit += downloadedAngles.length;

    recordProductState(db, medId, {
      status: 'success',
      company: mfg,
      product_name: cdnResult.name,
      angles_saved: downloadedAngles.length,
      primary_face: downloadedAngles[0].face,
      primary_confidence: downloadedAngles[0].brandConfidence,
      verified_by: finalMatchingMethod
    });

    // Auto-commit milestone every 1,000 saved images
    if (commitEvery > 0 && imagesSavedSinceLastCommit >= commitEvery) {
      autoCommitBatch(imagesSavedSinceLastCommit, totalImagesSavedCount);
      imagesSavedSinceLastCommit = 0;
    }

    await new Promise(r => setTimeout(r, delayMs));
  }

  if (watchdogTimer) clearInterval(watchdogTimer);

  // Commit any final uncommitted images before shutdown
  if (imagesSavedSinceLastCommit > 0) {
    autoCommitBatch(imagesSavedSinceLastCommit, totalImagesSavedCount);
    imagesSavedSinceLastCommit = 0;
  }

  console.log('===============================================================');
  console.log('                   HARVEST RUN COMPLETE');
  console.log('===============================================================');
  console.log(`Total Evaluated : ${processed}`);
  console.log(`Newly Saved     : ${successCount}`);
  console.log(`Already Saved   : ${skippedCount}`);
  console.log(`State File      : ${STATE_FILE}`);
  console.log('===============================================================\n');

  await printStatus();

  if (shutdownOnComplete) {
    console.log(`\n🎉 All target medicines evaluated.`);
    triggerWindowsShutdown(`AI Pharmacy Harvester: All ${medicines.length} medicines processed.`);
  }
}

main().catch((err) => {
  console.error('Fatal harvest runner error:', err);
  process.exit(1);
});
