import fs from 'fs';
import path from 'path';
import os from 'os';
import { catalogImageService } from '../src/services/catalogImageService.js';
import { ensureSchema } from '../src/database.js';
import { dbManager } from '../src/database/connection.js';

describe('Catalog Image Auditor & Health Repair Master Suite', () => {
  let dbPath: string;
  let testMedicineId: number;
  let testImagePath: string;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auditor-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const db = await dbManager.getConnection();
    const res = await db.run(`
      INSERT INTO medicines (name, manufacturer, generic_name, strength, packaging, mrp, sell_price)
      VALUES ('BUDETROL 400MCG ROTACAP', 'Macleods Pharmaceuticals', 'BUDESONIDE + FORMOTEROL', '400 MCG', '30 Capsules', 268.0, 240.0)
    `);
    testMedicineId = Number(res.lastID);

    // Create real test image file in frontend/public/products
    const prodDir = path.resolve(process.cwd(), 'frontend/public/products');
    fs.mkdirSync(prodDir, { recursive: true });
    testImagePath = path.join(prodDir, 'test-budetrol-sample.jpg');
    fs.writeFileSync(testImagePath, Buffer.from('fake-image-bytes-for-testing'));
  });

  afterAll(async () => {
    try {
      if (fs.existsSync(testImagePath)) {
        fs.unlinkSync(testImagePath);
      }
      await dbManager.close(true);
    } catch (_) {}
  });

  describe('Section 15: Canonical Image Resolver', () => {
    it('should return null when no active image exists', async () => {
      const resolved = await catalogImageService.resolveProductImage(testMedicineId);
      expect(resolved).toBeNull();
    });

    it('should return versioned URL when active verified image exists on disk', async () => {
      const db = await dbManager.getConnection();
      await db.run(
        `INSERT INTO catalog_images (
           medicine_id, product_name, image_path, thumbnail_path, image_source,
           confidence_score, matching_method, verification_status, is_active
         ) VALUES (?, 'Budetrol 400 Inhalation', '/products/test-budetrol-sample.jpg', '/products/test-budetrol-sample.jpg',
                   'pharmeasy', 90, 'ai_multi_signal', 'HIGH_CONFIDENCE', 1)`,
        [testMedicineId]
      );

      const resolved = await catalogImageService.resolveProductImage(testMedicineId);
      expect(resolved).not.toBeNull();
      expect(resolved?.url).toContain('/products/test-budetrol-sample.jpg');
      expect(resolved?.url).toContain('?v=');
      expect(resolved?.status).toBe('HIGH_CONFIDENCE');
    });

    it('should mark image as BROKEN and return null if physical file is missing from disk', async () => {
      const db = await dbManager.getConnection();
      const res = await db.run(`
        INSERT INTO medicines (name, manufacturer, generic_name, strength)
        VALUES ('GHOST MED 50MG', 'Unknown Ltd', 'GHOST', '50 MG')
      `);
      const ghostMedId = Number(res.lastID);

      await db.run(
        `INSERT INTO catalog_images (
           medicine_id, product_name, image_path, thumbnail_path, image_source,
           confidence_score, matching_method, verification_status, is_active
         ) VALUES (?, 'Ghost 50mg', '/products/non_existent_file_xyz_123.jpg', '/products/non_existent_file_xyz_123.jpg',
                   'pharmeasy', 95, 'ai_multi_signal', 'HIGH_CONFIDENCE', 1)`,
        [ghostMedId]
      );

      const resolved = await catalogImageService.resolveProductImage(ghostMedId);
      expect(resolved).toBeNull();

      // Verify row status became BROKEN and inactive
      const brokenRow = await db.get('SELECT verification_status, is_active FROM catalog_images WHERE medicine_id = ?', [ghostMedId]);
      expect(brokenRow.verification_status).toBe('BROKEN');
      expect(brokenRow.is_active).toBe(0);
    });
  });

  describe('Section 10 & 34: Tiered Query Generator & Calibration', () => {
    it('should generate accurate clinical queries for known brand patterns', () => {
      const queries = catalogImageService.generateAccurateQueries('BUDETROL 400MCG ROTACAP 30\'S [MACLEODS PHARMACEUTICALS]', 'MACLEODS');
      expect(queries.some(q => q.toLowerCase().includes('budetrol 400'))).toBe(true);
    });

    it('should categorize score >= 80 as HIGH_CONFIDENCE when brand and strength match', () => {
      const med = {
        name: 'BUDETROL 400MCG ROTACAP',
        manufacturer: 'Macleods Pharmaceuticals',
        strength: '400 MCG',
        packaging: '30 Capsules'
      };
      const cand = {
        name: 'Budetrol 400mcg Bottle Of 30 Inhalation Capsules',
        manufacturer: 'Macleods Pharmaceuticals'
      };

      const matchRes = catalogImageService.computeConfidence(med, cand);
      expect(matchRes.confidenceScore).toBeGreaterThanOrEqual(80);
      expect(matchRes.verificationStatus).toBe('HIGH_CONFIDENCE');
    });

    it('should strictly reject mismatched brands (e.g. Thyronorm for Thyrox)', () => {
      const med = {
        name: 'THYROX 150MCG TABLET [MACLEODS]',
        manufacturer: 'Macleods',
        strength: '150 MCG'
      };
      const cand = {
        name: 'Thyronorm 150mcg Bottle Of 120 Tablets',
        manufacturer: 'Abbott India Ltd'
      };

      const matchRes = catalogImageService.computeConfidence(med, cand);
      expect(matchRes.verificationStatus).toBe('REJECTED');
    });
  });

  describe('Section 6, 19, 34: Image Health Auditor', () => {
    it('should aggregate audit metrics without throwing', async () => {
      const audit = await catalogImageService.auditImageHealth();
      expect(audit.summary).toBeDefined();
      expect(audit.summary.totalMedicines).toBeGreaterThanOrEqual(2);
      expect(typeof audit.summary.healthyActive).toBe('number');
      expect(typeof audit.summary.broken).toBe('number');
    });
  });
});
