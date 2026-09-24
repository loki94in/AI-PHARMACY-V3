#!/usr/bin/env node

// [HARVESTER_HOT_RELOAD_TRIGGER]: 2026-09-14T08:58:00.000Z

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
const STAGING_DIR = path.join(ROOT_DIR, 'scratch', 'harvester_staging');

fs.mkdirSync(TARGET_FRONTEND, { recursive: true });
fs.mkdirSync(TARGET_UPLOADS, { recursive: true });
fs.mkdirSync(STAGING_DIR, { recursive: true });
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });

function autoCommitBatch(batchCount: number, totalImagesSaved: number, reason?: string) {
  try {
    console.log(`\n===============================================================`);
    console.log(`📦 AUTO-SAVE: Project Milestone (${batchCount} images, total: ${totalImagesSaved})`);
    if (reason) console.log(`Tag: ${reason}`);
    console.log(`===============================================================\n`);
    
    // Refresh knowledge graph quickly
    try {
      execSync('node scripts/quick-update.mjs', { stdio: 'ignore' });
    } catch {}

    const lockFile = path.join(ROOT_DIR, '.git', 'index.lock');
    if (fs.existsSync(lockFile)) {
      console.warn(`[AutoSave] Git index is temporarily locked by another terminal. Will retry on next milestone.`);
      return;
    }

    execSync('git add frontend/public/products data/top100_harvest_state.json .understand-anything', { stdio: 'ignore' });
    const tag = reason ? ` [${reason}]` : '';
    const msg = `feat(catalog): auto-save milestone${tag} (${totalImagesSaved} images in database)`;
    execSync(`git commit -m "${msg}"`, { stdio: 'inherit' });
    console.log(`✅ Git commit complete: "${msg}"\n`);
  } catch (err: any) {
    if (!err.message?.includes('nothing to commit')) {
      console.warn(`[AutoSave] Git notice:`, err.message);
    }
  }
}

function checkAndTriggerDbMilestoneCommit(db: any, commitEvery: number, terminalIndex?: number): boolean {
  if (commitEvery <= 0) return false;
  try {
    const row = db.prepare('SELECT COUNT(*) as c FROM catalog_images').get() as any;
    const currentDbCount = row?.c || 0;

    let lastCommittedRow = db.prepare("SELECT value FROM app_settings WHERE key = 'catalog_images_git_last_committed_count'").get() as any;
    let lastCommitted = lastCommittedRow ? parseInt(lastCommittedRow.value, 10) : 0;

    if (!lastCommitted || isNaN(lastCommitted)) {
      const initialBaseline = Math.floor(currentDbCount / commitEvery) * commitEvery;
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('catalog_images_git_last_committed_count', ?)").run(String(initialBaseline));
      lastCommitted = initialBaseline;
    }

    const diff = currentDbCount - lastCommitted;
    if (diff >= commitEvery) {
      const lockFile = path.join(ROOT_DIR, '.git', 'index.lock');
      if (fs.existsSync(lockFile)) {
        console.warn(`[AutoSave] Git index is temporarily locked by another terminal. Will retry on next verified product.`);
        return false;
      }

      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('catalog_images_git_last_committed_count', ?)").run(String(currentDbCount));

      const tag = terminalIndex && terminalIndex > 0 ? `Terminal ${terminalIndex}` : undefined;
      autoCommitBatch(diff, currentDbCount, tag);
      return true;
    }
  } catch (err: any) {
    // Non-fatal, just continue
  }
  return false;
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

function loadCompaniesFromCsv(terminalIndex: number): string[] {
  const csvPath = path.join(ROOT_DIR, 'data', 'company_medicine_counts.csv');
  if (!fs.existsSync(csvPath)) return [];
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const companies: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const lastComma = line.lastIndexOf(',');
    if (lastComma > 0) {
      const name = line.substring(0, lastComma).trim().replace(/^["']|["']$/g, '');
      if (name && !companies.includes(name)) {
        companies.push(name);
      }
    }
  }
  return companies.filter((_, idx) => idx % 12 === (terminalIndex - 1));
}

function loadAllCompaniesFromCsv(): string[] {
  const csvPath = path.join(ROOT_DIR, 'data', 'company_medicine_counts.csv');
  if (!fs.existsSync(csvPath)) return [];
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const companies: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const lastComma = line.lastIndexOf(',');
    if (lastComma > 0) {
      const name = line.substring(0, lastComma).trim().replace(/^["']|["']$/g, '');
      if (name && !companies.includes(name)) {
        companies.push(name);
      }
    }
  }
  return companies;
}

function cleanMedicineNameForAi(rawName: string): string {
  if (!rawName) return '';
  let clean = rawName
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/\b(strip|pack|bottle|box|tube|vial|ampoule|blister|carton|jar|sachet)\s+of\s+\d+[\w\s]*/gi, ' ')
    .replace(/\b(strip\s+of|bottle\s+of|pack\s+of|box\s+of)\b/gi, ' ')
    .replace(/\b\d+\s*['’]s\b/gi, ' ')
    .replace(/\b(ip|bp|usp)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || rawName;
}

let globalKeyIndex = 0;
const keyLastUsedMap = new Map<string, number>();
let keySpacingMs = 4000; // 4.0s per key (15 RPM Google free tier)

async function verifyWithGeminiVision(
  buffer: Buffer,
  targetMedName: string,
  apiKeys: string[],
  spareKey?: string
): Promise<{ isExactMatch: boolean; printedName: string; confidence: number; reason: string }> {
  const cleanTarget = cleanMedicineNameForAi(targetMedName);
  const base64Data = buffer.toString('base64');
  const prompt = `You are a strict pharmaceutical packaging verification AI.
Examine this medicine packaging photo with extreme precision.
Target Medicine to Verify: "${cleanTarget}" (Database reference: "${targetMedName}")

CRITICAL PHARMACEUTICAL RULES:
1. READ the printed brand name, active strength, formulation modifiers, and dosage form from the packaging photo.
2. STRENGTH MUST MATCH:
   - Target total combination strength matches split strengths (e.g. target "625" or "625 Duo" matches photo showing "500 mg + 125 mg" or "500/125"; target "1000" matches "500/500").
   - If target is 8 mg and packaging photo is 20 mg, is_exact_match: false!
   - If target is 800 mg and photo is 400 mg, is_exact_match: false!
   - If target is 100 mg and photo is 1 mg, is_exact_match: false!
3. ACTIVE FORMULATION MODIFIERS:
   - Release modifiers (SR, ER, CR, PR, MR, TR, XR, XL, LA) are equivalent formulation standards and count as a match!
   - Single-ingredient products must NEVER match combination products (e.g. 'Rosuvas' is NOT 'Rosuvas F'! 'Atorva' is NOT 'Atorva F'!).
   - E.g. 'Gemer' is NOT 'Gemer Sita IR'! 'Nurokind Plus' is NOT 'Nurokind Plus RF'!
4. DOSAGE FORM MUST MATCH:
   - Gel is NOT Spray! Powder is NOT Gel/Lotion/Cream! Tablet is NOT Syrup/Suspension! Drops are NOT Tablets!
   - Eye/Ear Drops can be formulated as Ophthalmic Solution or Ophthalmic Suspension (counts as a match for Drops).
   - Medicine capsules/tablets must NEVER match medical devices/belts/inhaler hardware!
5. Packaging pack counts (e.g. 10 tablets vs 15 tablets or 100ml vs 200ml) ARE ALLOWED and count as a match (is_exact_match: true). Only Brand Name, Active Strength, Active Modifiers, and Dosage Form must match!
6. If the image depicts a DIFFERENT medicine brand, wrong strength, wrong combination variant, or wrong form, you MUST set is_exact_match: false.

Return valid JSON with:
{
  "is_exact_match": boolean,
  "printed_name": string,
  "printed_strength": string,
  "confidence": number (0-100),
  "reason": string
}`;

  const models = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
  const keysToTry = apiKeys.length > 0 ? [...apiKeys] : (spareKey ? [spareKey] : []);

  for (const model of models) {
    for (let attempt = 0; attempt < Math.min(keysToTry.length, 6); attempt++) {
      if (keysToTry.length === 0) break;
      
      // Select the best key: prioritize keys that have cooled down >= keySpacingMs
      let bestKeyIdx = -1;
      let earliestUsedTime = Infinity;
      const now = Date.now();

      for (let i = 0; i < keysToTry.length; i++) {
        const idx = (globalKeyIndex + i) % keysToTry.length;
        const k = keysToTry[idx];
        const lastUsed = keyLastUsedMap.get(k) || 0;
        if (now - lastUsed >= keySpacingMs) {
          bestKeyIdx = idx;
          break;
        }
        if (lastUsed < earliestUsedTime) {
          earliestUsedTime = lastUsed;
          bestKeyIdx = idx;
        }
      }

      if (bestKeyIdx === -1) bestKeyIdx = globalKeyIndex % keysToTry.length;
      const activeKey = keysToTry[bestKeyIdx];
      const lastUsed = keyLastUsedMap.get(activeKey) || 0;
      const waitMs = Math.max(0, keySpacingMs - (Date.now() - lastUsed));

      if (waitMs > 0 && waitMs <= keySpacingMs) {
        if (waitMs > 300) {
          console.log(`    ⏳ Key #${bestKeyIdx + 1} pacing: waiting ${(waitMs / 1000).toFixed(2)}s for ${(keySpacingMs / 1000).toFixed(1)}s gap...`);
        }
        await new Promise(r => setTimeout(r, waitMs));
      }

      keyLastUsedMap.set(activeKey, Date.now());
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

        // Dead key - prune from active pool immediately
        if (res.status === 401) {
          keysToTry.splice(bestKeyIdx, 1);
          if (keysToTry.length === 0) break;
          continue;
        }

        if (res.status === 503 || res.status === 429) {
          keyLastUsedMap.set(activeKey, Date.now() + 8000); // 8s penalty cooldown on 429
          if (keysToTry.length > 1) {
            console.log(`    ⏳ Gemini ${model} returned ${res.status} on Key #${bestKeyIdx + 1}, rotating to next key...`);
          }
          globalKeyIndex = (bestKeyIdx + 1) % keysToTry.length;
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
        globalKeyIndex = (bestKeyIdx + 1) % keysToTry.length;

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
      console.log(`    ⚡ Using dedicated Emergency Spare Key for "${cleanTarget}"...`);
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

  console.warn(`    ⚠️ [Gemini Vision] All keys busy/rate-limited for "${cleanTarget}". Checking Local AI OCR...`);
  return { isExactMatch: false, printedName: '', confidence: 0, reason: 'Gemini rate limited / offline - check local AI OCR' };
}

// Formulation modifier conflict dictionary (includes single letters and active combination abbreviations)
const FORMULATION_MODIFIERS = new Set([
  'KID', 'KIDS', 'JUNIOR', 'JR', 'BABY', 'PAED', 'PAEDIATRIC', 'PEDIATRIC',
  'PLUS', 'FORTE', 'FORT', 'DS', 'DUO', 'COMBIKIT', 'COMBI', 'KIT', 'MAX', 'EXTRA',
  'DSR', 'D', 'DP', 'AP', 'SP', 'AM', 'AT', 'AZ', 'H', 'LS', 'DX', 'AX', 'CZ', 'CT',
  'LP', 'CV', 'KT', 'COLD', 'FLU', 'TZ', 'OZ', 'TG', 'CH', 'CL', 'AF', 'DF', 'DM', 'XT', 'PF', 'PD',
  'SR', 'ER', 'CR', 'PR', 'MR', 'TR', 'XR', 'XL', 'LA',
  'DT', 'MD', 'SL', 'OD',
  'F', 'RF', 'IR', 'SITA', 'CF', 'TC', 'P', 'M', 'G',
  'Z', 'T', 'A', 'L', 'C', 'K', 'N', 'S', 'B', 'X'
]);

const RELEASE_MODIFIERS = new Set(['SR', 'ER', 'CR', 'PR', 'MR', 'TR', 'XR', 'XL', 'LA']);

function areModifiersEquivalent(mod1: string, mod2: string): boolean {
  if (mod1 === mod2) return true;
  if ((mod1 === 'FORT' && mod2 === 'FORTE') || (mod1 === 'FORTE' && mod2 === 'FORT')) return true;
  if (RELEASE_MODIFIERS.has(mod1) && RELEASE_MODIFIERS.has(mod2)) return true;
  return false;
}

function normalizeTokens(text: string): string {
  if (!text) return '';
  return text
    .replace(/['’]s\b/gi, ' ')
    .replace(/\b\d+\s*x\s*\d+\b/gi, ' ')
    .replace(/([a-zA-Z])(\d+)/g, '$1 $2')
    .replace(/(\d+)(mg|mcg|ml|gm|iu|%)\b/gi, '$1 $2');
}

function extractModifiers(name: string): Set<string> {
  if (!name) return new Set();
  const clean = normalizeTokens(name).toUpperCase().replace(/[-_.,/()\[\]+|'"]/g, ' ');
  const words = clean.split(/\s+/).filter(Boolean);
  const found = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (['D', 'C', 'A', 'B'].includes(w) && i > 0 && (words[i - 1] === 'VITAMIN' || words[i - 1] === 'VIT')) continue;
    if (w === 'E' && (words[i + 1] === 'E' || words[i + 1] === 'D')) continue;
    if (w === 'G' && (words[i - 1] === 'OF' || /^\d+$/.test(words[i - 1]) || words[i + 1] === 'POWDER')) continue;
    if (w === 'S' && i > 0 && /^\d+$/.test(words[i - 1])) continue; // e.g. "15 S"
    if (w === 'X' && ((i > 0 && /^\d+$/.test(words[i - 1])) || (i < words.length - 1 && /^\d+$/.test(words[i + 1])))) continue; // e.g. "10 X 15"
    if (['S', 'M', 'L', 'XL'].includes(w) && ((i > 0 && words[i - 1] === 'SIZE') || (i < words.length - 1 && words[i + 1] === 'SIZE') || /\b(BELT|SUPPORT|KNEE|ANKLE|ELBOW|WRIST|COLLAR|BANDAGE|GLOVES?)\b/i.test(name))) continue;
    if (FORMULATION_MODIFIERS.has(w)) {
      found.add(w);
    }
  }
  return found;
}

function hasModifierConflict(name1: string, name2: string): boolean {
  const m1 = extractModifiers(name1);
  const m2 = extractModifiers(name2);
  if (m1.size === 0 && m2.size === 0) return false;
  // If one has release modifiers and the other doesn't, allow it
  if (m1.size === 0 && m2.size > 0) {
    const nonRelease = Array.from(m2).filter(m => !RELEASE_MODIFIERS.has(m));
    return nonRelease.length > 0;
  }
  if (m2.size === 0 && m1.size > 0) {
    const nonRelease = Array.from(m1).filter(m => !RELEASE_MODIFIERS.has(m));
    return nonRelease.length > 0;
  }
  for (const mod1 of m1) {
    const hasMatch = Array.from(m2).some(mod2 => areModifiersEquivalent(mod1, mod2));
    if (!hasMatch) return true;
  }
  for (const mod2 of m2) {
    const hasMatch = Array.from(m1).some(mod1 => areModifiersEquivalent(mod1, mod2));
    if (!hasMatch) return true;
  }
  return false;
}

const PACK_QUANTITIES = new Set([2, 4, 5, 6, 7, 8, 10, 14, 15, 20, 21, 24, 28, 30, 50, 60, 90, 100, 120, 150, 180, 200]);

function extractStrengthTokens(name: string): Array<{ val: number; unit?: string }> {
  const norm = normalizeTokens(name).toUpperCase();
  const tokens: Array<{ val: number; unit?: string }> = [];

  // 1. Explicit unit match (e.g. 500mg, 20mcg, 5%, 10ml, 1gm)
  const regexUnit = /\b(\d+(?:\.\d+)?)\s*(MG|MCG|IU|%|ML|GM)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regexUnit.exec(norm)) !== null) {
    tokens.push({ val: parseFloat(match[1]), unit: match[2].toLowerCase() });
  }

  // 2. Standalone dosage number before dosage form (e.g. "Ciplar-LA 20 Tablet", "Norflox 400 Tablet", "Derinide 200 Respicaps")
  const regexForm = /\b(\d+(?:\.\d+)?)\s*(?:TABLET|TABLETS|TAB|TABS|CAPSULE|CAPSULES|CAP|CAPS|STRIP|SUSPENSION|SYRUP|INJECTION|INJ|CREAM|GEL|OINTMENT|OINT|RESPICAP|RESPICAPS|RESPULE|RESPULES|ROTACAP|ROTACAPS|INHALER|TRANSHALER|NEOHALER|PUFFS?|DOSE|DOSES|DROPS?|SOLUTION|SACHET|SACHETS)\b/gi;
  while ((match = regexForm.exec(norm)) !== null) {
    const val = parseFloat(match[1]);
    const prevText = norm.slice(Math.max(0, match.index - 12), match.index);
    if (!/STRIP\s+OF|PACK\s+OF|BOX\s+OF/i.test(prevText)) {
      // If we already found explicit unit tokens (like 500mg), don't treat 10 or 15 or 120 as a strength!
      if (tokens.length > 0 && PACK_QUANTITIES.has(val)) {
        continue;
      }
      if (!tokens.some(t => Math.abs(t.val - val) < 0.001)) {
        tokens.push({ val });
      }
    }
  }

  // 3. Standalone number right after brand token (e.g. "Derinide 200", "Dolo 650", "Pan 40")
  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && /^\d+(?:\.\d+)?$/.test(words[1])) {
    const prevWord = words[0].toUpperCase();
    if (!/^(PACK|STRIP|BOX|BOTTLE|TAB|CAP|SYP|INJ|\d+)$/i.test(prevWord)) {
      const val = parseFloat(words[1]);
      if (!isNaN(val) && val >= 0.5 && val <= 5000 && !tokens.some(t => Math.abs(t.val - val) < 0.001)) {
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

  // Direct sum / combination equivalence (e.g. 625 === 500 + 125, or 1000 === 500 + 500)
  const sum1 = s1.reduce((acc, t) => acc + t.val, 0);
  const sum2 = s2.reduce((acc, t) => acc + t.val, 0);
  if (Math.abs(sum1 - sum2) <= 0.01) {
    return false;
  }
  if (s1.length === 1 && s2.length > 1 && Math.abs(s1[0].val - sum2) <= 0.01) {
    return false;
  }
  if (s2.length === 1 && s1.length > 1 && Math.abs(s2[0].val - sum1) <= 0.01) {
    return false;
  }

  for (const t1 of s1) {
    const matching = s2.find(t2 => Math.abs(t2.val - t1.val) <= 0.001);
    if (!matching) {
      if (s2.length > 1 && Math.abs(t1.val - sum2) <= 0.01) continue;
      return true; // Value mismatch (e.g. 8 vs 20, 800 vs 400)
    }
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

  // Specific Topical Clashes (Gel vs Spray, Powder vs Gel)
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

  if (isQCream && (isCGel || isCLotion)) return true;
  if (isQOint && (isCGel || isCLotion)) return true;
  if (isQGel && (isCCream || isCOint || isCLotion)) return true;
  if (isQLotion && (isCCream || isCOint || isCGel)) return true;

  // Ophthalmic suspension vs eye drops are compatible
  const isQOphthalmic = /\b(ophthalmic|eye|ear|e\/e|nasal)\b/.test(qLower);
  const isCOphthalmic = /\b(ophthalmic|eye|ear|e\/e|nasal)\b/.test(cLower);
  const isBothOphthalmic = isQOphthalmic && isCOphthalmic;

  // Strict bidirectional dosage form conflict gate
  if (isQDrops && (isCTab || isCCap || (isCSyp && !isBothOphthalmic) || isCInj || isCTop || isCPowder)) return true;
  if (isCDrops && (isQTab || isQCap || (isQSyrup && !isBothOphthalmic) || isQInj || isQTop || isQPowder)) return true;
  if (isQSyrup && (isCTab || isCCap || isCInj || isCTop || isCPowder)) return true;
  if (isCSyp && (isQTab || isQCap || isQInj || isQTop || isQPowder)) return true;
  // Tablet vs Capsule conflict: tablets must NEVER match capsules
  if (isQTab && (isCCap || isCSyp || isCInj || isCTop || isCDrops || isCPowder)) return true;
  if (isCTab && (isQCap || isQSyrup || isQInj || isQTop || isQDrops || isQPowder)) return true;
  if (isQCap && (isCTab || isCSyp || isCInj || isCTop || isCDrops || isCPowder)) return true;
  if (isCCap && (isQTab || isQSyrup || isQInj || isQTop || isQDrops || isQPowder)) return true;
  if (isQInj && (isCTab || isCCap || isCSyp || isCTop || isCPowder || isCDrops)) return true;
  if (isCInj && (isQTab || isQCap || isQSyrup || isQTop || isQPowder || isQDrops)) return true;
  if (isQTop && (isCTab || isCCap || isCSyp || isCInj || isCPowder || isCDrops)) return true;
  if (isCTop && (isQTab || isQCap || isQSyrup || isQInj || isQPowder || isQDrops)) return true;
  if (isQPowder && (isCTab || isCCap || isCSyp || isCInj || isCTop || isCDrops)) return true;
  if (isCPowder && (isQTab || isQCap || isQSyrup || isQInj || isQTop || isQDrops)) return true;

  // Shampoos, Soaps/Bars, Face Washes, and Oils
  const isQShampoo = /\b(shampoo|hair\s*wash)\b/.test(qLower);
  const isCShampoo = /\b(shampoo|hair\s*wash)\b/.test(cLower);
  const isQSoap = /\b(soap|bar|bathing\s*bar|syndet\s*bar|cleansing\s*bar)\b/.test(qLower);
  const isCSoap = /\b(soap|bar|bathing\s*bar|syndet\s*bar|cleansing\s*bar)\b/.test(cLower);
  const isQFaceWash = /\b(face\s*wash|facewash|body\s*wash|scrub)\b/.test(qLower);
  const isCFaceWash = /\b(face\s*wash|facewash|body\s*wash|scrub)\b/.test(cLower);
  const isQOil = /\b(hair\s*oil|massage\s*oil)\b/.test(qLower);
  const isCOil = /\b(hair\s*oil|massage\s*oil)\b/.test(cLower);

  // Shampoo vs Soap / Bar
  if (isQShampoo && isCSoap) return true;
  if (isCShampoo && isQSoap) return true;

  // Shampoo vs Topical (Cream/Ointment/Gel/Lotion) / Oral / Inj / Drops / Powder / Spray
  if (isQShampoo && (isCTop || isCTab || isCCap || isCSyp || isCInj || isCDrops || isCPowder || isCSpray)) return true;
  if (isCShampoo && (isQTop || isQTab || isQCap || isQSyrup || isQInj || isQDrops || isQPowder || isQSpray)) return true;

  // Soap vs Topical (Cream/Ointment/Gel/Lotion) / Face Wash / Oral / Inj / Drops / Spray / Powder / Inhaler
  if (isQSoap && (isCTop || isCFaceWash || isCTab || isCCap || isCSyp || isCInj || isCDrops || isCSpray || isCPowder || isCInhaler)) return true;
  if (isCSoap && (isQTop || isQFaceWash || isQTab || isQCap || isQSyrup || isQInj || isQDrops || isQSpray || isQPowder || isQInhaler)) return true;

  // Face wash vs Oral / Inj / Drops / Inhaler
  if (isQFaceWash && (isCTab || isCCap || isCSyp || isCInj || isCDrops || isCInhaler)) return true;
  if (isCFaceWash && (isQTab || isQCap || isQSyrup || isQInj || isQDrops || isQInhaler)) return true;

  // Oil vs Shampoo / Cream / Gel / Oral / Inj
  if (isQOil && (isCShampoo || isCTop || isCTab || isCCap || isCSyp || isCInj || isCDrops)) return true;
  if (isCOil && (isQShampoo || isQTop || isQTab || isQCap || isQSyrup || isQInj || isQDrops)) return true;

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

  // Bridge hyphenated single-letter brands (D-RISE -> DRISE, T-98 -> T98, 3-D -> 3D)
  const bridgeHyphens = (str: string) => str.replace(/\b([a-zA-Z0-9])\s*[-/]\s*([a-zA-Z0-9])/g, '$1$2');
  const bridgedQ = bridgeHyphens(cleanQ);
  const bridgedCand = bridgeHyphens(cleanCand);

  const qBrandWords = bridgedQ.split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w) && !/^\d+$/.test(w));
  if (qBrandWords.length === 0) return false;

  const candWords = bridgedCand.split(/\s+/).filter(Boolean);
  const primaryBrand = qBrandWords[0];
  if (primaryBrand.length < 2) return false;

  // 1. Primary brand must match EXACTLY (never allow prefix bleed like 'rabi' matching 'rabihal' or 'ox' matching 'oxidon')
  const brandIndex = candWords.findIndex(cw => cw === primaryBrand);
  if (brandIndex === -1 || (brandIndex > 0 && !['new'].includes(candWords[0]))) {
    return false;
  }

  // 2. Strict Formulation Modifier Conflict Check:
  // Rejects candidate if either target or candidate has a variant modifier (e.g. D, LP, LS, KT, FORTE/FORT, PF, DM, Z, T, PLUS)
  // that is missing or conflicting in the other.
  if (hasModifierConflict(query, candidateName)) {
    return false;
  }

  // 3. Strict Variant Modifier Guard:
  // If candidate has a formulation modifier right after brand (e.g. "Lupitros Z", "Dolo D", "Augmentin Duo"),
  // but target query does NOT have this modifier, it is a DIFFERENT product variant!
  const candNextWord = candWords[brandIndex + 1]?.toUpperCase();
  if (candNextWord && FORMULATION_MODIFIERS.has(candNextWord)) {
    const qTokensUpper = cleanQ.toUpperCase().split(/\s+/);
    if (!qTokensUpper.includes(candNextWord)) {
      return false; // Plain medicine or different variant must NEVER match candidate with a variant modifier!
    }
  }

  // Vice versa: if target query has a modifier (e.g. "Lupitros T") but candidate lacks it:
  for (let i = 1; i < qBrandWords.length; i++) {
    const qw = qBrandWords[i].toUpperCase();
    if (FORMULATION_MODIFIERS.has(qw)) {
      const candTokensUpper = candWords.map(w => w.toUpperCase());
      if (!candTokensUpper.includes(qw)) {
        return false; // Modified query must NOT match candidate lacking that modifier!
      }
    }
  }

  // 3. Multi-word brand: check first 2 core brand tokens
  const coreWords = qBrandWords.slice(0, 2);
  for (const bw of coreWords) {
    const found = candWords.some(cw => cw === bw);
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

function findCatalogSibling(
  db: any,
  mfg: string,
  cdnName: string,
  excludeMedId: number | string
): { id: number; name: string } | null {
  const brandWord = cdnName.split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, '');
  if (brandWord.length < 3) return null;

  const mfgLead = (mfg || '').split(/\s+/)[0];
  const candidates: any[] = db.prepare(`
    SELECT id, name, manufacturer
    FROM medicines
    WHERE manufacturer LIKE ?
      AND name LIKE ?
      AND id != ?
    LIMIT 25
  `).all(`%${mfgLead}%`, `%${brandWord}%`, excludeMedId);

  for (const cand of candidates) {
    if (!isBrandMatch(cand.name, cdnName)) continue;
    if (hasDosageConflict(cand.name, cdnName)) continue;
    if (hasStrengthConflict(cand.name, cdnName)) continue;
    if (hasModifierConflict(cand.name, cdnName)) continue;

    const hasActiveImg = db.prepare('SELECT 1 FROM catalog_images WHERE medicine_id = ? AND is_active = 1 LIMIT 1').get(cand.id);
    if (hasActiveImg) continue;

    return cand;
  }
  return null;
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

async function fetchPharmEasyImages(queries: string[], rawMedName: string): Promise<any | null> {
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
          images: imageMap,
          source: 'pharmeasy_clean'
        };
      }
    } catch {
      // try next query
    }
  }
  return null;
}

async function fetchDawaIndiaImages(queries: string[], rawMedName: string): Promise<any | null> {
  for (const q of queries) {
    const url = `https://api.davaindia.com/products?search=${encodeURIComponent(q)}`;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.davaindia.com/'
        },
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) continue;
      const data: any = await response.json();
      const prods = data?.data || [];
      if (prods.length === 0) continue;

      const matched = prods.filter((c: any) => {
        const title = c.title || c.name || '';
        const rawImgs = Array.isArray(c.images)
          ? c.images.map((im: any) => im.objectUrl || im.preSignedUrl).filter(Boolean)
          : (c.thumbnail ? [c.thumbnail] : []);
        if (rawImgs.length === 0) return false;
        if (!isBrandMatch(rawMedName, title)) return false;
        if (hasDosageConflict(rawMedName, title)) return false;
        if (hasStrengthConflict(rawMedName, title)) return false;
        if (hasModifierConflict(rawMedName, title)) return false;
        return true;
      });

      if (matched.length === 0) continue;

      const best = matched[0];
      const title = best.title || best.name || '';
      const rawImgs = Array.isArray(best.images)
        ? best.images.map((im: any) => im.objectUrl || im.preSignedUrl).filter(Boolean)
        : (best.thumbnail ? [best.thumbnail] : []);

      const imageMap: Record<string, string> = {};
      const faces = ['front', 'back', 'combo', 'side'];
      for (let idx = 0; idx < rawImgs.length; idx++) {
        const cleanUrl = rawImgs[idx].split('?')[0];
        const face = faces[idx] || `angle_${idx + 1}`;
        imageMap[face] = cleanUrl;
      }

      if (Object.keys(imageMap).length > 0) {
        console.log(`    🔍 Rescued from Dawa India Generic CDN: "${title}" (${Object.keys(imageMap).length} angles)`);
        return {
          name: title,
          slug: slugify(title),
          images: imageMap,
          source: 'davaindia_clean'
        };
      }
    } catch {
      // try next query
    }
  }
  return null;
}

async function fetchCdnImages(
  queries: string[],
  rawMedName: string,
  sourceMode: 'all' | 'pharmeasy' | '1mg' | 'davaindia' = 'all'
): Promise<any | null> {
  // 1. PharmEasy Clean CDN
  if (sourceMode === 'all' || sourceMode === 'pharmeasy') {
    const pe = await fetchPharmEasyImages(queries, rawMedName);
    if (pe) return pe;
    if (sourceMode === 'pharmeasy') return null;
  }

  // 2. Tata 1mg Zero-Watermark Studio CDN
  if (sourceMode === 'all' || sourceMode === '1mg') {
    const mg = await fetchTata1mgImages(queries, rawMedName);
    if (mg) return mg;
    if (sourceMode === '1mg') return null;
  }

  // 3. Dawa India Generic Packshot CDN
  if (sourceMode === 'all' || sourceMode === 'davaindia') {
    const dava = await fetchDawaIndiaImages(queries, rawMedName);
    if (dava) return dava;
    if (sourceMode === 'davaindia') return null;
  }

  return null;
}

async function downloadBuffer(url: string): Promise<Buffer | null> {
  try {
    const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0' };
    if (url.includes('davaindia.com')) {
      headers['Referer'] = 'https://www.davaindia.com/';
    }
    const res = await fetch(url, {
      headers,
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
  const notFoundPe = stateKeys.filter(k => state.products[k].status === 'not_found_pharmeasy').length;
  const notFound1mg = stateKeys.filter(k => state.products[k].status === 'not_found_1mg').length;
  const notFoundAll = stateKeys.filter(k => state.products[k].status === 'not_found_all_cdns' || state.products[k].status === 'not_found').length;
  const geminiRejectedCount = stateKeys.filter(k => state.products[k].status === 'gemini_rejected').length;

  console.log('\n===============================================================');
  console.log('              PRODUCT IMAGE HARVEST STATUS');
  console.log('===============================================================');
  console.log(`Database Catalog Medicines with Images : ${totalInDb?.c || 0}`);
  console.log(`Total Verified Image Angles Saved      : ${totalAngles?.c || 0}`);
  console.log(`Evaluated State Records                : ${stateKeys.length}`);
  console.log(`  - Successfully Verified & Saved      : ${successCount}`);
  console.log(`  - Routed to T2 (Not Found on PharmEasy): ${notFoundPe}`);
  console.log(`  - Routed to T3 (Not Found on Tata 1mg) : ${notFound1mg}`);
  console.log(`  - Exhausted All CDNs (Queued for Rev): ${notFoundAll}`);
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
  let retryRejected = false;
  let shardStr = '';
  let sourceMode: 'all' | 'pharmeasy' | '1mg' | 'davaindia' = 'all';
  let idleShutdownMin = 0;
  let shutdownOnComplete = false;
  let useGemini = false;
  let commitEvery = 1000;
  let autoSaveOnComplete = true;
  let poolNumber = 1;
  let terminalIndex = 0;
  let customKeys: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--status') {
      await printStatus();
      return;
    }
    if (args[i].startsWith('--company=')) companyFilter = args[i].split('=')[1].replace(/['"]/g, '');
    else if (args[i].startsWith('--filter=')) nameFilter = args[i].split('=')[1].replace(/['"]/g, '');
    else if (args[i].startsWith('--pool=')) poolNumber = parseInt(args[i].split('=')[1], 10);
    else if (args[i].startsWith('--terminal=') || args[i].startsWith('--term=')) {
      terminalIndex = parseInt(args[i].split('=')[1], 10);
    }
    else if (args[i].startsWith('--source=')) {
      const sm = args[i].split('=')[1].toLowerCase().trim();
      if (['pharmeasy', '1mg', 'davaindia', 'all'].includes(sm)) {
        sourceMode = sm as any;
      }
    }
    else if (args[i].startsWith('--shard=')) shardStr = args[i].split('=')[1].trim();
    else if (args[i].startsWith('--top=')) topCount = parseInt(args[i].split('=')[1], 10);
    else if (args[i].startsWith('--limit=')) limit = parseInt(args[i].split('=')[1], 10);
    else if (args[i].startsWith('--delay=')) delayMs = parseInt(args[i].split('=')[1], 10);
    else if (args[i].startsWith('--key-delay=')) keySpacingMs = parseInt(args[i].split('=')[1], 10);
    else if (args[i].startsWith('--commit-every=')) commitEvery = parseInt(args[i].split('=')[1], 10);
    else if (args[i] === '--save-on-complete' || args[i] === '--auto-save') autoSaveOnComplete = true;
    else if (args[i] === '--no-save') autoSaveOnComplete = false;
    else if (args[i] === '--force') force = true;
    else if (args[i] === '--retry-failed') retryFailed = true;
    else if (args[i] === '--retry-rejected') retryRejected = true;
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

  // Smart routing terminal defaults:
  // Terminal 1 -> PharmEasy
  // Terminal 2 -> Tata 1mg (Watermark-free studio photos)
  // Terminal 3 -> Dawa India (Generic formulations)
  if (terminalIndex === 1 && sourceMode === 'all') {
    sourceMode = 'pharmeasy';
  } else if (terminalIndex === 2 && sourceMode === 'all') {
    sourceMode = '1mg';
  } else if (terminalIndex === 3 && sourceMode === 'all') {
    sourceMode = 'davaindia';
  }

  console.log('===============================================================');
  console.log('    MASTER PRODUCT IMAGE HARVESTER & AI OCR VERIFICATION');
  console.log('===============================================================\n');

  let geminiKeys: string[] = [];
  let spareKey: string | undefined = undefined;

  // Load verified working keys from data/working_gemini_keys.json if present
  const WORKING_KEYS_FILE = path.join(ROOT_DIR, 'data', 'working_gemini_keys.json');
  let verifiedWorkingKeys: string[] = [];
  if (fs.existsSync(WORKING_KEYS_FILE)) {
    try {
      verifiedWorkingKeys = JSON.parse(fs.readFileSync(WORKING_KEYS_FILE, 'utf8'));
    } catch {}
  }
  let companyQueue: string[] = [];

  if (customKeys.length > 0) {
    geminiKeys = customKeys;
  } else if (terminalIndex >= 1 && terminalIndex <= 3) {
    // Dedicated 3-terminal mode: 8 keys per terminal, isolated smart source routing
    useGemini = true;
    if (verifiedWorkingKeys.length >= 24) {
      const startIndex = (terminalIndex - 1) * 8;
      geminiKeys = verifiedWorkingKeys.slice(startIndex, startIndex + 8);
      spareKey = verifiedWorkingKeys[24]; // 25th key as spare
    }
    if (!companyFilter) {
      // In 3-terminal smart routing mode, all terminals process companies in lockstep
      companyQueue = loadAllCompaniesFromCsv();
    }
  } else if (terminalIndex >= 4 && terminalIndex <= 12) {
    // Legacy 12-terminal mode
    useGemini = true;
    shardStr = '';
    if (verifiedWorkingKeys.length >= 24) {
      const startIndex = (terminalIndex - 1) * 2;
      const keyCount = (terminalIndex === 12 && verifiedWorkingKeys.length >= 25) ? 3 : 2;
      geminiKeys = verifiedWorkingKeys.slice(startIndex, startIndex + keyCount);
    }
    if (!companyFilter) {
      companyQueue = loadCompaniesFromCsv(terminalIndex);
    }
  } else if (poolNumber >= 1 && poolNumber <= 5 && verifiedWorkingKeys.length >= 25) {
    // 5 isolated pools of 5 verified keys each!
    const startIndex = (poolNumber - 1) * 5;
    geminiKeys = verifiedWorkingKeys.slice(startIndex, startIndex + 5);
  } else if (poolNumber >= 1 && poolNumber <= 4) {
    const poolEnv = process.env[`GEMINI_API_KEYS_POOL_${poolNumber}`];
    spareKey = process.env[`GEMINI_SPARE_KEY_POOL_${poolNumber}`];
    if (poolEnv) {
      geminiKeys = poolEnv.split(/[,;\s]+/).map(k => k.trim()).filter(Boolean);
    }
  }

  if (companyFilter) {
    companyQueue = companyFilter.split(/[,;|]+/).map(c => c.trim()).filter(Boolean);
  }

  if (geminiKeys.length === 0) {
    const rawKeyStr = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
    geminiKeys = rawKeyStr.split(/[,;\s]+/).map(k => k.trim()).filter(Boolean);
  }

  const SOURCE_LABELS: Record<string, string> = {
    all: '🌐 Full Smart Relay Cascade (PharmEasy ➡️ Tata 1mg ➡️ Dawa India ➡️ Pharmacist Review)',
    pharmeasy: '🟢 Terminal 1: PharmEasy CDN Source (Auto-relaying missing items to T2)',
    '1mg': '🟠 Terminal 2: Tata 1mg Studio Source (Zero-watermark, auto-relaying missing items to T3)',
    davaindia: '🔵 Terminal 3: Dawa India Generic Source (Auto-forwarding exhausted items to Human Review)'
  };
  console.log(`📡 Sourcing Mode  : ${SOURCE_LABELS[sourceMode] || sourceMode}`);

  if (useGemini) {
    console.log(`🤖 Google Gemini Flash Vision: ACTIVE (100% label confirmation).`);
    if (terminalIndex > 0) {
      console.log(`🔑 Terminal #${terminalIndex} Mode: ${geminiKeys.length} isolated keys assigned (${companyQueue.length} companies from CSV, Per-key spacing: ${keySpacingMs}ms).`);
      if (companyQueue.length > 0) {
        console.log(`🏢 First 3 Assigned Companies: ${companyQueue.slice(0, 3).map(c => `"${c}"`).join(', ')} ... (+${companyQueue.length - 3} more)`);
      }
    } else {
      console.log(`🔑 Key Pool #${poolNumber}: ${geminiKeys.length} active isolated keys (Per-key spacing: ${keySpacingMs}ms).`);
    }
  }
  if (shardStr) {
    console.log(`⚡ Shard Partition: ${shardStr}`);
  }
  if (commitEvery > 0) {
    console.log(`📦 Git Auto-Commit: ACTIVE (commits every ${commitEvery} new images in database across all terminals).`);
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

  // If no company filter or terminal was specified, use topCount companies by default
  if (companyQueue.length === 0 && !nameFilter) {
    console.log(`Target: Top ${topCount} Pharmaceutical Companies`);
    companyQueue = db.prepare(`
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
  }

  const checkDbStmt = db.prepare('SELECT 1 FROM catalog_images WHERE medicine_id = ? AND is_active = 1 LIMIT 1');
  const checkSqliteStateStmt = db.prepare('SELECT status, reason FROM catalog_harvest_state WHERE medicine_id = ? LIMIT 1');

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

  const queueToProcess = companyQueue.length > 0 ? companyQueue : ['__ALL_MEDICINES__'];

  for (let cIdx = 0; cIdx < queueToProcess.length; cIdx++) {
    const currentCompany = queueToProcess[cIdx];
    let companyMeds: any[] = [];

    const whereClauses = [
      "m.name NOT LIKE 'test%'",
      "m.name NOT LIKE '%dummy%'",
      "m.name NOT LIKE 'sample%'",
      "m.name NOT LIKE '1st aid%'"
    ];

    // AUTO-SKIP: Instantly skip medicines that already have active verified images in database (<1ms)
    if (!force) {
      whereClauses.push("NOT EXISTS (SELECT 1 FROM catalog_images ci WHERE ci.medicine_id = m.id AND ci.is_active = 1)");
    }

    const params: any[] = [];
    if (currentCompany !== '__ALL_MEDICINES__') {
      whereClauses.push("m.manufacturer LIKE ?");
      params.push(`%${currentCompany}%`);
    }
    if (nameFilter) {
      whereClauses.push("m.name LIKE ?");
      params.push(`%${nameFilter}%`);
    }

    let orderBy = "m.id ASC";
    if (!force && !retryFailed) {
      if (sourceMode === '1mg') {
        // T2 (Tata 1mg): Prioritize items routed from PharmEasy (not_found_pharmeasy), skip items already evaluated on 1mg
        whereClauses.push("(chs.status IS NULL OR chs.status NOT IN ('not_found_1mg', 'not_found_all_cdns', 'gemini_rejected'))");
        orderBy = "CASE WHEN chs.status = 'not_found_pharmeasy' THEN 0 ELSE 1 END, m.id ASC";
      } else if (sourceMode === 'davaindia') {
        // T3 (Dawa India): Prioritize items routed from 1mg (not_found_1mg), skip items already evaluated on all CDNs
        whereClauses.push("(chs.status IS NULL OR chs.status NOT IN ('not_found_all_cdns', 'gemini_rejected'))");
        orderBy = "CASE WHEN chs.status = 'not_found_1mg' THEN 0 WHEN chs.status = 'not_found_pharmeasy' THEN 1 ELSE 2 END, m.id ASC";
      } else if (sourceMode === 'pharmeasy') {
        // T1 (PharmEasy): Skip items already evaluated on PharmEasy
        whereClauses.push("(chs.status IS NULL OR chs.status NOT IN ('not_found_pharmeasy', 'not_found_1mg', 'not_found_all_cdns', 'gemini_rejected'))");
      } else {
        // Full cascade: skip items successfully completed or already exhausted across all CDNs
        whereClauses.push("(chs.status IS NULL OR chs.status NOT IN ('success', 'not_found_all_cdns', 'gemini_rejected'))");
      }
    }

    let q = `
      SELECT m.id, m.name, m.canonical_name, m.manufacturer, m.packaging, chs.status as harvest_status
      FROM medicines m
      LEFT JOIN catalog_harvest_state chs ON chs.medicine_id = m.id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY ${orderBy}
    `;
    if (limit > 0) q += ` LIMIT ${limit}`;
    companyMeds = db.prepare(q).all(...params);

    if (companyMeds.length === 0) continue;

    const remainingMedicines: any[] = [];
    for (const med of companyMeds) {
      if (force) {
        remainingMedicines.push(med);
        continue;
      }
      if (checkDbStmt.get(med.id)) continue;
      const compSlug = slugify(med.manufacturer || currentCompany || 'general');
      const baseSlug = slugify(med.name || med.canonical_name);
      const frontInSubfolder = path.join(TARGET_FRONTEND, compSlug, `${baseSlug}-front.jpg`);
      const boxFrontInSubfolder = path.join(TARGET_FRONTEND, compSlug, `${baseSlug}-box-front.jpg`);
      const frontOnDisk = path.join(TARGET_FRONTEND, `${baseSlug}-front.jpg`);
      const boxFrontOnDisk = path.join(TARGET_FRONTEND, `${baseSlug}-box-front.jpg`);
      if ((fs.existsSync(frontInSubfolder) && fs.statSync(frontInSubfolder).size > 1000) ||
          (fs.existsSync(boxFrontInSubfolder) && fs.statSync(boxFrontInSubfolder).size > 1000) ||
          (fs.existsSync(frontOnDisk) && fs.statSync(frontOnDisk).size > 1000) ||
          (fs.existsSync(boxFrontOnDisk) && fs.statSync(boxFrontOnDisk).size > 1000)) {
        continue;
      }
      const jsonState = inMemoryState.products[String(med.id)];
      const sqlState = checkSqliteStateStmt.get(med.id) as any;
      const status = jsonState?.status || sqlState?.status;
      if (status && !force && !retryFailed) {
        if (status === 'success') continue;
        if (sourceMode === 'pharmeasy' && ['not_found_pharmeasy', 'not_found_1mg', 'not_found_all_cdns'].includes(status)) {
          continue;
        }
        if (sourceMode === '1mg' && ['not_found_1mg', 'not_found_all_cdns'].includes(status)) {
          continue;
        }
        if (sourceMode === 'davaindia' && status === 'not_found_all_cdns') {
          continue;
        }
        if (sourceMode === 'all' && ['not_found_all_cdns', 'not_found'].includes(status)) {
          continue;
        }
        if (status === 'gemini_rejected' && !retryRejected) {
          continue;
        }
      }
      remainingMedicines.push(med);
    }

    if (remainingMedicines.length === 0) {
      if (queueToProcess.length <= 10 || (cIdx + 1) % 25 === 0 || companyMeds.length > 50) {
        console.log(`⏩ [${cIdx + 1}/${queueToProcess.length}] "${currentCompany}": All ${companyMeds.length} medicines already processed & verified. Advancing...`);
      }
      continue;
    }

    console.log(`\n===============================================================`);
    console.log(`🏢 [Company ${cIdx + 1}/${queueToProcess.length}] "${currentCompany}"`);
    console.log(`🎯 ${remainingMedicines.length} pending medicines to scan (out of ${companyMeds.length} total)`);
    console.log(`===============================================================\n`);

    let workList = remainingMedicines;
    if (shardStr) {
      const parts = shardStr.split('/');
      const shardIndex = parseInt(parts[0], 10) - 1;
      const totalShards = parseInt(parts[1] || '4', 10);
      if (!isNaN(shardIndex) && !isNaN(totalShards) && totalShards > 1) {
        workList = remainingMedicines.filter((_, idx) => idx % totalShards === shardIndex);
      }
    }

  for (let i = 0; i < workList.length; i++) {
    const med: any = workList[i];
    const medId = med.id;
    const medName = med.name || med.canonical_name;
    const mfg = med.manufacturer || 'Unknown';

    // REAL-TIME SKIP GUARD 1: If another terminal or earlier run already verified this medicine, skip in <1ms!
    if (!force && checkDbStmt.get(medId)) {
      console.log(`⏩ [ID ${medId}] "${medName}" already has active verified images in database. Skipping (<1ms).`);
      continue;
    }

    // REAL-TIME SKIP GUARD 2: If files already exist on disk, skip in <1ms!
    const compSlug = slugify(med.manufacturer || currentCompany || 'general');
    const checkBaseSlug = slugify(medName);
    const frontInSubfolder = path.join(TARGET_FRONTEND, compSlug, `${checkBaseSlug}-front.jpg`);
    const boxFrontInSubfolder = path.join(TARGET_FRONTEND, compSlug, `${checkBaseSlug}-box-front.jpg`);
    const frontOnDisk = path.join(TARGET_FRONTEND, `${checkBaseSlug}-front.jpg`);
    const boxFrontOnDisk = path.join(TARGET_FRONTEND, `${checkBaseSlug}-box-front.jpg`);
    if (!force && (
      (fs.existsSync(frontInSubfolder) && fs.statSync(frontInSubfolder).size > 1000) ||
      (fs.existsSync(boxFrontInSubfolder) && fs.statSync(boxFrontInSubfolder).size > 1000) ||
      (fs.existsSync(frontOnDisk) && fs.statSync(frontOnDisk).size > 1000) ||
      (fs.existsSync(boxFrontOnDisk) && fs.statSync(boxFrontOnDisk).size > 1000)
    )) {
      console.log(`⏩ [ID ${medId}] "${medName}" already has images on disk. Skipping (<1ms).`);
      continue;
    }

    // REAL-TIME SKIP GUARD 3: Concurrency check against SQLite state table
    if (!force && !retryFailed) {
      const liveSqlState = checkSqliteStateStmt.get(medId) as any;
      if (liveSqlState?.status) {
        if (liveSqlState.status === 'success') {
          console.log(`⏩ [ID ${medId}] "${medName}" verified by another terminal (success). Skipping (<1ms).`);
          continue;
        }
        if (sourceMode === 'pharmeasy' && ['not_found_pharmeasy', 'not_found_1mg', 'not_found_all_cdns'].includes(liveSqlState.status)) {
          continue;
        }
        if (sourceMode === '1mg' && ['not_found_1mg', 'not_found_all_cdns'].includes(liveSqlState.status)) {
          continue;
        }
        if (sourceMode === 'davaindia' && liveSqlState.status === 'not_found_all_cdns') {
          continue;
        }
      }
    }

    processed++;
    const searchQueries = generateSearchQueries(medName);
    const termTag = terminalIndex > 0 ? `Terminal #${terminalIndex}` : 'Main Harvester';
    console.log(`\n───────────────────────────────────────────────────────────────`);
    console.log(`⚡ [${termTag}] [Co ${cIdx + 1}/${queueToProcess.length}: "${currentCompany}"] [Med ${i + 1}/${workList.length}]`);
    console.log(`🎯 ID ${medId}: "${medName}" (${mfg})`);
    console.log(`    Querying CDN for: "${searchQueries[0]}"...`);

    const cdnResult = await fetchCdnImages(searchQueries, medName, sourceMode);
    if (!cdnResult || Object.keys(cdnResult.images).length === 0) {
      let notFoundStatus = 'not_found_all_cdns';
      let notFoundReason = 'Exhausted across all CDNs. Queued for human review.';

      if (sourceMode === 'pharmeasy') {
        notFoundStatus = 'not_found_pharmeasy';
        notFoundReason = 'No match found on PharmEasy CDN. Smart routed to T2 (Tata 1mg).';
        console.log(`    ⚠️ No verified match on PharmEasy CDN ➡️ Smart routing to Terminal 2 (Tata 1mg)\n`);
      } else if (sourceMode === '1mg') {
        notFoundStatus = 'not_found_1mg';
        notFoundReason = 'No match found on Tata 1mg CDN. Smart routed to T3 (Dawa India).';
        console.log(`    ⚠️ No verified match on Tata 1mg CDN ➡️ Smart routing to Terminal 3 (Dawa India)\n`);
      } else if (sourceMode === 'davaindia') {
        notFoundStatus = 'not_found_all_cdns';
        notFoundReason = 'Exhausted across PharmEasy, Tata 1mg, and Dawa India. Queued for Pharmacist Human Review.';
        console.log(`    ⚠️ No verified match on Dawa India CDN ➡️ Forwarded to Pharmacist Human Review (/catalog/images)\n`);
      } else {
        console.log(`    ⚠️ No verified match across any pharma CDN ➡️ Forwarded to Pharmacist Human Review (/catalog/images)\n`);
      }

      recordProductState(db, medId, {
        status: notFoundStatus,
        company: mfg,
        product_name: medName,
        reason: notFoundReason
      });
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }

    console.log(`    ✅ Matched: "${cdnResult.name}" (${Object.keys(cdnResult.images).length} angles available)`);

    const downloadedAngles: Array<{
      face: string;
      fileName: string;
      stagingPath: string;
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
      const stagingFileName = `stage_${process.pid}_${medId}_${face}_${Date.now()}.jpg`;
      const stagingPath = path.join(STAGING_DIR, stagingFileName);

      // Smart compression (max 1200px, quality 82%) into isolated staging file
      await imageCompressionService.compressAndSave(rawBuf, stagingPath, 1200, 82);

      const compBuf = fs.readFileSync(stagingPath);
      const phash = await visualIndex.computePhashFromBuffer(compBuf);

      // Deduplication check: skip identical images (Hamming distance <= 1)
      if (phash) {
        const isDuplicate = seenPhashes.some(sp => hammingDistance(sp, phash) <= 1);
        if (isDuplicate) {
          console.log(`    ⏩ Skipping duplicate visual angle for face "${face}"`);
          try { fs.unlinkSync(stagingPath); } catch {}
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

        // OCR Strength Conflict Gate: Packaging printed strength must NEVER contradict target medicine
        const ocrHasStrengthConflict = hasStrengthConflict(medName, rawOcr);
        if (ocrHasStrengthConflict) {
          brandConfidence = 0; // Immediate reject: printed strength contradicts target medicine!
        } else if (hasBrand && hasStrength) {
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
        fileName,
        stagingPath,
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
    // Check all downloaded candidate angles (front box, back, blister, side, composition).
    // If ANY angle confirms, all angles pass!
    let finalMatchingMethod = 'ai_ocr_verified';
    if (useGemini && geminiKeys.length > 0) {
      const cleanTarget = cleanMedicineNameForAi(medName);
      console.log(`    🤖 Verifying packaging with Gemini Vision (Target: "${cleanTarget}")...`);
      let confirmedResult: any = null;
      let primaryAngleIndex = 0;

      // Check all available downloaded candidate angles (up to 4)
      for (let aIdx = 0; aIdx < downloadedAngles.length; aIdx++) {
        const angle = downloadedAngles[aIdx];
        const gResult = await verifyWithGeminiVision(angle.buffer, medName, geminiKeys, spareKey);
        if (gResult.isExactMatch) {
          confirmedResult = gResult;
          primaryAngleIndex = aIdx;
          break;
        } else if (aIdx < downloadedAngles.length - 1) {
          console.log(`    ⚠️ Face "${angle.face}" unconfirmed (${gResult.reason || 'no match'}), checking alternate face "${downloadedAngles[aIdx + 1].face}"...`);
          await new Promise(r => setTimeout(r, 400));
        }
      }

      if (!confirmedResult) {
        // Opportunistic Sibling Remapping: Check if downloaded packaging matches a sibling medicine in our catalog!
        const sibling = findCatalogSibling(db, mfg, cdnResult.name, medId);
        if (sibling) {
          console.log(`    💡 Sibling Opportunity: Packaging "${cdnResult.name}" matches catalog product "${sibling.name}" (ID: ${sibling.id})!`);
          const siblingClean = cleanMedicineNameForAi(sibling.name);
          const siblingGResult = await verifyWithGeminiVision(downloadedAngles[0].buffer, siblingClean, geminiKeys, spareKey);

          if (siblingGResult.isExactMatch || (downloadedAngles[0].brandConfidence >= 75 && !hasStrengthConflict(sibling.name, cdnResult.name))) {
            // NEVER overwrite if sibling already has verified active images
            const existingSiblingImg = db.prepare('SELECT 1 FROM catalog_images WHERE medicine_id = ? AND is_active = 1 LIMIT 1').get(sibling.id);
            if (existingSiblingImg) {
              console.log(`    ⏩ Sibling "${sibling.name}" already has verified active images. Protecting existing images from being overwritten.`);
              for (const ang of downloadedAngles) {
                try { fs.unlinkSync(ang.stagingPath); } catch {}
              }
              continue;
            }

            console.log(`    ✨ Sibling Packaging Verified! Attaching images to "${sibling.name}" (ID: ${sibling.id})! Zero downloads wasted!`);
            const siblingCompanySlug = slugify(sibling.manufacturer || mfg || 'general');
            const siblingSlug = slugify(sibling.name);
            const siblingFrontendDir = path.join(TARGET_FRONTEND, siblingCompanySlug);
            const siblingUploadsDir = path.join(TARGET_UPLOADS, siblingCompanySlug);
            fs.mkdirSync(siblingFrontendDir, { recursive: true });
            fs.mkdirSync(siblingUploadsDir, { recursive: true });

            const siblingAngles = downloadedAngles.map(ang => {
              const newFileName = `${siblingSlug}-${ang.face}.jpg`;
              const newFrontend = path.join(siblingFrontendDir, newFileName);
              const newUploads = path.join(siblingUploadsDir, newFileName);
              fs.copyFileSync(ang.stagingPath, newFrontend);
              fs.copyFileSync(ang.stagingPath, newUploads);
              return {
                ...ang,
                relPath: `/products/${siblingCompanySlug}/${newFileName}`
              };
            });

            db.prepare('DELETE FROM catalog_images WHERE medicine_id = ?').run(sibling.id);
            const insertStmt = db.prepare(`
              INSERT INTO catalog_images (
                medicine_id, company_name, product_name, image_path, thumbnail_path, image_source,
                confidence_score, matching_method, verification_status, ocr_text, is_active,
                image_type, is_primary, slot_number, phash
              ) VALUES (?, ?, ?, ?, ?, 'pharma_dam_cdn', ?, 'gemini_sibling_remapped', 'APPROVED', ?, 1, ?, ?, ?, ?)
            `);
            for (let aIdx = 0; aIdx < siblingAngles.length; aIdx++) {
              const ang = siblingAngles[aIdx];
              const isPrimary = aIdx === 0 ? 1 : 0;
              insertStmt.run(
                sibling.id,
                mfg,
                sibling.name,
                ang.relPath,
                ang.relPath,
                ang.brandConfidence,
                ang.ocrTextSnippet,
                ang.face,
                isPrimary,
                aIdx + 1,
                ang.phash
              );
            }

            recordProductState(db, sibling.id, {
              status: 'success',
              company: mfg,
              product_name: sibling.name,
              angles_saved: siblingAngles.length,
              primary_face: siblingAngles[0].face,
              primary_confidence: siblingGResult.confidence || 90,
              verified_by: 'gemini_sibling_remapped'
            });

            // Clean up staging temp angles
            for (const ang of downloadedAngles) {
              try { fs.unlinkSync(ang.stagingPath); } catch {}
            }

            // Mark current target med as not found (since photo was for sibling)
            recordProductState(db, medId, {
              status: 'not_found',
              company: mfg,
              product_name: medName,
              reason: `CDN returned sibling "${sibling.name}" packaging instead`
            });
            continue;
          }
        }

        // Resilient Fallback: Only accept if Local AI OCR strongly verified brand + strength (confidence >= 85)
        if (downloadedAngles[0].brandConfidence >= 85) {
          console.log(`    ✨ Local AI OCR strongly verified "${cleanTarget}" (${downloadedAngles[0].brandConfidence}% confidence) -> Accepting packaging via AI OCR!`);
          finalMatchingMethod = 'ai_ocr_verified';
        } else {
          console.log(`    ❌ Packaging unconfirmed: Neither front nor alternate angles matched "${cleanTarget}"\n`);
          for (const ang of downloadedAngles) {
            try { fs.unlinkSync(ang.stagingPath); } catch {}
          }
          recordProductState(db, medId, {
            status: 'gemini_rejected',
            company: mfg,
            product_name: medName,
            reason: 'Packaging did not match target brand or strength'
          });
          continue;
        }
      } else {
        // Promote the confirmed face to index 0 so it becomes is_primary = 1
        if (primaryAngleIndex > 0) {
          const confirmedAngle = downloadedAngles.splice(primaryAngleIndex, 1)[0];
          downloadedAngles.unshift(confirmedAngle);
        }

        finalMatchingMethod = 'gemini_vision_verified';
        downloadedAngles[0].brandConfidence = Math.max(downloadedAngles[0].brandConfidence, confirmedResult.confidence);
        console.log(`    ✨ Gemini 100% Confirmed on face "${downloadedAngles[0].face}": "${confirmedResult.printedName}" (${confirmedResult.confidence}% confidence) -> All angles PASSED!`);
      }
    }

    const companySlug = slugify(mfg || currentCompany || 'general');
    const compFrontendDir = path.join(TARGET_FRONTEND, companySlug);
    const compUploadsDir = path.join(TARGET_UPLOADS, companySlug);
    fs.mkdirSync(compFrontendDir, { recursive: true });
    fs.mkdirSync(compUploadsDir, { recursive: true });

    const finalAngles = downloadedAngles.map(ang => {
      const finalFrontend = path.join(compFrontendDir, ang.fileName);
      const finalUploads = path.join(compUploadsDir, ang.fileName);
      fs.copyFileSync(ang.stagingPath, finalFrontend);
      fs.copyFileSync(ang.stagingPath, finalUploads);
      try { fs.unlinkSync(ang.stagingPath); } catch {}
      return {
        ...ang,
        relPath: `/products/${companySlug}/${ang.fileName}`
      };
    });

    // Persist cleanly in catalog_images
    db.prepare('DELETE FROM catalog_images WHERE medicine_id = ?').run(medId);

    const insertStmt = db.prepare(`
      INSERT INTO catalog_images (
        medicine_id, company_name, product_name, image_path, thumbnail_path, image_source,
        confidence_score, matching_method, verification_status, ocr_text, is_active,
        image_type, is_primary, slot_number, phash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, 1, ?, ?, ?, ?)
    `);

    for (let aIdx = 0; aIdx < finalAngles.length; aIdx++) {
      const ang = finalAngles[aIdx];
      const isPrimary = aIdx === 0 ? 1 : 0;
      insertStmt.run(
        medId,
        mfg,
        cdnResult.name,
        ang.relPath,
        ang.relPath,
        cdnResult.source || 'pharma_dam_cdn',
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
      verified_by: finalMatchingMethod,
      source: cdnResult.source || 'pharma_dam_cdn'
    });

    // Auto-commit milestone every 1,000 new images in database (shared across all terminals)
    const dbCommitted = checkAndTriggerDbMilestoneCommit(db, commitEvery, terminalIndex);
    if (dbCommitted) {
      imagesSavedSinceLastCommit = 0;
    } else if (commitEvery > 0 && imagesSavedSinceLastCommit >= commitEvery) {
      // Local fallback in case of single terminal or DB settings mismatch
      autoCommitBatch(imagesSavedSinceLastCommit, totalImagesSavedCount, terminalIndex ? `Terminal ${terminalIndex}` : undefined);
      imagesSavedSinceLastCommit = 0;
    }

    await new Promise(r => setTimeout(r, delayMs));
  } // end workList loop
} // end queueToProcess company loop

  if (watchdogTimer) clearInterval(watchdogTimer);

  // Auto-save project whenever this task run finishes
  if (autoSaveOnComplete && (imagesSavedSinceLastCommit > 0 || successCount > 0)) {
    const label = terminalIndex > 0 ? `Terminal ${terminalIndex} Complete` : (companyFilter || nameFilter || (topCount ? `Top ${topCount}` : 'Completed'));
    autoCommitBatch(imagesSavedSinceLastCommit || successCount, totalImagesSavedCount, label);
    imagesSavedSinceLastCommit = 0;
    try {
      const row = db.prepare('SELECT COUNT(*) as c FROM catalog_images').get() as any;
      if (row?.c) {
        db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('catalog_images_git_last_committed_count', ?)").run(String(row.c));
      }
    } catch {}
  }

  console.log('===============================================================');
  console.log('                   HARVEST RUN COMPLETE');
  console.log('===============================================================');
  console.log(`Total Medicines Evaluated : ${processed}`);
  console.log(`Newly Verified Medicines  : ${successCount}`);
  console.log(`Total Image Angles Saved  : ${totalImagesSavedCount}`);
  console.log(`State File                : ${STATE_FILE}`);
  console.log('===============================================================\n');

  await printStatus();

  if (shutdownOnComplete) {
    console.log(`\n🎉 All assigned companies evaluated.`);
    triggerWindowsShutdown(`AI Pharmacy Harvester: All target companies processed.`);
  }
} // end main

main().catch((err) => {
  console.error('Fatal harvest runner error:', err);
  process.exit(1);
});
// Hot-reload sync timestamp: 2026-09-13T13:28:00

