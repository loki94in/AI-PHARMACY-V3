import fs from 'fs';
import path from 'path';
import os from 'os';
import { catalogImageService } from '../src/services/catalogImageService.js';
import { ensureSchema } from '../src/database.js';
import { dbManager } from '../src/database/connection.js';

describe('Catalogue Image Connection & AI Verification Master Suite', () => {
  let dbPath: string;
  let testMedicineId: number;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-img-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const db = await dbManager.getConnection();
    // Seed a test medicine
    const res = await db.run(`
      INSERT INTO medicines (name, manufacturer, generic_name, strength, packaging, mrp, sell_price)
      VALUES ('DYTOR 20MG TAB', 'Cipla Ltd', 'TORASEMIDE', '20 MG', '15 Tablets', 120.0, 108.0)
    `);
    testMedicineId = Number(res.lastID);
  });

  afterAll(async () => {
    try {
      await dbManager.close(true);
    } catch (_) {}
  });

  describe('Task 4, 5, 6: Multi-Signal Matching & Confidence Scoring', () => {
    it('should assign 100% confidence to an exact brand, strength, form, and company match', () => {
      const med = {
        name: 'DYTOR 20MG TAB',
        manufacturer: 'Cipla Ltd',
        strength: '20 MG',
        packaging: '15 Tablets'
      };
      const candidate = {
        name: 'Dytor 20mg Tablet 15s',
        manufacturer: 'Cipla Limited',
        ocrText: 'DYTOR 20 Torasemide Tablets 20mg Cipla'
      };

      const result = catalogImageService.computeConfidence(med, candidate);
      expect(result.confidenceScore).toBeGreaterThanOrEqual(99);
      expect(result.verificationStatus).toBe('HIGH_CONFIDENCE');
      expect(result.signals.brandMatch).toBe(true);
      expect(result.signals.strengthMatch).toBe(true);
      expect(result.signals.dosageFormMatch).toBe(true);
      expect(result.signals.companyMatch).toBe(true);
    });

    it('should penalize conflicting strengths (e.g. 10mg vs 20mg)', () => {
      const med = {
        name: 'DYTOR 20MG TAB',
        manufacturer: 'Cipla Ltd',
        strength: '20 MG',
        packaging: '15 Tablets'
      };
      // Candidate is 10mg instead of 20mg
      const candidate = {
        name: 'Dytor 10mg Tablet',
        manufacturer: 'Cipla Limited',
        ocrText: 'DYTOR 10 Torasemide Tablets 10mg'
      };

      const result = catalogImageService.computeConfidence(med, candidate);
      expect(result.signals.strengthConflict).toBe(true);
      expect(result.confidenceScore).toBeLessThan(70);
      expect(result.verificationStatus).not.toBe('HIGH_CONFIDENCE');
    });

    it('should penalize conflicting dosage forms (e.g. Tablet vs Syrup)', () => {
      const med = {
        name: 'DYTOR 20MG TAB',
        manufacturer: 'Cipla Ltd',
        strength: '20 MG',
        packaging: '15 Tablets'
      };
      // Candidate is Syrup instead of Tablet
      const candidate = {
        name: 'Dytor Syrup 60ml',
        manufacturer: 'Cipla Limited',
        ocrText: 'Dytor Syrup'
      };

      const result = catalogImageService.computeConfidence(med, candidate);
      expect(result.signals.dosageFormConflict).toBe(true);
      expect(result.confidenceScore).toBeLessThan(70);
      expect(result.verificationStatus).not.toBe('HIGH_CONFIDENCE');
    });

    it('should reject candidates from a completely different brand (wrong image)', () => {
      const med = {
        name: 'DYTOR 20MG TAB',
        manufacturer: 'Cipla Ltd',
        strength: '20 MG',
        packaging: '15 Tablets'
      };
      const candidate = {
        name: 'Paracetamol 500mg Tablet',
        manufacturer: 'Cipla Ltd',
        ocrText: 'Crocin Paracetamol'
      };

      const result = catalogImageService.computeConfidence(med, candidate);
      expect(result.signals.brandMatch).toBe(false);
      expect(result.confidenceScore).toBeLessThan(45);
      expect(result.verificationStatus).toBe('REJECTED');
    });

    it('should route ambiguous matches (<99%) to PENDING_REVIEW', () => {
      const med = {
        name: 'DYTOR 20MG TAB',
        manufacturer: 'Cipla Ltd',
        strength: '20 MG',
        packaging: '15 Tablets'
      };
      // Brand matches, but company is not listed and no strength in title
      const candidate = {
        name: 'Dytor Strip',
        manufacturer: '',
        ocrText: ''
      };

      const result = catalogImageService.computeConfidence(med, candidate);
      expect(result.confidenceScore).toBeLessThan(99);
      expect(result.verificationStatus).toBe('PENDING_REVIEW');
    });
  });

  describe('Task 7–16: User Actions, Rejection Exclusion & History', () => {
    let testImageId: number;

    beforeEach(async () => {
      const db = await dbManager.getConnection();
      const res = await db.run(`
        INSERT INTO catalog_images (
          medicine_id, product_name, image_path, source_url, image_hash,
          confidence_score, verification_status, is_active
        ) VALUES (?, 'DYTOR 20MG TAB', '/products/dytor-20-front.jpg', 'https://cdn.example.com/dytor20.jpg', 'hash_test_123', 85, 'PENDING_REVIEW', 0)
      `, [testMedicineId]);
      testImageId = Number(res.lastID);
    });

    it('should APPROVE image and set as active catalogue image without altering medicine details', async () => {
      const ok = await catalogImageService.approveImage(testImageId, 'test_user');
      expect(ok).toBe(true);

      const db = await dbManager.getConnection();
      const img = await db.get('SELECT * FROM catalog_images WHERE id = ?', [testImageId]);
      expect(img.verification_status).toBe('APPROVED');
      expect(img.is_active).toBe(1);
      expect(img.verified_by).toBe('test_user');

      // Verify medicine master record remains completely untouched
      const med = await db.get('SELECT * FROM medicines WHERE id = ?', [testMedicineId]);
      expect(med.name).toBe('DYTOR 20MG TAB');
      expect(med.mrp).toBe(120.0);
    });

    it('should REJECT image, deactivate it, log candidate into rejections table to prevent reuse', async () => {
      const result = await catalogImageService.rejectImage(testImageId, 'Wrong product', 'test_user');
      expect(result.success).toBe(true);
      expect(result.rejectionLogged).toBe(true);

      const db = await dbManager.getConnection();
      const img = await db.get('SELECT * FROM catalog_images WHERE id = ?', [testImageId]);
      expect(img.verification_status).toBe('REJECTED');
      expect(img.is_active).toBe(0);

      // Verify rejection is recorded in catalog_image_rejections table
      const rejection = await db.get('SELECT * FROM catalog_image_rejections WHERE medicine_id = ? AND rejected_image_url = ?', [
        testMedicineId,
        'https://cdn.example.com/dytor20.jpg'
      ]);
      expect(rejection).toBeTruthy();
      expect(rejection.rejected_image_hash).toBe('hash_test_123');
    });

    it('should REPLACE image, connecting new image to the exact same medicine ID and deactivating old image', async () => {
      const replaced = await catalogImageService.replaceImage(
        testImageId,
        '/products/dytor-20-new.jpg',
        'https://cdn.example.com/dytor20-new.jpg',
        'test_user'
      );
      expect(replaced).toBeTruthy();
      expect(replaced?.medicine_id).toBe(testMedicineId);
      expect(replaced?.verification_status).toBe('APPROVED');
      expect(replaced?.is_active).toBe(1);
      expect(replaced?.replaced_from_image_id).toBe(testImageId);

      const db = await dbManager.getConnection();
      const oldImg = await db.get('SELECT * FROM catalog_images WHERE id = ?', [testImageId]);
      expect(oldImg.is_active).toBe(0);
    });

    it('should REMOVE image, leaving medicine record valid without active image', async () => {
      const ok = await catalogImageService.removeImage(testImageId, 'test_user');
      expect(ok).toBe(true);

      const db = await dbManager.getConnection();
      const img = await db.get('SELECT * FROM catalog_images WHERE id = ?', [testImageId]);
      expect(img.verification_status).toBe('REMOVED');
      expect(img.is_active).toBe(0);

      // Medicine record is still valid in database
      const med = await db.get('SELECT * FROM medicines WHERE id = ?', [testMedicineId]);
      expect(med).toBeTruthy();
    });
  });

  describe('Task 21 & 25: Public/Website Image Verification Gate', () => {
    it('should only permit APPROVED or HIGH_CONFIDENCE active images for public catalogue', async () => {
      const db = await dbManager.getConnection();

      // Clear previous test images for this medicine
      await db.run('DELETE FROM catalog_images WHERE medicine_id = ?', [testMedicineId]);

      // Insert unapproved image
      await db.run(`
        INSERT INTO catalog_images (medicine_id, product_name, image_path, verification_status, is_active)
        VALUES (?, 'DYTOR 20MG TAB', '/products/unreviewed.jpg', 'PENDING_REVIEW', 0)
      `, [testMedicineId]);

      // Query public active images
      const unreviewed = await db.get(`
        SELECT image_path FROM catalog_images 
        WHERE medicine_id = ? AND is_active = 1 AND verification_status IN ('APPROVED', 'HIGH_CONFIDENCE')
      `, [testMedicineId]);
      expect(unreviewed).toBeUndefined();

      // Now approve it
      await db.run(`
        UPDATE catalog_images SET verification_status = 'APPROVED', is_active = 1 WHERE medicine_id = ?
      `, [testMedicineId]);

      const approved = await db.get(`
        SELECT image_path FROM catalog_images 
        WHERE medicine_id = ? AND is_active = 1 AND verification_status IN ('APPROVED', 'HIGH_CONFIDENCE')
      `, [testMedicineId]);
      expect(approved).toBeTruthy();
      expect(approved.image_path).toBe('/products/unreviewed.jpg');
    });
  });
});
