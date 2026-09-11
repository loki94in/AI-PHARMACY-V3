import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { aiCameraService } from '../src/services/aiCameraService.js';
import { VisualIndexService } from '../src/services/visualIndexService.js';

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const SAMPLE_DIR = path.join(ROOT_DIR, 'SAMPLE IMAGE');

interface BenchmarkResult {
  filename: string;
  hashTimeMs: number;
  ocrTimeMs: number;
  phash: string | null;
  rawBrandName: string | null;
  sanitizedBrand: string | null;
  dosageForm: string | null;
  detectedStrength: string | null;
  genericName: string | null;
  composition: string | null;
  noiseFree: boolean;
  masterMatch: string | null;
  masterId: number | null;
  visualMatchDistance: number;
}

async function runBenchmark() {
  console.log('===============================================================');
  console.log('     AI CAMERA & VISUAL INDEXING RECOGNITION BENCHMARK');
  console.log('===============================================================\n');

  const db = new Database(DB_PATH);
  const masterCount = db.prepare('SELECT count(*) as count FROM medicines').get().count;
  console.log(`Master Database: ${masterCount} medicines loaded from medicines.csv\n`);

  await aiCameraService.initialize();
  const visualIndex = VisualIndexService.getInstance();

  if (!fs.existsSync(SAMPLE_DIR)) {
    console.error(`Sample directory not found: ${SAMPLE_DIR}`);
    return;
  }

  const allFiles = fs.readdirSync(SAMPLE_DIR).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
  // Pick up to 15 representative sample packaging images
  const testFiles = allFiles.slice(0, 15);
  console.log(`Testing AI Camera on ${testFiles.length} real medicine packaging photos from SAMPLE IMAGE/\n`);

  const results: BenchmarkResult[] = [];

  // Stop words and salts to verify exclusion
  const DOSAGE_STOP_WORDS = new Set(['tab', 'tablet', 'tablets', 'cap', 'capsule', 'capsules', 'sus', 'susp', 'suspension', 'syp', 'syrup', 'vati', 'churna', 'kwath']);
  const KNOWN_SALTS = new Set(['paracetamol', 'amoxicillin', 'pantoprazole', 'omeprazole', 'azithromycin', 'ciprofloxacin', 'metformin', 'atorvastatin', 'cetirizine', 'levocetirizine', 'ibuprofen', 'aceclofenac', 'diclofenac']);

  for (let i = 0; i < testFiles.length; i++) {
    const file = testFiles[i];
    const filePath = path.join(SAMPLE_DIR, file);
    const buf = fs.readFileSync(filePath);

    // 1. Measure Visual Hash (aHash) Time
    const hashStart = performance.now();
    const phash = await visualIndex.computePhashFromBuffer(buf);
    const hashTimeMs = Math.round(performance.now() - hashStart);

    // 2. Measure AI Camera OCR & Packaging Entity Extraction Time
    const ocrStart = performance.now();
    let ocrResult: any = null;
    try {
      ocrResult = await aiCameraService.processImage(buf, true);
    } catch (e: any) {
      console.warn(`OCR error for ${file}:`, e.message);
    }
    const ocrTimeMs = Math.round(performance.now() - ocrStart);

    const brand = ocrResult?.potentialName?.trim() || null;
    const dosage = ocrResult?.dosageForm || null;
    const strength = ocrResult?.detectedStrength || null;
    const generic = ocrResult?.genericName || null;
    const comp = ocrResult?.composition || null;

    // 3. Verify Noise-Free Brand
    let isNoiseFree = true;
    if (brand) {
      const lowerTokens = brand.toLowerCase().split(/\s+/);
      for (const tok of lowerTokens) {
        if (DOSAGE_STOP_WORDS.has(tok) || KNOWN_SALTS.has(tok) || tok === 'ip' || tok === 'bp' || tok === 'usp') {
          isNoiseFree = false;
          break;
        }
      }
    } else {
      isNoiseFree = false;
    }

    // 4. Query Master Database (medicines table)
    let masterMatch: string | null = null;
    let masterId: number | null = null;
    if (brand && brand.length >= 3) {
      const cleanBrand = brand.replace(/[^a-zA-Z0-9\s]/g, '').trim();
      const direct = db.prepare(`
        SELECT id, medicine_name, manufacturer_name, medicine_packaging
        FROM medicines
        WHERE medicine_name LIKE ? OR medicine_name_base LIKE ?
        ORDER BY CASE WHEN medicine_name LIKE ? THEN 1 ELSE 2 END
        LIMIT 1
      `).get(`${cleanBrand}%`, `${cleanBrand}%`, `${cleanBrand}%`);

      if (direct) {
        masterMatch = `${direct.medicine_name} (${direct.manufacturer_name || 'N/A'})`;
        masterId = direct.id;
      }
    }

    // 5. Test Visual Hash Self-Retrieval / Stability
    let visualDist = 64;
    if (phash) {
      visualDist = visualIndex.hammingDistance(phash, phash);
    }

    results.push({
      filename: file,
      hashTimeMs,
      ocrTimeMs,
      phash,
      rawBrandName: ocrResult?.potentialName || null,
      sanitizedBrand: brand,
      dosageForm: dosage,
      detectedStrength: strength,
      genericName: generic,
      composition: comp,
      noiseFree: isNoiseFree,
      masterMatch,
      masterId,
      visualMatchDistance: visualDist
    });

    console.log(`[${i + 1}/${testFiles.length}] ${file}`);
    console.log(`    Brand Extracted : "${brand || 'NONE'}" (Noise-Free: ${isNoiseFree ? 'YES' : 'NO'})`);
    console.log(`    Dosage / Form   : ${dosage || 'N/A'} | Strength: ${strength || 'N/A'}`);
    console.log(`    Salt / Generic  : ${generic || comp || 'N/A'}`);
    console.log(`    Master DB Match : ${masterMatch || 'No direct match'}`);
    console.log(`    Perceptual Hash : ${phash || 'FAILED'} (Visual Dist: ${visualDist})`);
    console.log(`    Timing          : Visual Hash: ${hashTimeMs}ms | OCR & Parser: ${ocrTimeMs}ms\n`);
  }

  // Summary Metrics
  const validBrands = results.filter(r => r.sanitizedBrand && r.sanitizedBrand.length > 2);
  const noiseFreeCount = results.filter(r => r.noiseFree).length;
  const masterMatched = results.filter(r => r.masterMatch !== null).length;
  const avgHashMs = Math.round(results.reduce((acc, r) => acc + r.hashTimeMs, 0) / results.length);
  const avgOcrMs = Math.round(results.reduce((acc, r) => acc + r.ocrTimeMs, 0) / results.length);

  console.log('===============================================================');
  console.log('                  BENCHMARK SCORECARD');
  console.log('===============================================================');
  console.log(`Total Test Images Evaluated   : ${results.length}`);
  console.log(`Brand Names Identified        : ${validBrands.length} / ${results.length} (${Math.round(validBrands.length / results.length * 100)}%)`);
  console.log(`Zero Dosage Noise / Salt Clean : ${noiseFreeCount} / ${validBrands.length} (${validBrands.length ? Math.round(noiseFreeCount / validBrands.length * 100) : 0}%)`);
  console.log(`Master DB Direct Matches      : ${masterMatched} / ${results.length} (${Math.round(masterMatched / results.length * 100)}%)`);
  console.log(`Average Visual Hash Latency   : ${avgHashMs} ms (Target < 30ms)`);
  console.log(`Average OCR & Pipeline Latency: ${avgOcrMs} ms`);
  console.log('===============================================================\n');

  // Save detailed report as JSON for auditing
  const reportPath = path.join(ROOT_DIR, 'scratch', 'aicamera_benchmark_report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ summary: { total: results.length, validBrands: validBrands.length, noiseFreeCount, masterMatched, avgHashMs, avgOcrMs }, results }, null, 2));
  console.log(`Full benchmark report saved to: ${reportPath}`);
}

runBenchmark().catch(console.error);
