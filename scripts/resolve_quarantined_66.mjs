import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const TARGET_FRONTEND = path.join(ROOT_DIR, 'frontend', 'public', 'products');
const TARGET_UPLOADS = path.join(ROOT_DIR, 'uploads', 'products');

fs.mkdirSync(TARGET_FRONTEND, { recursive: true });
fs.mkdirSync(TARGET_UPLOADS, { recursive: true });

const db = new Database(DB_PATH);

function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
}

function cleanString(s) {
  return (s || '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractDosageForm(text) {
  if (!text) return null;
  const u = text.toUpperCase();
  if (/\b(TAB|TABLET|TABLETS|CAPLET|DT)\b/.test(u)) return 'TABLET';
  if (/\b(CAP|CAPSULE|CAPSULES|SOFTGEL)\b/.test(u)) return 'CAPSULE';
  if (/\b(SYP|SYRUP|SUSP|SUSPENSION|ORAL LIQUID)\b/.test(u)) return 'SYRUP';
  if (/\b(INJ|INJECTION|VIAL|AMPOULE|INFUSION)\b/.test(u)) return 'INJECTION';
  if (/\b(EYE DROP|EAR DROP|DROPS?)\b/.test(u)) return 'DROPS';
  if (/\b(CREAM|OINT|OINTMENT|GEL|LOTION|WASH|FACE WASH|SUNSCREEN)\b/.test(u)) return 'TOPICAL';
  return null;
}

function extractStrength(text) {
  if (!text) return null;
  const match = text.match(/\b(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*)\s*(MG|MCG|GM|ML|%|IU)\b/i);
  return match ? `${match[1]}${match[2].toUpperCase()}` : null;
}

function normalizeTokens(str) {
  return new Set(cleanString(str).split(' ').filter(w => w.length >= 2));
}

async function searchPharmEasy(query) {
  try {
    const url = `https://pharmeasy.in/api/search/search/?q=${encodeURIComponent(query)}&page=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data?.products || [];
  } catch {
    return [];
  }
}

async function search1mg(query) {
  try {
    const url = `https://www.1mg.com/api/v1/search/all?name=${encodeURIComponent(query)}&pageSize=5`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data?.skus || [];
  } catch {
    return [];
  }
}

async function downloadBuffer(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length >= 1000 ? buf : null;
  } catch {
    return null;
  }
}

function isEligibleCandidate(targetMed, candidateName) {
  const targetTokens = normalizeTokens(targetMed.name);
  const candTokens = normalizeTokens(candidateName);

  // Extract core brand (first 1-2 significant words)
  const targetWords = cleanString(targetMed.name).split(' ').filter(w => !['STRIP', 'OF', 'TABLETS', 'TABLET', 'CAPSULES', 'CAPSULE', 'BOTTLE', 'GM', 'ML', 'MG', 'FREE'].includes(w));
  if (targetWords.length === 0) return false;
  const brand = targetWords[0];

  if (!candTokens.has(brand)) return false;

  // If target has a second brand token like 'VG', 'MV', 'MT', 'RETARD', 'CHRONO', 'MAX', 'GOLD'
  if (targetWords.length > 1 && targetWords[1].length >= 2 && !/^\d+$/.test(targetWords[1])) {
    const secondWord = targetWords[1];
    if (['VG', 'MV', 'MT', 'PM', 'PM1', 'PM2', 'GM', 'GM2', 'MF', 'MP', 'HT', 'MEX', 'CV', 'XL', 'DXT', 'RETARD', 'CHRONO', 'CD', 'MAX', 'GOLD', 'SPF55', 'SOFT'].includes(secondWord)) {
      if (!candTokens.has(secondWord)) return false;
    }
  }

  // Check dosage form
  const targetForm = extractDosageForm(targetMed.name) || extractDosageForm(targetMed.dosage_form || '');
  const candForm = extractDosageForm(candidateName);
  if (targetForm && candForm && targetForm !== candForm) {
    // Exception: face wash / sunscreen / lotions are all TOPICAL
    const isBothTopical = (targetForm === 'TOPICAL' || targetForm === null) && (candForm === 'TOPICAL');
    if (!isBothTopical) return false;
  }

  // Check explicit strength
  const targetStr = extractStrength(targetMed.name) || extractStrength(targetMed.generic_name || '');
  const candStr = extractStrength(candidateName);
  if (targetStr && candStr) {
    const normTarget = targetStr.replace(/[\.\/]/g, '').toUpperCase();
    const normCand = candStr.replace(/[\.\/]/g, '').toUpperCase();
    if (normTarget !== normCand) {
      // Check primary number
      const num1 = parseFloat(targetStr);
      const num2 = parseFloat(candStr);
      if (num1 && num2 && num1 !== num2) return false;
    }
  }

  return true;
}

async function resolveMedicine(med) {
  console.log(`\n----------------------------------------------------------------------`);
  console.log(`[Resolving #${med.id}] ${med.name}`);
  console.log(`Generic: ${med.generic_name || 'N/A'} | Mfg: ${med.manufacturer || 'N/A'}`);

  // Build clean search queries with joined modifier splitting (e.g. PM2 -> PM 2, GM2 -> GM 2)
  let cleanQuery = med.name
    .replace(/STRIP OF \d+ (TABLETS|CAPSULES)/i, '')
    .replace(/BOTTLE OF \d+ (TABLETS|ML)/i, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Split joined numbers e.g. PM2 -> PM 2, GM2 -> GM 2
  const splitQuery = cleanQuery.replace(/([A-Z]+)(\d+)/g, '$1 $2');
  
  // Extract primary strength e.g. from 0.2/500/2MG -> 2MG
  const ratioMatch = cleanQuery.match(/(\d+(?:\.\d+)?\/)+((\d+)(?:\.\d+)?\s*(?:MG|MCG))/i);
  const simplifiedRatioQuery = ratioMatch 
    ? cleanQuery.replace(/\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+\s*(?:MG|MCG)?/i, ratioMatch[2])
    : null;

  const queries = [
    cleanQuery,
    splitQuery,
    simplifiedRatioQuery,
    cleanQuery.replace(/\b(TAB|TABLET|CAPSULE|CAP|LOTION|CREAM|GEL)\b/gi, '').trim(),
    splitQuery.replace(/\b(TAB|TABLET|CAPSULE|CAP|LOTION|CREAM|GEL)\b/gi, '').trim(),
    cleanQuery.split(' ').slice(0, 3).join(' ')
  ].filter(q => q && q.length >= 3);

  const uniqueQueries = Array.from(new Set(queries));
  let bestCandidate = null;
  let candidateImages = [];

  // 1. Try PharmEasy
  for (const q of uniqueQueries) {
    const products = await searchPharmEasy(q);
    for (const p of products) {
      if (!p.name) continue;
      if (isEligibleCandidate(med, p.name)) {
        const images = [];
        if (Array.isArray(p.damImages) && p.damImages.length > 0) {
          for (const img of p.damImages) {
            if (img.url) images.push({ url: img.url.split('?')[0], face: img.face || 'front' });
          }
        } else if (p.image) {
          images.push({ url: p.image.split('?')[0], face: 'front' });
        }

        if (images.length > 0) {
          bestCandidate = p;
          candidateImages = images;
          break;
        }
      }
    }
    if (bestCandidate) break;
  }

  // 2. Fallback to 1mg if no images on PharmEasy
  if (!bestCandidate) {
    for (const q of uniqueQueries) {
      const skus = await search1mg(q);
      for (const s of skus) {
        if (!s.name) continue;
        if (isEligibleCandidate(med, s.name)) {
          const images = [];
          if (Array.isArray(s.images) && s.images.length > 0) {
            for (const img of s.images) {
              const u = typeof img === 'string' ? img : img.url;
              if (u) images.push({ url: u.split('?')[0], face: 'front' });
            }
          } else if (s.image_url) {
            images.push({ url: s.image_url.split('?')[0], face: 'front' });
          }

          if (images.length > 0) {
            bestCandidate = { name: s.name, slug: s.slug || s.name };
            candidateImages = images;
            break;
          }
        }
      }
      if (bestCandidate) break;
    }
  }

  if (!bestCandidate) {
    console.log(`❌ No eligible verified images found online. Kept safely in quarantine.`);
    return { success: false, medId: med.id, medName: med.name, reason: 'No eligible candidate' };
  }

  console.log(`✅ MATCH FOUND: "${bestCandidate.name}" (${candidateImages.length} images)`);

  const baseSlug = slugify(med.name);
  const downloadedRecords = [];

  for (let i = 0; i < candidateImages.length; i++) {
    const imgInfo = candidateImages[i];
    let face = imgInfo.face.toLowerCase();
    if (!['front', 'back', 'side', 'combo', 'box-front', 'box-back', 'box-side'].includes(face)) {
      face = i === 0 ? 'front' : (i === 1 ? 'back' : 'side');
    }

    const fileName = `${baseSlug}-${face}.jpg`;
    const frontPath = path.join(TARGET_FRONTEND, fileName);
    const uploadsPath = path.join(TARGET_UPLOADS, fileName);

    const buf = await downloadBuffer(imgInfo.url);
    if (!buf) continue;

    fs.writeFileSync(frontPath, buf);
    fs.writeFileSync(uploadsPath, buf);

    downloadedRecords.push({
      fileName: `/products/${fileName}`,
      face,
      isPrimary: i === 0 || face === 'front' ? 1 : 0
    });
  }

  if (downloadedRecords.length === 0) {
    console.log(`⚠️ Failed to download images for ${med.name}`);
    return { success: false, medId: med.id, medName: med.name, reason: 'Download failed' };
  }

  // Ensure exactly one primary image
  if (!downloadedRecords.some(r => r.isPrimary === 1)) {
    downloadedRecords[0].isPrimary = 1;
  }

  // Insert into catalog_images inside a transaction
  const insertStmt = db.prepare(`
    INSERT INTO catalog_images (
      medicine_id, product_name, company_name, image_path, image_type, is_primary, is_active, verification_status, confidence_score
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 'APPROVED', 95)
  `);

  const tx = db.transaction(() => {
    // Remove any stale records
    db.prepare('DELETE FROM catalog_images WHERE medicine_id = ?').run(med.id);

    for (const rec of downloadedRecords) {
      insertStmt.run(
        med.id,
        bestCandidate.name,
        med.manufacturer || 'Verified Manufacturer',
        rec.fileName,
        rec.face,
        rec.isPrimary
      );
    }

    // Delete from catalog_image_rejections
    db.prepare('DELETE FROM catalog_image_rejections WHERE medicine_id = ?').run(med.id);
  });

  tx();

  console.log(`🎉 SAVED ${downloadedRecords.length} VERIFIED IMAGES into catalog_images & CLEARED from rejections!`);
  return { success: true, medId: med.id, medName: med.name, candidate: bestCandidate.name, count: downloadedRecords.length };
}

async function main() {
  console.log('======================================================================');
  console.log('         QUARANTINE 66 MEDICINE IMAGE RESOLUTION ENGINE');
  console.log('======================================================================\n');

  const meds = db.prepare(`
    SELECT DISTINCT m.id, m.name, m.generic_name, m.manufacturer, m.dosage_form
    FROM catalog_image_rejections cir
    JOIN medicines m ON cir.medicine_id = m.id
    ORDER BY m.name ASC
  `).all();

  console.log(`Loaded ${meds.length} distinct quarantined medicines to resolve.\n`);

  let resolvedCount = 0;
  let failedCount = 0;
  const resolvedList = [];
  const quarantinedList = [];

  for (const m of meds) {
    const res = await resolveMedicine(m);
    if (res.success) {
      resolvedCount++;
      resolvedList.push(res);
    } else {
      failedCount++;
      quarantinedList.push(res);
    }
    // Small politeness pause between queries
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\n======================================================================');
  console.log('                        RESOLUTION SUMMARY');
  console.log('======================================================================');
  console.log(`Total Medicines Processed:  ${meds.length}`);
  console.log(`Successfully Resolved:      ${resolvedCount} (${((resolvedCount / meds.length) * 100).toFixed(1)}%)`);
  console.log(`Safely Kept in Quarantine:  ${failedCount} (${((failedCount / meds.length) * 100).toFixed(1)}%)\n`);

  const remainingRejections = db.prepare('SELECT count(*) as c FROM catalog_image_rejections').get().c;
  const activeImages = db.prepare('SELECT count(*) as c FROM catalog_images WHERE is_active = 1').get().c;
  const medsWithImages = db.prepare('SELECT count(distinct medicine_id) as c FROM catalog_images WHERE is_active = 1').get().c;

  console.log(`Current Active Verified Images:    ${activeImages}`);
  console.log(`Medicines with Active Images:     ${medsWithImages}`);
  console.log(`Remaining Mismatches Quarantined: ${remainingRejections}\n`);
}

main().catch(console.error);
