import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';
import { aiCameraService } from './aiCameraService.js';

export interface CatalogImageRecord {
  id: number;
  medicine_id: number;
  company_name: string | null;
  product_name: string;
  image_path: string;
  thumbnail_path: string | null;
  image_source: string;
  source_url: string | null;
  image_hash: string | null;
  confidence_score: number;
  matching_method: string;
  verification_status: 'HIGH_CONFIDENCE' | 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED' | 'REMOVED' | 'CORRECT' | 'INCORRECT' | 'CORRECTED' | 'SKIPPED' | string;
  verification_reason: string | null;
  ocr_text: string | null;
  ocr_confidence: number | null;
  is_active: number;
  retry_count: number;
  replaced_from_image_id: number | null;
  previous_image_url?: string | null;
  next_review_at?: string | null;
  skip_reason?: string | null;
  locked_by?: string | null;
  locked_at?: string | null;
  verification_version?: number;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined medicine fields
  medicine_name?: string;
  generic_name?: string;
  strength?: string;
  packaging?: string;
  mrp?: number;
  manufacturer?: string;
  category?: string;
}

export interface ImageReviewHistoryRecord {
  id: number;
  product_image_id: number;
  medicine_id: number;
  previous_status: string | null;
  new_status: string;
  previous_image_url: string | null;
  new_image_url: string | null;
  action: string;
  reason: string | null;
  performed_by: string;
  performed_at: string;
  metadata: string | null;
}

export interface CandidateImage {
  id: string;
  name: string;
  manufacturer: string;
  imageUrl: string;
  source: string;
  confidenceScore: number;
  verificationStatus: 'HIGH_CONFIDENCE' | 'PENDING_REVIEW' | 'REJECTED';
  reason: string;
  signals?: any;
}

export interface MatchScoreResult {
  confidenceScore: number;
  verificationStatus: 'HIGH_CONFIDENCE' | 'PENDING_REVIEW' | 'REJECTED';
  reason: string;
  signals: {
    brandMatch: boolean;
    brandScore: number;
    companyMatch: boolean;
    companyScore: number;
    strengthMatch: boolean;
    strengthConflict: boolean;
    strengthScore: number;
    dosageFormMatch: boolean;
    dosageFormConflict: boolean;
    dosageFormScore: number;
    packMatch: boolean;
    packScore: number;
    ocrMatch: boolean;
    ocrScore: number;
  };
}

const DOSAGE_FORMS = [
  'TABLET', 'TABLETS', 'TAB', 'TABS', 'DT',
  'CAPSULE', 'CAPSULES', 'CAP', 'CAPS',
  'SYRUP', 'SYP', 'SUSPENSION', 'SUSP',
  'INJECTION', 'INJ', 'IV', 'IM',
  'CREAM', 'GEL', 'OINTMENT', 'OINT',
  'DROPS', 'DROP', 'EYE DROPS', 'EAR DROPS',
  'INHALER', 'RESPULES', 'ROTACAPS', 'ROTACAP',
  'POWDER', 'LOTION', 'SHAMPOO', 'SPRAY', 'SOLUTION'
];

export class CatalogImageService {
  private static instance: CatalogImageService;

  public static getInstance(): CatalogImageService {
    if (!CatalogImageService.instance) {
      CatalogImageService.instance = new CatalogImageService();
    }
    return CatalogImageService.instance;
  }

  /**
   * Compute SHA-256 hash of an image file for deduplication
   */
  public computeFileHash(filePath: string): string | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      const buffer = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(buffer).digest('hex');
    } catch (e) {
      return null;
    }
  }

  /**
   * Extract primary dosage form from text
   */
  public extractDosageForm(text: string): string | null {
    const upper = (text || '').toUpperCase();
    for (const form of DOSAGE_FORMS) {
      const regex = new RegExp(`\\b${form}\\b`, 'i');
      if (regex.test(upper)) {
        if (form.startsWith('TAB')) return 'TABLET';
        if (form.startsWith('CAP')) return 'CAPSULE';
        if (form.startsWith('SYP') || form.startsWith('SYRUP') || form.startsWith('SUSP')) return 'SYRUP';
        if (form.startsWith('INJ') || form === 'IV' || form === 'IM') return 'INJECTION';
        if (form === 'GEL' || form === 'CREAM' || form.startsWith('OINT')) return 'TOPICAL';
        if (form.startsWith('DROP')) return 'DROPS';
        if (form.startsWith('INH') || form.startsWith('ROTA') || form.startsWith('RESP')) return 'INHALER';
        return form;
      }
    }
    return null;
  }

  /**
   * Extract strength from text (e.g. "20 MG", "500MG", "0.5 ML")
   */
  public extractStrength(text: string): string | null {
    if (!text) return null;
    const match = text.match(/\b\d+(?:\.\d+)?\s*(?:MG|ML|GM|MCG|IU|%|MCG\/ML|MG\/ML)\b/i);
    return match ? match[0].toUpperCase().replace(/\s+/g, '') : null;
  }

  /**
   * Extract core brand name (strips dosage, packaging, company brackets)
   */
  public extractCoreBrand(raw: string): string {
    if (!raw) return '';
    let c = raw.replace(/\[.*?\]/g, ' '); // remove [COMPANY LTD]
    c = c.replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ');
    c = c.replace(/\b\d+(?:\.\d+)?\s*(?:MG|ML|GM|MCG|IU|%)\b/gi, ' ');
    const words = c.split(/[^A-Za-z0-9\+\-]+/).filter(w => w.length >= 2 && !DOSAGE_FORMS.includes(w.toUpperCase()));
    return words[0] ? words[0].toUpperCase() : '';
  }

  /**
   * Multi-Signal AI Confidence Scoring
   * Evaluates Company (15%), Brand (35%), Strength (20%), Dosage Form (15%), Pack (5%), OCR (10%).
   */
  public computeConfidence(medicine: {
    name: string;
    manufacturer?: string | null;
    api_reference?: string | null;
    strength?: string | null;
    packaging?: string | null;
  }, candidate: {
    name: string;
    manufacturer?: string | null;
    ocrText?: string | null;
  }): MatchScoreResult {
    const medBrand = this.extractCoreBrand(medicine.name);
    const candUpper = (candidate.name || '').toUpperCase();
    const ocrUpper = (candidate.ocrText || '').toUpperCase();

    // 1. Brand Match (35%) — Strict boundary/whole-word check (Section 11)
    let brandMatch = false;
    let brandScore = 0;
    if (medBrand) {
      const candWords = candUpper.split(/[^A-Za-z0-9]+/).filter(w => w.length >= 2);
      const exactWordMatch = candWords.some(w => w === medBrand || (medBrand.length >= 5 && w.startsWith(medBrand) && w.length <= medBrand.length + 2));
      const wordBoundaryMatch = new RegExp(`\\b${medBrand}\\b`, 'i').test(candUpper);

      if (exactWordMatch || wordBoundaryMatch) {
        brandMatch = true;
        brandScore = 35;
      }
    }

    // 2. Company Match (15%)
    let companyMatch = false;
    let companyScore = 5; // default neutral
    const medMfg = (medicine.manufacturer || '').toUpperCase().trim();
    const candMfg = (candidate.manufacturer || '').toUpperCase().trim();

    if (medMfg && candMfg) {
      const cleanMedMfg = medMfg.replace(/^(M\/s\.|M\/S|M\/R|LTD|LIMITED|PVT|PHARMA|PHARMACEUTICALS)\s*/gi, '').trim();
      const cleanCandMfg = candMfg.replace(/^(M\/s\.|M\/S|M\/R|LTD|LIMITED|PVT|PHARMA|PHARMACEUTICALS)\s*/gi, '').trim();
      if (cleanCandMfg && cleanMedMfg.includes(cleanCandMfg.slice(0, 5))) {
        companyMatch = true;
        companyScore = 15;
      } else {
        // Conflicting manufacturer
        companyScore = 0;
      }
    } else if (medMfg && ocrUpper.includes(medMfg.slice(0, 6))) {
      companyMatch = true;
      companyScore = 15;
    }

    // 3. Strength Match (20%)
    const medStr = this.extractStrength(medicine.strength || medicine.name);
    const candStr = this.extractStrength(candidate.name) || this.extractStrength(candidate.ocrText || '');
    let strengthMatch = false;
    let strengthConflict = false;
    let strengthScore = 10; // neutral if neither specifies

    if (medStr && candStr) {
      if (medStr === candStr) {
        strengthMatch = true;
        strengthScore = 20;
      } else {
        // Explicit dosage conflict (e.g. 10MG vs 20MG) -> severe penalty
        strengthConflict = true;
        strengthScore = -30;
      }
    } else if (medStr && !candStr) {
      strengthScore = 10;
    }

    // 4. Dosage Form Match (15%)
    const medForm = this.extractDosageForm(medicine.packaging || medicine.name);
    const candForm = this.extractDosageForm(candidate.name) || this.extractDosageForm(candidate.ocrText || '');
    let dosageFormMatch = false;
    let dosageFormConflict = false;
    let dosageFormScore = 8; // neutral

    if (medForm && candForm) {
      if (medForm === candForm) {
        dosageFormMatch = true;
        dosageFormScore = 15;
      } else {
        dosageFormConflict = true;
        dosageFormScore = -25;
      }
    }

    // 5. Pack Size Match (5%)
    let packMatch = false;
    let packScore = 0;
    const cleanMedPack = (medicine.packaging || '').replace(/\b\d+(?:\.\d+)?\s*(?:MG|ML|GM|MCG|IU|%)\b/gi, '');
    const cleanCandPack = (candidate.name || '').replace(/\b\d+(?:\.\d+)?\s*(?:MG|ML|GM|MCG|IU|%)\b/gi, '');
    const medPack = cleanMedPack.match(/\b\d+\b/)?.[0];
    const candPack = cleanCandPack.match(/\b\d+\b/)?.[0];
    if (medPack && candPack && medPack === candPack) {
      packMatch = true;
      packScore = 5;
    } else if (!medPack || !candPack) {
      packScore = 4; // neutral if unstated
    }

    // 6. OCR Evidence Match (10%)
    let ocrMatch = false;
    let ocrScore = 0;
    if (candidate.ocrText && candidate.ocrText.length > 5) {
      if (medBrand && ocrUpper.includes(medBrand)) {
        ocrMatch = true;
        ocrScore = 10;
      } else if (ocrUpper.length > 40 && !ocrUpper.includes(medBrand) && !brandMatch) {
        // High text OCR shows unrelated product
        ocrScore = -15;
      }
    } else {
      // OCR not available or empty -> grant neutral points if brand matched
      if (brandMatch) ocrScore = 9;
    }

    // Aggregate Score
    let totalScore = brandScore + companyScore + strengthScore + dosageFormScore + packScore + ocrScore;

    // Hard fail rules
    if (!brandMatch) {
      totalScore = Math.min(totalScore, 35);
    }
    if (strengthConflict || dosageFormConflict) {
      totalScore = Math.min(totalScore, 40);
    }

    totalScore = Math.max(0, Math.min(100, Math.round(totalScore)));

    // Categorization (Calibrated per Section 10 & 34 of PRODUCT IMAGE MISSING.MD)
    let verificationStatus: 'HIGH_CONFIDENCE' | 'PENDING_REVIEW' | 'REJECTED' = 'PENDING_REVIEW';
    if (totalScore >= 80 && brandMatch && !strengthConflict && !dosageFormConflict) {
      verificationStatus = 'HIGH_CONFIDENCE';
    } else if (totalScore < 45 || strengthConflict || dosageFormConflict || !brandMatch) {
      verificationStatus = 'REJECTED';
    } else {
      verificationStatus = 'PENDING_REVIEW';
    }

    // Reason synthesis
    const reasons: string[] = [];
    if (brandMatch) reasons.push(`Brand matched ("${medBrand}")`);
    else reasons.push(`Brand mismatch ("${medBrand}" not found)`);

    if (strengthConflict) reasons.push(`Strength conflict (${medStr} vs ${candStr})`);
    else if (strengthMatch) reasons.push(`Strength verified (${medStr})`);

    if (dosageFormConflict) reasons.push(`Dosage form conflict (${medForm} vs ${candForm})`);
    else if (dosageFormMatch) reasons.push(`Form matched (${medForm})`);

    if (companyMatch) reasons.push('Manufacturer verified');
    if (ocrMatch) reasons.push('OCR packaging text verified');

    return {
      confidenceScore: totalScore,
      verificationStatus,
      reason: reasons.join(' • '),
      signals: {
        brandMatch,
        brandScore,
        companyMatch,
        companyScore,
        strengthMatch,
        strengthConflict,
        strengthScore,
        dosageFormMatch,
        dosageFormConflict,
        dosageFormScore,
        packMatch,
        packScore,
        ocrMatch,
        ocrScore
      }
    };
  }

  /**
   * Fetch paginated catalog images with filtering
   */
  public async getImages(options: {
    status?: string;
    search?: string;
    medicine_id?: number;
    groupByMedicine?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{
    images: (CatalogImageRecord & { angle_count?: number })[];
    totalCount: number;
    totalPages: number;
    page: number;
  }> {
    const db = await dbManager.getConnection();
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const offset = (page - 1) * limit;

    let whereSql = '1=1';
    const params: any[] = [];

    if (options.status && options.status !== 'all') {
      if (options.status === 'review' || options.status === 'pending') {
        whereSql += " AND ci.verification_status IN ('PENDING_REVIEW', 'PENDING')";
      } else if (options.status === 'missing_angles') {
        whereSql += ` AND ci.medicine_id IN (
          SELECT ci_sub.medicine_id FROM catalog_images ci_sub 
          WHERE ci_sub.is_active = 1 
          GROUP BY ci_sub.medicine_id 
          HAVING COUNT(*) < 2
        )`;
      } else if (options.status === 'high_confidence') {
        whereSql += " AND ci.verification_status = 'HIGH_CONFIDENCE'";
      } else if (options.status === 'approved') {
        whereSql += " AND ci.verification_status = 'APPROVED'";
      } else if (options.status === 'rejected') {
        whereSql += " AND ci.verification_status = 'REJECTED'";
      } else if (options.status === 'removed') {
        whereSql += " AND ci.verification_status = 'REMOVED'";
      } else {
        whereSql += ' AND ci.verification_status = ?';
        params.push(options.status.toUpperCase());
      }
    }

    if (options.groupByMedicine) {
      whereSql += ' AND (ci.is_primary = 1 OR ci.id = (SELECT MIN(ci3.id) FROM catalog_images ci3 WHERE ci3.medicine_id = ci.medicine_id))';
    }

    if (options.medicine_id) {
      whereSql += ' AND ci.medicine_id = ?';
      params.push(options.medicine_id);
    }

    if (options.search) {
      whereSql += ' AND (ci.product_name LIKE ? OR m.name LIKE ? OR ci.company_name LIKE ? OR m.generic_name LIKE ?)';
      const term = `%${options.search}%`;
      params.push(term, term, term, term);
    }

    const countRow = await db.get(
      `SELECT COUNT(*) as count 
       FROM catalog_images ci 
       LEFT JOIN medicines m ON m.id = ci.medicine_id 
       WHERE ${whereSql}`,
      params
    );
    const totalCount = countRow ? countRow.count : 0;

    const rows = await db.all(
      `SELECT ci.*, 
              m.name as medicine_name, 
              m.generic_name, 
              m.strength, 
              m.packaging, 
              m.mrp, 
              m.manufacturer,
              (SELECT COUNT(*) FROM catalog_images ci2 WHERE ci2.medicine_id = ci.medicine_id AND ci2.is_active = 1) as angle_count
       FROM catalog_images ci 
       LEFT JOIN medicines m ON m.id = ci.medicine_id 
       WHERE ${whereSql}
       ORDER BY 
         CASE WHEN ci.verification_status = 'PENDING_REVIEW' THEN 1 
              WHEN ci.verification_status = 'HIGH_CONFIDENCE' THEN 2 
              ELSE 3 END,
         ci.confidence_score DESC,
         ci.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return {
      images: rows,
      totalCount,
      totalPages: Math.ceil(totalCount / limit) || 1,
      page
    };
  }

  /**
   * Get counts across all verification buckets for Quick Assist & UI chips
   */
  public async getCounts(): Promise<{
    total: number;
    pending_review: number;
    high_confidence: number;
    approved: number;
    rejected: number;
    removed: number;
    missing_angles: number;
  }> {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      `SELECT verification_status, COUNT(*) as count 
       FROM catalog_images 
       GROUP BY verification_status`
    );

    const counts = {
      total: 0,
      pending_review: 0,
      high_confidence: 0,
      approved: 0,
      rejected: 0,
      removed: 0,
      missing_angles: 0
    };

    for (const r of rows) {
      counts.total += r.count;
      if (r.verification_status === 'PENDING_REVIEW' || r.verification_status === 'PENDING') counts.pending_review += r.count;
      else if (r.verification_status === 'HIGH_CONFIDENCE') counts.high_confidence = r.count;
      else if (r.verification_status === 'APPROVED') counts.approved = r.count;
      else if (r.verification_status === 'REJECTED') counts.rejected = r.count;
      else if (r.verification_status === 'REMOVED') counts.removed = r.count;
    }

    const missingRow = await db.get(
      `SELECT COUNT(*) as count FROM (
         SELECT medicine_id FROM catalog_images WHERE is_active = 1 GROUP BY medicine_id HAVING COUNT(*) < 2
       )`
    ).catch(() => ({ count: 0 }));
    counts.missing_angles = missingRow?.count || 0;

    return counts;
  }

  /**
   * Approve an image -> marks as APPROVED and active catalogue image for its image_type slot
   */
  public async approveImage(
    imageId: number, 
    verifiedBy = 'pharmacist', 
    imageType: string = 'combined',
    isPrimary?: boolean
  ): Promise<boolean> {
    const db = await dbManager.getConnection();
    const image = await db.get('SELECT * FROM catalog_images WHERE id = ?', [imageId]);
    if (!image) return false;

    const targetType = imageType || image.image_type || 'combined';
    let primaryVal = isPrimary ? 1 : 0;
    if (isPrimary === undefined) {
      if (targetType === 'combined') {
        primaryVal = 1;
      } else {
        const existingPrimary = await db.get(
          'SELECT id FROM catalog_images WHERE medicine_id = ? AND is_primary = 1 AND is_active = 1',
          [image.medicine_id]
        );
        primaryVal = existingPrimary ? 0 : 1;
      }
    }

    // Begin transaction
    await db.run('BEGIN TRANSACTION');
    try {
      // 1. Deactivate any previous active image for this medicine of the SAME image_type
      await db.run(
        'UPDATE catalog_images SET is_active = 0 WHERE medicine_id = ? AND image_type = ? AND id != ?',
        [image.medicine_id, targetType, imageId]
      );

      // If this image is primary, clear is_primary on other images for this medicine
      if (primaryVal === 1) {
        await db.run(
          'UPDATE catalog_images SET is_primary = 0 WHERE medicine_id = ? AND id != ?',
          [image.medicine_id, imageId]
        );
      }

      // 2. Mark this image approved and active
      await db.run(
        `UPDATE catalog_images 
         SET verification_status = 'APPROVED', 
             is_active = 1, 
             image_type = ?,
             is_primary = ?,
             verified_by = ?, 
             verified_at = CURRENT_TIMESTAMP, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [targetType, primaryVal, verifiedBy, imageId]
      );

      await db.run('COMMIT');

      eventService.broadcast('catalog_image_updated', {
        id: imageId,
        medicine_id: image.medicine_id,
        status: 'APPROVED',
        image_type: targetType,
        is_primary: primaryVal,
        is_active: 1
      });

      return true;
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }
  }

  /**
   * Reject an image -> logs rejection to prevent reuse and initiates auto-redownload
   */
  public async rejectImage(imageId: number, reason = 'Incorrect product image', verifiedBy = 'pharmacist'): Promise<{
    success: boolean;
    rejectionLogged: boolean;
    autoRedownloadTriggered: boolean;
  }> {
    const db = await dbManager.getConnection();
    const image = await db.get('SELECT * FROM catalog_images WHERE id = ?', [imageId]);
    if (!image) return { success: false, rejectionLogged: false, autoRedownloadTriggered: false };

    await db.run('BEGIN TRANSACTION');
    try {
      // 1. Mark image rejected and inactive
      await db.run(
        `UPDATE catalog_images 
         SET verification_status = 'REJECTED', 
             is_active = 0, 
             verification_reason = ?, 
             verified_by = ?, 
             verified_at = CURRENT_TIMESTAMP, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [reason, verifiedBy, imageId]
      );

      // 2. Add to rejection blacklist to prevent future reuse
      if (image.source_url || image.image_hash) {
        await db.run(
          `INSERT INTO catalog_image_rejections (medicine_id, rejected_image_url, rejected_image_hash, rejected_source, reason) 
           VALUES (?, ?, ?, ?, ?)`,
          [image.medicine_id, image.source_url || null, image.image_hash || null, image.image_source || 'pharmeasy', reason]
        );
      }

      await db.run('COMMIT');

      eventService.broadcast('catalog_image_updated', {
        id: imageId,
        medicine_id: image.medicine_id,
        status: 'REJECTED',
        is_active: 0
      });

      // 3. Trigger controlled auto re-download in background
      this.searchAndDownloadCandidate(image.medicine_id, (image.retry_count || 0) + 1).catch(err => {
        console.error(`[CatalogImageService] Auto-redownload failed for medicine ${image.medicine_id}:`, err.message);
      });

      return {
        success: true,
        rejectionLogged: true,
        autoRedownloadTriggered: true
      };
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }
  }

  /**
   * Remove image from catalogue without deleting the medicine
   */
  public async removeImage(imageId: number, verifiedBy = 'pharmacist'): Promise<boolean> {
    const db = await dbManager.getConnection();
    const image = await db.get('SELECT * FROM catalog_images WHERE id = ?', [imageId]);
    if (!image) return false;

    await db.run(
      `UPDATE catalog_images 
       SET verification_status = 'REMOVED', 
           is_active = 0, 
           verified_by = ?, 
           verified_at = CURRENT_TIMESTAMP, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [verifiedBy, imageId]
    );

    eventService.broadcast('catalog_image_updated', {
      id: imageId,
      medicine_id: image.medicine_id,
      status: 'REMOVED',
      is_active: 0
    });

    return true;
  }

  /**
   * Replace image with a custom uploaded file or URL
   */
  public async replaceImage(
    imageId: number,
    newImagePath: string,
    sourceUrl: string | null = null,
    verifiedBy = 'pharmacist'
  ): Promise<CatalogImageRecord | null> {
    const db = await dbManager.getConnection();
    const current = await db.get('SELECT * FROM catalog_images WHERE id = ?', [imageId]);
    if (!current) return null;

    const hash = this.computeFileHash(newImagePath);

    await db.run('BEGIN TRANSACTION');
    try {
      // 1. Deactivate old image
      await db.run(
        `UPDATE catalog_images 
         SET is_active = 0, 
             verification_status = 'REPLACED', 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [imageId]
      );

      // 2. Create new approved image linked to the same medicine
      const res = await db.run(
        `INSERT INTO catalog_images (
           medicine_id, company_name, product_name, image_path, thumbnail_path,
           image_source, source_url, image_hash, confidence_score, matching_method,
           verification_status, is_active, replaced_from_image_id, verified_by, verified_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 100, 'human_replacement', 'APPROVED', 1, ?, ?, CURRENT_TIMESTAMP)`,
        [
          current.medicine_id,
          current.company_name,
          current.product_name,
          newImagePath,
          newImagePath,
          'manual_upload',
          sourceUrl,
          hash,
          imageId,
          verifiedBy
        ]
      );

      await db.run('COMMIT');

      const newRecord = await db.get('SELECT * FROM catalog_images WHERE id = ?', [res.lastID]);
      eventService.broadcast('catalog_image_updated', {
        id: res.lastID,
        medicine_id: current.medicine_id,
        status: 'APPROVED',
        is_active: 1
      });

      return newRecord;
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }
  }

  /**
   * Search and download candidate image online, strictly excluding rejected URLs/hashes
   */
  public async searchAndDownloadCandidate(medicineId: number, retryCount = 1): Promise<CatalogImageRecord | null> {
    if (retryCount > 3) {
      console.warn(`[CatalogImageService] Max retry count (3) reached for medicine ID ${medicineId}. Stopping.`);
      return null;
    }

    const db = await dbManager.getConnection();
    const med = await db.get('SELECT * FROM medicines WHERE id = ?', [medicineId]);
    if (!med) return null;

    // Load blacklist of rejected URLs/hashes for this medicine
    const rejections = await db.all(
      'SELECT rejected_image_url, rejected_image_hash FROM catalog_image_rejections WHERE medicine_id = ?',
      [medicineId]
    );
    const rejectedUrls = new Set(rejections.map(r => r.rejected_image_url).filter(Boolean));
    const rejectedHashes = new Set(rejections.map(r => r.rejected_image_hash).filter(Boolean));

    const cleanQuery = this.extractCoreBrand(med.name) || med.name.replace(/\[.*?\]/g, '').trim();
    const url = `https://pharmeasy.in/api/search/search/?q=${encodeURIComponent(cleanQuery)}&page=1`;

    let products: any[] = [];
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: AbortSignal.timeout(8000)
      });
      if (resp.ok) {
        const json = await resp.json();
        products = json?.data?.products || [];
      }
    } catch (err: any) {
      console.warn(`[CatalogImageService] Online search error for "${cleanQuery}":`, err.message);
      return null;
    }

    if (products.length === 0) return null;

    // Filter candidates that have images and are not blacklisted
    let selectedCandidate: any = null;
    let selectedImageUrl: string | null = null;

    for (const prod of products) {
      const damImages = prod.damImages || [];
      const frontImg = damImages.find((img: any) => img.face === 'front' || img.face === 'default') || (prod.image ? { url: prod.image } : null);
      if (!frontImg || !frontImg.url) continue;

      const candidateUrl = frontImg.url.split('?')[0];
      if (rejectedUrls.has(candidateUrl)) {
        continue; // Skip previously rejected URL
      }

      selectedCandidate = prod;
      selectedImageUrl = candidateUrl;
      break;
    }

    if (!selectedCandidate || !selectedImageUrl) {
      console.log(`[CatalogImageService] No un-rejected candidate found for medicine ${med.name}`);
      return null;
    }

    // Download image
    const slug = med.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
    const filename = `${slug}-candidate-${Date.now()}.jpg`;
    const frontendDir = path.resolve(process.cwd(), 'frontend/public/products');
    const uploadsDir = path.resolve(process.cwd(), 'uploads/products');

    fs.mkdirSync(frontendDir, { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });

    const frontendPath = path.join(frontendDir, filename);
    const uploadsPath = path.join(uploadsDir, filename);

    try {
      const imgRes = await fetch(selectedImageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(10000)
      });
      if (!imgRes.ok) return null;
      const buffer = Buffer.from(await imgRes.arrayBuffer());

      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      if (rejectedHashes.has(hash)) {
        console.warn(`[CatalogImageService] Downloaded image content hash matches previously rejected image for medicine ${med.name}.`);
        return null;
      }

      fs.writeFileSync(frontendPath, buffer);
      fs.writeFileSync(uploadsPath, buffer);

      // Compute multi-signal score
      const matchResult = this.computeConfidence(med, {
        name: selectedCandidate.name,
        manufacturer: selectedCandidate.manufacturer
      });

      const relPath = `/products/${filename}`;

      const isActive = matchResult.verificationStatus === 'HIGH_CONFIDENCE' ? 1 : 0;
      if (isActive === 1) {
        await db.run('UPDATE catalog_images SET is_active = 0 WHERE medicine_id = ?', [med.id]);
      }

      const insertRes = await db.run(
        `INSERT INTO catalog_images (
           medicine_id, company_name, product_name, image_path, thumbnail_path,
           image_source, source_url, image_hash, confidence_score, matching_method,
           verification_status, verification_reason, is_active, retry_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_multi_signal', ?, ?, ?, ?)`,
        [
          med.id,
          med.manufacturer || null,
          selectedCandidate.name,
          relPath,
          relPath,
          'pharmeasy',
          selectedImageUrl,
          hash,
          matchResult.confidenceScore,
          matchResult.verificationStatus,
          matchResult.reason,
          isActive,
          retryCount
        ]
      );

      const record = await db.get('SELECT * FROM catalog_images WHERE id = ?', [insertRes.lastID]);
      eventService.broadcast('catalog_image_updated', {
        id: insertRes.lastID,
        medicine_id: med.id,
        status: matchResult.verificationStatus,
        confidence: matchResult.confidenceScore
      });

      return record;
    } catch (downloadErr: any) {
      console.error(`[CatalogImageService] Download error:`, downloadErr.message);
      return null;
    }
  }

  /**
   * One-time sync/backfill of existing downloaded images from data/image_download_state.json into catalog_images
   */
  public async syncExistingDownloadedImages(): Promise<{
    synced: number;
    skipped: number;
    totalInState: number;
  }> {
    const db = await dbManager.getConnection();
    const stateFile = path.resolve(process.cwd(), 'data/image_download_state.json');
    if (!fs.existsSync(stateFile)) {
      return { synced: 0, skipped: 0, totalInState: 0 };
    }

    const stateData = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    const products = stateData.products || {};
    const entries = Object.entries(products);

    // Pre-load all medicines in memory for O(1) matching
    const medRows = await db.all('SELECT id, name, manufacturer, strength, packaging, mrp FROM medicines');
    const medMap = new Map<string, any>();
    for (const m of medRows) {
      if (m.name) {
        medMap.set(m.name.trim().toLowerCase(), m);
      }
    }

    // Check existing catalog_images to avoid duplicates
    const existingImages = await db.all('SELECT medicine_id, image_path FROM catalog_images');
    const existingSet = new Set(existingImages.map(r => `${r.medicine_id}::${r.image_path}`));

    let synced = 0;
    let skipped = 0;

    await db.run('BEGIN TRANSACTION');
    try {
      for (const [rawName, p] of entries) {
        const item: any = p;
        if (item.status !== 'success' || !item.images) {
          skipped++;
          continue;
        }

        const front = item.images.front || item.images['box-front'] || item.images.default || Object.values(item.images)[0];
        if (!front || !front.url) {
          skipped++;
          continue;
        }

        // Match medicine
        let matchedMed = medMap.get(rawName.trim().toLowerCase());
        if (!matchedMed) {
          // Clean company brackets if any
          const clean = rawName.replace(/\[.*?\]/g, '').trim().toLowerCase();
          matchedMed = medMap.get(clean);
        }

        if (!matchedMed) {
          skipped++;
          continue;
        }

        const imageKey = `${matchedMed.id}::${front.url}`;
        if (existingSet.has(imageKey)) {
          skipped++;
          continue;
        }

        // Compute multi-signal score
        const matchRes = this.computeConfidence(matchedMed, {
          name: item.matched_name || matchedMed.name,
          manufacturer: matchedMed.manufacturer
        });

        const status = matchRes.verificationStatus === 'HIGH_CONFIDENCE' ? 'HIGH_CONFIDENCE' : 'PENDING_REVIEW';
        const isActive = status === 'HIGH_CONFIDENCE' ? 1 : 0;

        await db.run(
          `INSERT INTO catalog_images (
             medicine_id, company_name, product_name, image_path, thumbnail_path,
             image_source, source_url, image_hash, confidence_score, matching_method,
             verification_status, verification_reason, is_active
           ) VALUES (?, ?, ?, ?, ?, 'pharmeasy', ?, NULL, ?, 'ai_multi_signal', ?, ?, ?)`,
          [
            matchedMed.id,
            matchedMed.manufacturer || null,
            item.matched_name || matchedMed.name,
            front.url,
            front.url,
            front.url,
            matchRes.confidenceScore,
            status,
            matchRes.reason,
            isActive
          ]
        );

        existingSet.add(imageKey);
        synced++;
      }

      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }

    return { synced, skipped, totalInState: entries.length };
  }

  /**
   * Check if image file physically exists on disk (Section 7 & 15)
   */
  public verifyImageFileExists(imagePath: string | null): boolean {
    if (!imagePath) return false;
    const cleanPath = imagePath.split('?')[0].replace(/^\/+/, '');
    const p1 = path.resolve(process.cwd(), 'frontend/public', cleanPath);
    const p2 = path.resolve(process.cwd(), cleanPath);
    const p3 = path.resolve(process.cwd(), 'uploads', cleanPath.replace(/^uploads\//, ''));
    return fs.existsSync(p1) || fs.existsSync(p2) || fs.existsSync(p3);
  }

  /**
   * Canonical Image Resolver (Section 15 of PRODUCT IMAGE MISSING.MD)
   * Single source of truth for all application surfaces (Portal, Website Orders, POS, CRM)
   */
  public async resolveProductImage(medicineId: number, options: { version?: boolean } = { version: true }): Promise<{
    url: string;
    status: string;
    id: number;
  } | null> {
    const db = await dbManager.getConnection();
    const row = await db.get(
      `SELECT id, image_path, thumbnail_path, verification_status, updated_at 
       FROM catalog_images 
       WHERE medicine_id = ? AND is_active = 1 AND verification_status IN ('APPROVED', 'HIGH_CONFIDENCE')
       ORDER BY CASE WHEN verification_status = 'APPROVED' THEN 1 ELSE 2 END, id DESC LIMIT 1`,
      [medicineId]
    ).catch(() => null);

    if (!row || !row.image_path) {
      return null;
    }

    // Verify physical file exists on disk
    if (!this.verifyImageFileExists(row.image_path)) {
      // Mark as BROKEN and deactivate to prevent broken 404 image display
      await db.run(
        `UPDATE catalog_images SET is_active = 0, verification_status = 'BROKEN', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [row.id]
      ).catch(() => null);
      return null;
    }

    let url = row.image_path;
    if (options.version && row.updated_at) {
      const v = Math.floor(new Date(row.updated_at).getTime() / 1000) || 1;
      url = `${url}?v=${v}`;
    }

    return {
      url,
      status: row.verification_status,
      id: row.id
    };
  }

  /**
   * Multi-Angle Gallery Resolver for Customer Portal & Website Shop
   * Resolves up to 4-5 verified angle images per medicine (Combined, Front, Back, Box, Tablet)
   */
  public async resolveProductImages(medicineId: number, options: { version?: boolean } = { version: true }): Promise<{
    primaryUrl: string | null;
    images: Record<string, { url: string; type: string; is_primary: boolean }>;
    gallery: Array<{ url: string; type: string; label: string; is_primary: boolean }>;
  }> {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      `SELECT id, image_path, thumbnail_path, image_type, is_primary, verification_status, updated_at 
       FROM catalog_images 
       WHERE medicine_id = ? AND is_active = 1 AND verification_status IN ('APPROVED', 'HIGH_CONFIDENCE')
       ORDER BY 
         is_primary DESC,
         CASE COALESCE(image_type, 'combined')
           WHEN 'combined' THEN 1
           WHEN 'front' THEN 2
           WHEN 'back' THEN 3
           WHEN 'box' THEN 4
           WHEN 'tablet' THEN 5
           ELSE 6
         END ASC,
         id DESC`,
      [medicineId]
    ).catch(() => []);

    const gallery: Array<{ url: string; type: string; label: string; is_primary: boolean }> = [];
    const imagesDict: Record<string, { url: string; type: string; is_primary: boolean }> = {};
    const seenTypes = new Set<string>();

    const LABEL_MAP: Record<string, string> = {
      combined: 'Front & Back (Combined)',
      front: 'Front View',
      back: 'Back / Blister View',
      box: 'Packaging Box',
      tablet: 'Tablet / Pill'
    };

    for (const row of rows) {
      if (!row.image_path) continue;
      if (!this.verifyImageFileExists(row.image_path)) continue;

      const type = (row.image_type || 'combined').toLowerCase();
      if (seenTypes.has(type) && gallery.length >= 4) continue;
      seenTypes.add(type);

      let url = row.image_path;
      if (options.version && row.updated_at) {
        const v = Math.floor(new Date(row.updated_at).getTime() / 1000) || 1;
        url = `${url}?v=${v}`;
      }

      const item = {
        url,
        type,
        label: LABEL_MAP[type] || 'Product View',
        is_primary: row.is_primary === 1 || gallery.length === 0
      };

      gallery.push(item);
      imagesDict[type] = item;
      if (gallery.length >= 4) break;
    }

    const primary = gallery.find(g => g.is_primary) || gallery[0] || null;

    return {
      primaryUrl: primary ? primary.url : null,
      images: imagesDict,
      gallery
    };
  }

  /**
   * Normalize image state cache angles into structured 3-4 image gallery
   */
  public extractGalleryFromState(imgData: any): Array<{ url: string; type: string; label: string; is_primary: boolean }> {
    if (!imgData || !imgData.images) return [];
    const gallery: Array<{ url: string; type: string; label: string; is_primary: boolean }> = [];
    const seenTypes = new Set<string>();

    const LABEL_MAP: Record<string, string> = {
      combined: 'Front & Back (Combined)',
      front: 'Front View',
      back: 'Back / Blister View',
      box: 'Packaging Box',
      tablet: 'Tablet / Pill'
    };

    const typeMapping: Array<{ raw: string; normalized: string }> = [
      { raw: 'combo', normalized: 'combined' },
      { raw: 'combo-front', normalized: 'combined' },
      { raw: 'front', normalized: 'front' },
      { raw: 'back', normalized: 'back' },
      { raw: 'box-front', normalized: 'box' },
      { raw: 'box-back', normalized: 'box' },
      { raw: 'box-side', normalized: 'box' },
      { raw: 'side', normalized: 'tablet' }
    ];

    for (const map of typeMapping) {
      if (seenTypes.has(map.normalized)) continue;
      const imgObj = imgData.images[map.raw];
      if (imgObj && imgObj.url && this.verifyImageFileExists(imgObj.url)) {
        seenTypes.add(map.normalized);
        gallery.push({
          url: imgObj.url,
          type: map.normalized,
          label: LABEL_MAP[map.normalized] || 'Product View',
          is_primary: map.normalized === 'combined' || (gallery.length === 0 && !seenTypes.has('combined'))
        });
      }
      if (gallery.length >= 4) break;
    }

    if (gallery.length === 0) {
      const keys = Object.keys(imgData.images);
      for (const k of keys) {
        const imgObj = imgData.images[k];
        if (imgObj && imgObj.url && this.verifyImageFileExists(imgObj.url)) {
          gallery.push({
            url: imgObj.url,
            type: 'front',
            label: 'Front View',
            is_primary: true
          });
          break;
        }
      }
    }

    return gallery;
  }

  /**
   * Backfill all available secondary angles (back, box, tablet, combined) from data/image_download_state.json
   */
  public async syncMultiAngleImages(): Promise<{ added: number; total: number }> {
    const db = await dbManager.getConnection();
    const stateFile = path.resolve(process.cwd(), 'data/image_download_state.json');
    if (!fs.existsSync(stateFile)) {
      return { added: 0, total: 0 };
    }

    const stateData = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    const products = stateData.products || {};
    const entries = Object.entries(products);

    const meds = await db.all('SELECT id, name, manufacturer FROM medicines');
    const medMap = new Map<string, any>();
    for (const m of meds) {
      if (m.name) medMap.set(m.name.trim().toLowerCase(), m);
    }

    const existing = await db.all('SELECT medicine_id, image_path, image_type FROM catalog_images');
    const existingSet = new Set(existing.map((e: any) => `${e.medicine_id}::${e.image_path}`));
    const existingTypes = new Map<number, Set<string>>();
    for (const e of existing) {
      if (!existingTypes.has(e.medicine_id)) existingTypes.set(e.medicine_id, new Set());
      existingTypes.get(e.medicine_id)!.add(e.image_type || 'combined');
    }

    const typeMapping: Array<{ raw: string; normalized: string; slot: number }> = [
      { raw: 'combo', normalized: 'combined', slot: 1 },
      { raw: 'combo-front', normalized: 'combined', slot: 1 },
      { raw: 'front', normalized: 'front', slot: 2 },
      { raw: 'back', normalized: 'back', slot: 3 },
      { raw: 'box-front', normalized: 'box', slot: 4 },
      { raw: 'box-back', normalized: 'box', slot: 4 },
      { raw: 'side', normalized: 'tablet', slot: 5 }
    ];

    let added = 0;
    await db.run('BEGIN TRANSACTION');
    try {
      for (const [rawName, p] of entries) {
        const item: any = p;
        if (item.status !== 'success' || !item.images) continue;
        let med = medMap.get(rawName.trim().toLowerCase());
        if (!med) {
          const clean = rawName.replace(/\[.*?\]/g, '').trim().toLowerCase();
          med = medMap.get(clean);
        }
        if (!med) continue;

        const currentTypes = existingTypes.get(med.id) || new Set();

        for (const tm of typeMapping) {
          const imgObj = item.images[tm.raw];
          if (!imgObj || !imgObj.url) continue;
          if (!this.verifyImageFileExists(imgObj.url)) continue;

          const key = `${med.id}::${imgObj.url}`;
          if (existingSet.has(key)) continue;
          if (currentTypes.has(tm.normalized)) continue;

          const isPrimary = tm.normalized === 'combined' ? 1 : 0;

          await db.run(
            `INSERT INTO catalog_images (
               medicine_id, company_name, product_name, image_path, thumbnail_path,
               image_source, source_url, image_hash, confidence_score, matching_method,
               verification_status, verification_reason, is_active, image_type, is_primary, slot_number
             ) VALUES (?, ?, ?, ?, ?, 'pharmeasy', ?, NULL, 90, 'state_sync', 'HIGH_CONFIDENCE', 'Downloaded angle', 1, ?, ?, ?)`,
            [
              med.id,
              med.manufacturer || null,
              item.matched_name || med.name,
              imgObj.url,
              imgObj.url,
              imgObj.url,
              tm.normalized,
              isPrimary,
              tm.slot
            ]
          );

          currentTypes.add(tm.normalized);
          existingSet.add(key);
          added++;
        }
      }
      await db.run('COMMIT');
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }

    return { added, total: entries.length };
  }

  /**
   * Multi-tier query generation for pharmaceutical search (Section 10 & 34)
   */
  public generateAccurateQueries(rawName: string, mfg?: string | null): string[] {
    const queries: string[] = [];
    const clean = rawName
      .replace(/\[.*?\]/g, ' ')
      .replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Known specific clinical mappings
    if (/^BUDETROL\b/i.test(rawName)) {
      const str = rawName.match(/\b\d+(?:\.\d+)?\s*(?:MCG|MG)\b/i)?.[0] || '400';
      queries.push(`Budetrol ${str}`, `Budetrol Inhalation`);
    } else if (/^THYROX\b/i.test(rawName)) {
      const str = rawName.match(/\b\d+(?:\.\d+)?\s*(?:MCG|MG)\b/i)?.[0] || '';
      queries.push(`Thyrox ${str} Macleods`, `Thyrox ${str}`, `Thyrox`);
    } else if (/^DAPARYL\b/i.test(rawName)) {
      const str = rawName.match(/\b\d+(?:\.\d+)?\s*(?:MCG|MG)\b/i)?.[0] || '';
      queries.push(`Daparyl ${str}`, `Daparyl`);
    } else if (/^VOGS M\b/i.test(rawName)) {
      const str = rawName.match(/\b\d+(?:\.\d+)?\s*(?:MCG|MG)\b/i)?.[0] || '';
      queries.push(`Vogs M ${str}`, `Vogs M`);
    } else if (/^O2 TAB/i.test(rawName)) {
      queries.push('O2 Tablet', 'O2 Medley Tablet');
    }

    // Tier 1: Core Brand + Strength
    const brand = this.extractCoreBrand(rawName);
    const strength = this.extractStrength(rawName);
    if (brand && strength) {
      queries.push(`${brand} ${strength}`);
    }

    // Tier 2: Cleaned Name
    queries.push(clean);

    // Tier 3: Core Brand + Manufacturer
    if (brand && mfg) {
      const cleanMfg = mfg.replace(/^(M\/s\.|M\/S|M\/R|LTD|LIMITED|PVT|PHARMA|PHARMACEUTICALS)\s*/gi, '').trim().split(/\s+/)[0];
      if (cleanMfg && cleanMfg.length >= 3) {
        queries.push(`${brand} ${cleanMfg}`);
      }
    }

    // Tier 4: Core Brand alone
    if (brand) {
      queries.push(brand);
    }

    return Array.from(new Set(queries.filter(q => q && q.trim().length >= 2)));
  }

  /**
   * Batch auto-approve high-confidence pending images (Section 10 & 34)
   * Promotes PENDING_REVIEW images with score >= 80% and verified physical file to HIGH_CONFIDENCE and active.
   */
  public async autoApproveHighConfidence(): Promise<{
    evaluated: number;
    approved: number;
    skipped: number;
  }> {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      `SELECT ci.id, ci.medicine_id, ci.product_name, ci.confidence_score, ci.image_path,
              m.name as med_name, m.manufacturer, m.strength, m.packaging
       FROM catalog_images ci
       JOIN medicines m ON m.id = ci.medicine_id
       WHERE ci.is_active = 0 AND ci.verification_status IN ('PENDING_REVIEW', 'HIGH_CONFIDENCE')`
    );

    let approved = 0;
    let skipped = 0;

    await db.run('BEGIN TRANSACTION');
    try {
      for (const row of rows) {
        // 1. Verify physical file exists
        if (!this.verifyImageFileExists(row.image_path)) {
          skipped++;
          continue;
        }

        // 2. Re-verify confidence with current calibrated engine
        const matchRes = this.computeConfidence(
          {
            name: row.med_name,
            manufacturer: row.manufacturer,
            strength: row.strength,
            packaging: row.packaging
          },
          {
            name: row.product_name,
            manufacturer: row.manufacturer
          }
        );

        if (matchRes.verificationStatus === 'HIGH_CONFIDENCE' || matchRes.confidenceScore >= 80) {
          // Deactivate any other active image for this medicine
          await db.run(
            'UPDATE catalog_images SET is_active = 0 WHERE medicine_id = ? AND id != ?',
            [row.medicine_id, row.id]
          );

          // Activate this image
          await db.run(
            `UPDATE catalog_images 
             SET verification_status = 'HIGH_CONFIDENCE',
                 confidence_score = ?,
                 verification_reason = ?,
                 is_active = 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [matchRes.confidenceScore, matchRes.reason, row.id]
          );
          approved++;
        } else {
          skipped++;
        }
      }

      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }

    eventService.broadcast('catalog_image_updated', {
      action: 'auto_approve_completed',
      approved,
      evaluated: rows.length
    });

    return { evaluated: rows.length, approved, skipped };
  }

  /**
   * Image Health Auditor (Section 6, 7, 19, 34 of PRODUCT IMAGE MISSING.MD)
   * Audits all database medicines and monthly refill catalog items.
   */
  public async auditImageHealth(): Promise<{
    summary: {
      totalMedicines: number;
      refillCatalogMedicines: number;
      healthyActive: number;
      missing: number;
      broken: number;
      pendingReview: number;
      approved: number;
      highConfidence: number;
      rejected: number;
    };
    refillMissingItems: Array<{ name: string; category: string; reason: string }>;
  }> {
    const db = await dbManager.getConnection();

    // 1. Total DB medicines
    const totalMedsRow = await db.get('SELECT COUNT(*) as count FROM medicines');
    const totalMedicines = totalMedsRow ? totalMedsRow.count : 0;

    // 2. Status counts from catalog_images
    const statusRows = await db.all(
      `SELECT verification_status, is_active, COUNT(*) as count 
       FROM catalog_images 
       GROUP BY verification_status, is_active`
    );

    let approved = 0;
    let highConfidence = 0;
    let pendingReview = 0;
    let rejected = 0;

    for (const r of statusRows) {
      if (r.verification_status === 'APPROVED') approved += r.count;
      else if (r.verification_status === 'HIGH_CONFIDENCE') highConfidence += r.count;
      else if (r.verification_status === 'PENDING_REVIEW') pendingReview += r.count;
      else if (r.verification_status === 'REJECTED') rejected += r.count;
    }

    // 3. Scan active images to verify physical disk existence
    const activeRows = await db.all(
      `SELECT id, medicine_id, image_path FROM catalog_images WHERE is_active = 1`
    );
    let healthyActive = 0;
    let broken = 0;

    for (const img of activeRows) {
      if (this.verifyImageFileExists(img.image_path)) {
        healthyActive++;
      } else {
        broken++;
      }
    }

    // 4. Audit Refill Catalog CSV (561 public website items)
    const refillMissingItems: Array<{ name: string; category: string; reason: string }> = [];
    let refillCatalogMedicines = 0;

    try {
      const csvPath = path.resolve(process.cwd(), 'CATALOG/monthly_refill_master_list.csv');
      if (fs.existsSync(csvPath)) {
        const content = fs.readFileSync(csvPath, 'utf-8');
        const lines = content.split(/\r?\n/).slice(1);
        for (const line of lines) {
          if (!line.trim()) continue;
          refillCatalogMedicines++;
          const parts = line.split(',');
          const category = parts[0]?.replace(/^"|"$/g, '').trim() || '';
          const name = parts[1]?.replace(/^"|"$/g, '').trim() || '';
          if (!name) continue;

          const med = await db.get(
            `SELECT id FROM medicines WHERE name = ? OR name LIKE ? LIMIT 1`,
            [name, `${name.split(' ')[0]}%`]
          );
          if (!med) {
            refillMissingItems.push({ name, category, reason: 'Medicine not linked in DB' });
            continue;
          }

          const activeImg = await db.get(
            `SELECT image_path FROM catalog_images WHERE medicine_id = ? AND is_active = 1 LIMIT 1`,
            [med.id]
          );

          if (!activeImg) {
            refillMissingItems.push({ name, category, reason: 'No active image record' });
          } else if (!this.verifyImageFileExists(activeImg.image_path)) {
            refillMissingItems.push({ name, category, reason: 'Physical image file missing on disk' });
          }
        }
      }
    } catch (_) {}

    const missing = Math.max(0, totalMedicines - healthyActive);

    return {
      summary: {
        totalMedicines,
        refillCatalogMedicines,
        healthyActive,
        missing,
        broken,
        pendingReview,
        approved,
        highConfidence,
        rejected
      },
      refillMissingItems
    };
  }

  /**
   * Bulk Missing Image Re-check & Auto-Repair Pipeline (Section 18 & 34 of PRODUCT IMAGE MISSING.MD)
   * Scans medicines that lack an active verified image, generates tiered queries, downloads candidates,
   * validates against product brand and strength, and activates high-confidence images.
   */
  public async repairMissingImages(limit = 50): Promise<{
    scanned: number;
    repaired: number;
    failed: number;
    results: Array<{ medicine_id: number; name: string; status: string; matched_name?: string; reason?: string }>;
  }> {
    const db = await dbManager.getConnection();
    const results: Array<{ medicine_id: number; name: string; status: string; matched_name?: string; reason?: string }> = [];

    // Prioritize refill catalog medicines that are missing images
    const targetMeds: Array<{ id: number; name: string; manufacturer: string | null; strength: string | null; packaging: string | null }> = [];
    const seenIds = new Set<number>();

    try {
      const csvPath = path.resolve(process.cwd(), 'CATALOG/monthly_refill_master_list.csv');
      if (fs.existsSync(csvPath)) {
        const content = fs.readFileSync(csvPath, 'utf-8');
        const lines = content.split(/\r?\n/).slice(1);
        for (const line of lines) {
          if (!line.trim()) continue;
          const parts = line.split(',');
          const name = parts[1]?.replace(/^"|"$/g, '').trim() || '';
          if (!name) continue;

          const med = await db.get(
            `SELECT m.id, m.name, m.manufacturer, m.strength, m.packaging,
                    (SELECT COUNT(*) FROM catalog_images ci WHERE ci.medicine_id = m.id AND ci.is_active = 1) as active_count
             FROM medicines m WHERE m.name = ? OR m.name LIKE ? LIMIT 1`,
            [name, `${name.split(' ')[0]}%`]
          );

          if (med && med.active_count === 0 && !seenIds.has(med.id)) {
            seenIds.add(med.id);
            targetMeds.push(med);
            if (targetMeds.length >= limit) break;
          }
        }
      }
    } catch (_) {}

    // If still have room, add general DB medicines without active image
    if (targetMeds.length < limit) {
      const remainingLimit = limit - targetMeds.length;
      const additional = await db.all(
        `SELECT m.id, m.name, m.manufacturer, m.strength, m.packaging
         FROM medicines m
         WHERE m.id NOT IN (SELECT medicine_id FROM catalog_images WHERE is_active = 1)
         ORDER BY m.id ASC
         LIMIT ?`,
        [remainingLimit]
      );
      for (const m of additional) {
        if (!seenIds.has(m.id)) {
          seenIds.add(m.id);
          targetMeds.push(m);
        }
      }
    }

    let repaired = 0;
    let failed = 0;

    for (const med of targetMeds) {
      try {
        const queries = this.generateAccurateQueries(med.name, med.manufacturer);
        let matchedCandidate: any = null;
        let matchedImageUrl: string | null = null;
        let bestScoreResult: MatchScoreResult | null = null;

        // Query rejections blacklist
        const rejections = await db.all(
          'SELECT rejected_image_url, rejected_image_hash FROM catalog_image_rejections WHERE medicine_id = ?',
          [med.id]
        );
        const rejectedUrls = new Set(rejections.map(r => r.rejected_image_url).filter(Boolean));
        const rejectedHashes = new Set(rejections.map(r => r.rejected_image_hash).filter(Boolean));

        for (const query of queries) {
          const url = `https://pharmeasy.in/api/search/search/?q=${encodeURIComponent(query)}&page=1`;
          try {
            const resp = await fetch(url, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
              signal: AbortSignal.timeout(6000)
            });
            if (!resp.ok) continue;
            const json = await resp.json();
            const products = json?.data?.products || [];

            for (const prod of products) {
              const damImages = prod.damImages || [];
              const frontImg = damImages.find((img: any) => img.face === 'front' || img.face === 'box-front' || img.face === 'default') || (prod.image ? { url: prod.image } : null);
              if (!frontImg || !frontImg.url) continue;

              const candidateUrl = frontImg.url.split('?')[0];
              if (rejectedUrls.has(candidateUrl)) continue;

              const matchRes = this.computeConfidence(med, {
                name: prod.name,
                manufacturer: prod.manufacturer
              });

              // Strictly reject brand mismatches or strength conflicts
              if (matchRes.verificationStatus === 'REJECTED' || !matchRes.signals.brandMatch || matchRes.signals.strengthConflict) {
                continue;
              }

              if (matchRes.confidenceScore >= 75) {
                matchedCandidate = prod;
                matchedImageUrl = candidateUrl;
                bestScoreResult = matchRes;
                break;
              }
            }
          } catch (_) {}

          if (matchedCandidate) break;
          await new Promise(r => setTimeout(r, 100)); // anti-hammer pacing
        }

        if (!matchedCandidate || !matchedImageUrl || !bestScoreResult) {
          failed++;
          results.push({
            medicine_id: med.id,
            name: med.name,
            status: 'NOT_FOUND',
            reason: 'No high-confidence non-conflicting online image candidate found'
          });
          continue;
        }

        // Download candidate image
        const slug = med.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50);
        const filename = `${slug}-${Date.now()}.jpg`;
        const frontendDir = path.resolve(process.cwd(), 'frontend/public/products');
        const uploadsDir = path.resolve(process.cwd(), 'uploads/products');

        fs.mkdirSync(frontendDir, { recursive: true });
        fs.mkdirSync(uploadsDir, { recursive: true });

        const frontendPath = path.join(frontendDir, filename);
        const uploadsPath = path.join(uploadsDir, filename);

        const imgRes = await fetch(matchedImageUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(8000)
        });
        if (!imgRes.ok) {
          failed++;
          results.push({ medicine_id: med.id, name: med.name, status: 'DOWNLOAD_FAILED' });
          continue;
        }

        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        if (rejectedHashes.has(hash)) {
          failed++;
          results.push({ medicine_id: med.id, name: med.name, status: 'HASH_BLACKLISTED' });
          continue;
        }

        fs.writeFileSync(frontendPath, buffer);
        fs.writeFileSync(uploadsPath, buffer);

        const relPath = `/products/${filename}`;
        const isHighConfidence = bestScoreResult.verificationStatus === 'HIGH_CONFIDENCE' || bestScoreResult.confidenceScore >= 80;
        const status = isHighConfidence ? 'HIGH_CONFIDENCE' : 'PENDING_REVIEW';
        const isActive = isHighConfidence ? 1 : 0;

        await db.run('BEGIN TRANSACTION');
        if (isActive === 1) {
          await db.run('UPDATE catalog_images SET is_active = 0 WHERE medicine_id = ?', [med.id]);
        }

        await db.run(
          `INSERT INTO catalog_images (
             medicine_id, company_name, product_name, image_path, thumbnail_path,
             image_source, source_url, image_hash, confidence_score, matching_method,
             verification_status, verification_reason, is_active
           ) VALUES (?, ?, ?, ?, ?, 'pharmeasy', ?, ?, ?, 'ai_multi_signal', ?, ?, ?)`,
          [
            med.id,
            med.manufacturer || null,
            matchedCandidate.name,
            relPath,
            relPath,
            matchedImageUrl,
            hash,
            bestScoreResult.confidenceScore,
            status,
            bestScoreResult.reason,
            isActive
          ]
        );
        await db.run('COMMIT');

        // Also keep legacy state file in sync
        try {
          const stateFile = path.resolve(process.cwd(), 'data/image_download_state.json');
          if (fs.existsSync(stateFile)) {
            const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
            if (!state.products) state.products = {};
            state.products[med.name] = {
              status: 'success',
              matched_name: matchedCandidate.name,
              slug,
              images: {
                front: {
                  fileName: filename,
                  url: relPath,
                  uploadsUrl: `/uploads/products/${filename}`,
                  bytes: buffer.length
                }
              },
              verified: isHighConfidence,
              updated_at: new Date().toISOString()
            };
            state.last_updated = new Date().toISOString();
            fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
          }
        } catch (_) {}

        repaired++;
        results.push({
          medicine_id: med.id,
          name: med.name,
          status,
          matched_name: matchedCandidate.name,
          reason: bestScoreResult.reason
        });
      } catch (err: any) {
        failed++;
        results.push({
          medicine_id: med.id,
          name: med.name,
          status: 'ERROR',
          reason: err.message
        });
      }
    }

    eventService.broadcast('catalog_image_updated', {
      action: 'repair_batch_completed',
      repaired,
      failed,
      scanned: targetMeds.length
    });

    return {
      scanned: targetMeds.length,
      repaired,
      failed,
      results
    };
  }

  /**
   * Dedicated Correction Queue:
   * Returns unresolved images (PENDING_REVIEW, PENDING, INCORRECT)
   * where next_review_at is NULL or <= CURRENT_TIMESTAMP.
   * Excludes CORRECT, APPROVED, CORRECTED, and active SKIPPED.
   */
  public async getCorrectionQueue(options: {
    category?: string;
    search?: string;
    status?: 'unresolved' | 'pending' | 'incorrect' | 'skipped' | 'all';
    page?: number;
    limit?: number;
  }): Promise<{
    images: CatalogImageRecord[];
    totalCount: number;
    totalPages: number;
    page: number;
    categories: Array<{ category: string; count: number }>;
  }> {
    const db = await dbManager.getConnection();
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const offset = (page - 1) * limit;

    let whereSql = '1=1';
    const params: any[] = [];

    const statusMode = options.status || 'unresolved';
    if (statusMode === 'unresolved') {
      whereSql += ` AND ci.verification_status IN ('PENDING_REVIEW', 'PENDING', 'INCORRECT') 
                    AND (ci.next_review_at IS NULL OR ci.next_review_at <= CURRENT_TIMESTAMP)`;
    } else if (statusMode === 'pending') {
      whereSql += ` AND ci.verification_status IN ('PENDING_REVIEW', 'PENDING') 
                    AND (ci.next_review_at IS NULL OR ci.next_review_at <= CURRENT_TIMESTAMP)`;
    } else if (statusMode === 'incorrect') {
      whereSql += ` AND ci.verification_status = 'INCORRECT'`;
    } else if (statusMode === 'skipped') {
      whereSql += ` AND ci.verification_status = 'SKIPPED' AND ci.next_review_at > CURRENT_TIMESTAMP`;
    }

    if (options.category && options.category !== 'all' && options.category !== 'All Categories') {
      whereSql += ` AND (m.category = ? OR m.packaging LIKE ? OR m.name LIKE ?)`;
      params.push(options.category, `%${options.category}%`, `%${options.category}%`);
    }

    if (options.search) {
      whereSql += ' AND (ci.product_name LIKE ? OR m.name LIKE ? OR ci.company_name LIKE ? OR m.generic_name LIKE ?)';
      const term = `%${options.search}%`;
      params.push(term, term, term, term);
    }

    const countRow = await db.get(
      `SELECT COUNT(*) as count 
       FROM catalog_images ci 
       LEFT JOIN medicines m ON m.id = ci.medicine_id 
       WHERE ${whereSql}`,
      params
    );
    const totalCount = countRow ? countRow.count : 0;

    const rows = await db.all(
      `SELECT ci.*, 
              m.name as medicine_name, 
              m.generic_name, 
              m.strength, 
              m.packaging, 
              m.mrp, 
              m.manufacturer,
              m.category
       FROM catalog_images ci 
       LEFT JOIN medicines m ON m.id = ci.medicine_id 
       WHERE ${whereSql}
       ORDER BY 
         CASE WHEN ci.verification_status = 'INCORRECT' THEN 1
              WHEN ci.verification_status IN ('PENDING_REVIEW', 'PENDING') THEN 2
              ELSE 3 END,
         ci.id ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Compute category counters for pills (Tabs, Caps, Syrups, Injections, Ointments, Drops, etc.)
    const categoryTokens = ['TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'CREAM', 'DROPS', 'POWDER'];
    const categories: Array<{ category: string; count: number }> = [];

    // Total unresolved
    const unresolvedTotal = await db.get(
      `SELECT COUNT(*) as count 
       FROM catalog_images ci 
       WHERE ci.verification_status IN ('PENDING_REVIEW', 'PENDING', 'INCORRECT')
         AND (ci.next_review_at IS NULL OR ci.next_review_at <= CURRENT_TIMESTAMP)`
    );
    categories.push({ category: 'All Categories', count: unresolvedTotal?.count || 0 });

    for (const token of categoryTokens) {
      const catCount = await db.get(
        `SELECT COUNT(*) as count 
         FROM catalog_images ci 
         LEFT JOIN medicines m ON m.id = ci.medicine_id 
         WHERE ci.verification_status IN ('PENDING_REVIEW', 'PENDING', 'INCORRECT')
           AND (ci.next_review_at IS NULL OR ci.next_review_at <= CURRENT_TIMESTAMP)
           AND (m.packaging LIKE ? OR m.name LIKE ?)`,
        [`%${token}%`, `%${token}%`]
      );
      if (catCount && catCount.count > 0) {
        categories.push({ category: token, count: catCount.count });
      }
    }

    return {
      images: rows,
      totalCount,
      totalPages: Math.ceil(totalCount / limit) || 1,
      page,
      categories
    };
  }

  /**
   * Quality Dashboard & Verification Stats
   */
  public async getCorrectionStats(): Promise<{
    pending: number;
    incorrect: number;
    corrected: number;
    verified: number;
    skipped: number;
    total: number;
    accuracyPercent: number;
    verifiedToday: number;
    correctedToday: number;
  }> {
    const db = await dbManager.getConnection();

    const pendingRow = await db.get(
      `SELECT COUNT(*) as c FROM catalog_images 
       WHERE verification_status IN ('PENDING_REVIEW', 'PENDING')
         AND (next_review_at IS NULL OR next_review_at <= CURRENT_TIMESTAMP)`
    );
    const incorrectRow = await db.get(
      `SELECT COUNT(*) as c FROM catalog_images WHERE verification_status = 'INCORRECT'`
    );
    const correctedRow = await db.get(
      `SELECT COUNT(*) as c FROM catalog_images WHERE verification_status = 'CORRECTED'`
    );
    const verifiedRow = await db.get(
      `SELECT COUNT(*) as c FROM catalog_images WHERE verification_status IN ('APPROVED', 'CORRECT')`
    );
    const skippedRow = await db.get(
      `SELECT COUNT(*) as c FROM catalog_images WHERE verification_status = 'SKIPPED' AND next_review_at > CURRENT_TIMESTAMP`
    );
    const totalRow = await db.get(`SELECT COUNT(*) as c FROM catalog_images`);

    const verifiedTodayRow = await db.get(
      `SELECT COUNT(*) as c FROM image_review_history 
       WHERE action = 'MARK_CORRECT' AND DATE(performed_at) = DATE('now')`
    );
    const correctedTodayRow = await db.get(
      `SELECT COUNT(*) as c FROM image_review_history 
       WHERE action = 'IMAGE_REPLACED' AND DATE(performed_at) = DATE('now')`
    );

    const pending = pendingRow?.c || 0;
    const incorrect = incorrectRow?.c || 0;
    const corrected = correctedRow?.c || 0;
    const verified = verifiedRow?.c || 0;
    const skipped = skippedRow?.c || 0;
    const total = totalRow?.c || 0;

    const accurateCount = verified + corrected;
    const evaluatedTotal = accurateCount + incorrect + pending;
    const accuracyPercent = evaluatedTotal > 0 ? Math.round((accurateCount / evaluatedTotal) * 100) : 100;

    return {
      pending,
      incorrect,
      corrected,
      verified,
      skipped,
      total,
      accuracyPercent,
      verifiedToday: verifiedTodayRow?.c || 0,
      correctedToday: correctedTodayRow?.c || 0
    };
  }

  /**
   * Action: Mark image as CORRECT
   */
  public async markImageCorrect(
    imageId: number, 
    verifiedBy = 'admin',
    imageType?: string,
    isPrimary?: boolean
  ): Promise<boolean> {
    const db = await dbManager.getConnection();
    const current = await db.get('SELECT * FROM catalog_images WHERE id = ?', [imageId]);
    if (!current) return false;

    const targetType = imageType || current.image_type || 'combined';
    let primaryVal = isPrimary ? 1 : 0;
    if (isPrimary === undefined) {
      if (targetType === 'combined') {
        primaryVal = 1;
      } else {
        const existingPrimary = await db.get(
          'SELECT id FROM catalog_images WHERE medicine_id = ? AND is_primary = 1 AND is_active = 1',
          [current.medicine_id]
        );
        primaryVal = existingPrimary ? 0 : 1;
      }
    }

    await db.run('BEGIN TRANSACTION');
    try {
      // 1. Deactivate other active images of the same type for this medicine
      await db.run(
        'UPDATE catalog_images SET is_active = 0 WHERE medicine_id = ? AND image_type = ? AND id != ?',
        [current.medicine_id, targetType, imageId]
      );

      // If primary, clear is_primary on other images for this medicine
      if (primaryVal === 1) {
        await db.run(
          'UPDATE catalog_images SET is_primary = 0 WHERE medicine_id = ? AND id != ?',
          [current.medicine_id, imageId]
        );
      }

      // 2. Mark as APPROVED / CORRECT
      const nextVersion = (current.verification_version || 1) + 1;
      await db.run(
        `UPDATE catalog_images 
         SET verification_status = 'APPROVED', 
             is_active = 1, 
             image_type = ?,
             is_primary = ?,
             verified_by = ?, 
             verified_at = CURRENT_TIMESTAMP, 
             verification_version = ?,
             locked_by = NULL,
             locked_at = NULL,
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [targetType, primaryVal, verifiedBy, nextVersion, imageId]
      );

      // 3. Record in audit history
      await db.run(
        `INSERT INTO image_review_history (
           product_image_id, medicine_id, previous_status, new_status,
           previous_image_url, new_image_url, action, reason, performed_by
         ) VALUES (?, ?, ?, 'APPROVED', ?, ?, 'MARK_CORRECT', 'Confirmed correct by human agent', ?)`,
        [
          imageId,
          current.medicine_id,
          current.verification_status,
          current.image_path,
          current.image_path,
          verifiedBy
        ]
      );

      await db.run('COMMIT');

      eventService.broadcast('catalog_image_updated', {
        id: imageId,
        medicine_id: current.medicine_id,
        status: 'APPROVED',
        image_type: targetType,
        is_primary: primaryVal,
        is_active: 1
      });

      return true;
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  }

  /**
   * Action: Mark image as INCORRECT or trigger smart angle workflow
   */
  public async markImageIncorrect(
    imageId: number, 
    reason = 'Incorrect image', 
    verifiedBy = 'admin',
    reasonCode?: string
  ): Promise<{ success: boolean; action?: string; targetType?: string; medicineId?: number; message?: string }> {
    const db = await dbManager.getConnection();
    const current = await db.get('SELECT * FROM catalog_images WHERE id = ?', [imageId]);
    if (!current) return { success: false, message: 'Image not found' };

    // Smart Handler: Need backside image (Current image is valid Front; search for Backside)
    if (reasonCode === 'NEED_BACKSIDE') {
      await db.run('BEGIN TRANSACTION');
      try {
        await db.run(
          `UPDATE catalog_images 
           SET image_type = 'front', 
               verification_status = 'APPROVED', 
               is_active = 1,
               verified_by = ?, 
               verified_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [verifiedBy, imageId]
        );

        await db.run(
          `INSERT INTO image_review_history (
             product_image_id, medicine_id, previous_status, new_status,
             previous_image_url, new_image_url, action, reason, performed_by
           ) VALUES (?, ?, ?, 'APPROVED', ?, ?, 'NEED_BACKSIDE', ?, ?)`,
          [imageId, current.medicine_id, current.verification_status, current.image_path, current.image_path, reason, verifiedBy]
        );

        await db.run('COMMIT');

        eventService.broadcast('catalog_image_updated', {
          id: imageId,
          medicine_id: current.medicine_id,
          status: 'APPROVED',
          image_type: 'front',
          is_active: 1
        });

        return {
          success: true,
          action: 'search_candidate',
          targetType: 'back',
          medicineId: current.medicine_id,
          message: 'Front image verified! Opening search for Backside image.'
        };
      } catch (err) {
        await db.run('ROLLBACK');
        throw err;
      }
    }

    // Smart Handler: Need front side image (Current image is Back/Box; search for Front)
    if (reasonCode === 'NEED_FRONT') {
      await db.run('BEGIN TRANSACTION');
      try {
        await db.run(
          `UPDATE catalog_images 
           SET image_type = 'back', 
               verification_status = 'APPROVED', 
               is_active = 1,
               verified_by = ?, 
               verified_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [verifiedBy, imageId]
        );

        await db.run(
          `INSERT INTO image_review_history (
             product_image_id, medicine_id, previous_status, new_status,
             previous_image_url, new_image_url, action, reason, performed_by
           ) VALUES (?, ?, ?, 'APPROVED', ?, ?, 'NEED_FRONT', ?, ?)`,
          [imageId, current.medicine_id, current.verification_status, current.image_path, current.image_path, reason, verifiedBy]
        );

        await db.run('COMMIT');

        eventService.broadcast('catalog_image_updated', {
          id: imageId,
          medicine_id: current.medicine_id,
          status: 'APPROVED',
          image_type: 'back',
          is_active: 1
        });

        return {
          success: true,
          action: 'search_candidate',
          targetType: 'front',
          medicineId: current.medicine_id,
          message: 'Current image saved as Back! Opening search for Front image.'
        };
      } catch (err) {
        await db.run('ROLLBACK');
        throw err;
      }
    }

    // General Rejection: WRONG_PRODUCT, WRONG_VARIANT, POOR_QUALITY, OLD_PACKAGING, CUSTOM
    await db.run('BEGIN TRANSACTION');
    try {
      const nextVersion = (current.verification_version || 1) + 1;
      await db.run(
        `UPDATE catalog_images 
         SET verification_status = 'INCORRECT', 
             is_active = 0, 
             verification_reason = ?, 
             verified_by = ?, 
             verified_at = CURRENT_TIMESTAMP, 
             verification_version = ?,
             locked_by = NULL,
             locked_at = NULL,
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [reason, verifiedBy, nextVersion, imageId]
      );

      // Blacklist to prevent recurring wrong suggestions
      if (current.source_url || current.image_hash) {
        await db.run(
          `INSERT INTO catalog_image_rejections (medicine_id, rejected_image_url, rejected_image_hash, rejected_source, reason) 
           VALUES (?, ?, ?, ?, ?)`,
          [current.medicine_id, current.source_url || null, current.image_hash || null, current.image_source || 'pharmeasy', reason]
        );
      }

      // Record in audit history
      await db.run(
        `INSERT INTO image_review_history (
           product_image_id, medicine_id, previous_status, new_status,
           previous_image_url, new_image_url, action, reason, performed_by
         ) VALUES (?, ?, ?, 'INCORRECT', ?, ?, 'MARK_INCORRECT', ?, ?)`,
        [
          imageId,
          current.medicine_id,
          current.verification_status,
          current.image_path,
          current.image_path,
          reason,
          verifiedBy
        ]
      );

      await db.run('COMMIT');

      eventService.broadcast('catalog_image_updated', {
        id: imageId,
        medicine_id: current.medicine_id,
        status: 'INCORRECT',
        is_active: 0
      });

      return {
        success: true,
        action: 'flagged_incorrect',
        medicineId: current.medicine_id,
        message: 'Image flagged as incorrect.'
      };
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  }

  /**
   * Action: Skip image review temporarily with cooldown
   */
  public async skipImage(imageId: number, hours = 24, reason = 'Temporarily skipped', verifiedBy = 'admin'): Promise<boolean> {
    const db = await dbManager.getConnection();
    const current = await db.get('SELECT * FROM catalog_images WHERE id = ?', [imageId]);
    if (!current) return false;

    const nextReview = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    const nextVersion = (current.verification_version || 1) + 1;

    await db.run('BEGIN TRANSACTION');
    try {
      await db.run(
        `UPDATE catalog_images 
         SET verification_status = 'SKIPPED', 
             skip_reason = ?, 
             next_review_at = ?, 
             verification_version = ?,
             locked_by = NULL,
             locked_at = NULL,
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [reason, nextReview, nextVersion, imageId]
      );

      await db.run(
        `INSERT INTO image_review_history (
           product_image_id, medicine_id, previous_status, new_status,
           previous_image_url, new_image_url, action, reason, performed_by, metadata
         ) VALUES (?, ?, ?, 'SKIPPED', ?, ?, 'IMAGE_SKIPPED', ?, ?, ?)`,
        [
          imageId,
          current.medicine_id,
          current.verification_status,
          current.image_path,
          current.image_path,
          reason,
          verifiedBy,
          JSON.stringify({ next_review_at: nextReview, skip_hours: hours })
        ]
      );

      await db.run('COMMIT');

      eventService.broadcast('catalog_image_updated', {
        id: imageId,
        medicine_id: current.medicine_id,
        status: 'SKIPPED',
        next_review_at: nextReview
      });

      return true;
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  }

  /**
   * Search internet candidate images for review & correction
   */
  public async searchCandidates(medicineId: number, queryOverride?: string, imageType: string = 'combined'): Promise<CandidateImage[]> {
    const db = await dbManager.getConnection();
    const med = await db.get('SELECT * FROM medicines WHERE id = ?', [medicineId]);
    if (!med) return [];

    const rejections = await db.all(
      'SELECT rejected_image_url, rejected_image_hash FROM catalog_image_rejections WHERE medicine_id = ?',
      [medicineId]
    );
    const rejectedUrls = new Set(rejections.map(r => r.rejected_image_url).filter(Boolean));

    const baseQuery = queryOverride && queryOverride.trim() 
      ? queryOverride.trim()
      : (this.extractCoreBrand(med.name) || med.name.replace(/\[.*?\]/g, '').trim());

    // Contextual query enhancement based on desired image angle
    let cleanQuery = baseQuery;
    if (imageType === 'back' && !cleanQuery.toLowerCase().includes('back')) {
      cleanQuery += ' back';
    }

    const url = `https://pharmeasy.in/api/search/search/?q=${encodeURIComponent(cleanQuery)}&page=1`;

    let products: any[] = [];
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: AbortSignal.timeout(8000)
      });
      if (resp.ok) {
        const json = await resp.json();
        products = json?.data?.products || [];
      }
    } catch (err: any) {
      console.warn(`[CatalogImageService] Online search error for "${cleanQuery}":`, err.message);
    }

    const candidates: CandidateImage[] = [];

    for (const prod of products) {
      const damImages = prod.damImages || [];
      // Prefer image matching requested imageType
      let targetImg = null;
      if (imageType === 'back') {
        targetImg = damImages.find((img: any) => img.face === 'back' || (img.url && img.url.toLowerCase().includes('back')));
        if (!targetImg && damImages.length > 1) targetImg = damImages[1];
      } else if (imageType === 'front') {
        targetImg = damImages.find((img: any) => img.face === 'front' || img.face === 'default');
      }
      if (!targetImg) {
        targetImg = damImages.find((img: any) => img.face === 'front' || img.face === 'default') || (prod.image ? { url: prod.image } : null);
      }
      if (!targetImg || !targetImg.url) continue;

      const candidateUrl = targetImg.url.split('?')[0];
      if (rejectedUrls.has(candidateUrl)) continue;

      const scoreResult = this.computeConfidence(med, {
        name: prod.name,
        manufacturer: prod.manufacturer
      });

      candidates.push({
        id: String(prod.productId || candidateUrl),
        name: prod.name,
        manufacturer: prod.manufacturer || 'Unknown',
        imageUrl: candidateUrl,
        source: 'pharmeasy',
        confidenceScore: scoreResult.confidenceScore,
        verificationStatus: scoreResult.verificationStatus,
        reason: scoreResult.reason,
        signals: scoreResult.signals
      });
    }

    // Sort descending by confidence
    candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);
    return candidates;
  }

  /**
   * Action: Replace or add image with chosen candidate & mark as CORRECTED
   */
  public async replaceWithCandidate(
    imageId: number,
    candidateUrl: string,
    candidateTitle?: string,
    verifiedBy = 'admin',
    imageType?: string,
    isPrimary?: boolean,
    keepExisting = false
  ): Promise<CatalogImageRecord | null> {
    const db = await dbManager.getConnection();
    const current = await db.get('SELECT * FROM catalog_images WHERE id = ?', [imageId]);
    if (!current) return null;

    const med = await db.get('SELECT * FROM medicines WHERE id = ?', [current.medicine_id]);
    if (!med) return null;

    const targetType = imageType || (keepExisting ? 'back' : current.image_type || 'combined');
    let primaryVal = isPrimary ? 1 : 0;
    if (isPrimary === undefined) {
      if (targetType === 'combined') {
        primaryVal = 1;
      } else {
        const existingPrimary = await db.get(
          'SELECT id FROM catalog_images WHERE medicine_id = ? AND is_primary = 1 AND is_active = 1',
          [med.id]
        );
        primaryVal = existingPrimary ? 0 : 1;
      }
    }

    // Download image
    const slug = (med.name || 'product').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
    const filename = `${slug}-${targetType}-${Date.now()}.jpg`;
    const frontendDir = path.resolve(process.cwd(), 'frontend/public/products');
    const uploadsDir = path.resolve(process.cwd(), 'uploads/products');

    fs.mkdirSync(frontendDir, { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });

    const frontendPath = path.join(frontendDir, filename);
    const uploadsPath = path.join(uploadsDir, filename);

    const imgRes = await fetch(candidateUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(10000)
    });
    if (!imgRes.ok) {
      throw new Error(`Failed to download candidate image: HTTP ${imgRes.status}`);
    }

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Check rejections
    const rejection = await db.get(
      'SELECT id FROM catalog_image_rejections WHERE medicine_id = ? AND rejected_image_hash = ?',
      [med.id, hash]
    );
    if (rejection) {
      throw new Error('This image was previously rejected for this medicine.');
    }

    fs.writeFileSync(frontendPath, buffer);
    fs.writeFileSync(uploadsPath, buffer);

    const relPath = `/products/${filename}`;
    const nextVersion = (current.verification_version || 1) + 1;

    await db.run('BEGIN TRANSACTION');
    try {
      if (!keepExisting) {
        // 1. Deactivate old image only if not keeping both
        await db.run(
          `UPDATE catalog_images 
           SET is_active = 0, 
               verification_status = 'REPLACED', 
               updated_at = CURRENT_TIMESTAMP 
           WHERE id = ?`,
          [imageId]
        );
      }

      // Deactivate any other active image with the SAME image_type for this medicine
      await db.run(
        'UPDATE catalog_images SET is_active = 0 WHERE medicine_id = ? AND image_type = ? AND id != ?',
        [med.id, targetType, imageId]
      );

      // If primary, clear is_primary on other images for this medicine
      if (primaryVal === 1) {
        await db.run(
          'UPDATE catalog_images SET is_primary = 0 WHERE medicine_id = ? AND id != ?',
          [med.id, imageId]
        );
      }

      // 2. Insert new corrected record
      const res = await db.run(
        `INSERT INTO catalog_images (
           medicine_id, company_name, product_name, image_path, thumbnail_path,
           image_source, source_url, image_hash, confidence_score, matching_method,
           verification_status, is_active, image_type, is_primary, replaced_from_image_id, previous_image_url,
           verification_version, verified_by, verified_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 100, 'human_correction', 'CORRECTED', 1, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          med.id,
          med.manufacturer || current.company_name,
          candidateTitle || med.name,
          relPath,
          relPath,
          'online_correction',
          candidateUrl,
          hash,
          targetType,
          primaryVal,
          keepExisting ? null : imageId,
          current.image_path,
          nextVersion,
          verifiedBy
        ]
      );

      // 3. Record in audit history
      await db.run(
        `INSERT INTO image_review_history (
           product_image_id, medicine_id, previous_status, new_status,
           previous_image_url, new_image_url, action, reason, performed_by
         ) VALUES (?, ?, ?, 'CORRECTED', ?, ?, 'IMAGE_REPLACED', ?, ?)`,
        [
          res.lastID,
          med.id,
          current.verification_status,
          current.image_path,
          relPath,
          keepExisting ? `Added ${targetType} image` : 'Replaced with online candidate',
          verifiedBy
        ]
      );

      await db.run('COMMIT');

      const newRecord = await db.get('SELECT * FROM catalog_images WHERE id = ?', [res.lastID]);
      eventService.broadcast('catalog_image_updated', {
        id: res.lastID,
        medicine_id: med.id,
        status: 'CORRECTED',
        image_type: targetType,
        is_primary: primaryVal,
        is_active: 1
      });

      return newRecord;
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  }

  /**
   * Retrieve all image slots / angles for a specific medicine
   */
  public async getMedicineGallery(medicineId: number): Promise<CatalogImageRecord[]> {
    const db = await dbManager.getConnection();
    return db.all(
      `SELECT ci.*, m.category, m.packaging, m.strength, m.generic_name
       FROM catalog_images ci
       LEFT JOIN medicines m ON m.id = ci.medicine_id
       WHERE ci.medicine_id = ? 
       ORDER BY 
         ci.is_active DESC,
         ci.is_primary DESC,
         CASE COALESCE(ci.image_type, 'combined')
           WHEN 'combined' THEN 1 
           WHEN 'front' THEN 2 
           WHEN 'back' THEN 3 
           WHEN 'box' THEN 4 
           WHEN 'tablet' THEN 5 
           ELSE 6 END,
         ci.id DESC`,
      [medicineId]
    ).catch(() => []);
  }

  /**
   * Action: Reopen an approved/corrected image for QC review
   */
  public async reopenImage(imageId: number, verifiedBy = 'admin'): Promise<boolean> {
    const db = await dbManager.getConnection();
    const current = await db.get('SELECT * FROM catalog_images WHERE id = ?', [imageId]);
    if (!current) return false;

    const nextVersion = (current.verification_version || 1) + 1;

    await db.run('BEGIN TRANSACTION');
    try {
      await db.run(
        `UPDATE catalog_images 
         SET verification_status = 'PENDING_REVIEW', 
             next_review_at = NULL, 
             verification_version = ?,
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [nextVersion, imageId]
      );

      await db.run(
        `INSERT INTO image_review_history (
           product_image_id, medicine_id, previous_status, new_status,
           previous_image_url, new_image_url, action, reason, performed_by
         ) VALUES (?, ?, ?, 'PENDING_REVIEW', ?, ?, 'REOPENED', 'Reopened for quality control review', ?)`,
        [
          imageId,
          current.medicine_id,
          current.verification_status,
          current.image_path,
          current.image_path,
          verifiedBy
        ]
      );

      await db.run('COMMIT');

      eventService.broadcast('catalog_image_updated', {
        id: imageId,
        medicine_id: current.medicine_id,
        status: 'PENDING_REVIEW'
      });

      return true;
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  }

  /**
   * Fetch complete audit log from image_review_history
   */
  public async getImageHistory(medicineId: number): Promise<ImageReviewHistoryRecord[]> {
    const db = await dbManager.getConnection();
    return db.all(
      `SELECT * FROM image_review_history WHERE medicine_id = ? ORDER BY performed_at DESC`,
      [medicineId]
    );
  }

  /**
   * Filename-based auto-match engine.
   * Scans uploads/products/ directory, parses filenames, fuzzy-matches to medicines DB,
   * and silently inserts into catalog_images.
   * Idempotent — skips files already linked by image_path.
   */
  public async scanAndAutoMatchLocalImages(): Promise<{
    matched: number;
    pending_review: number;
    unmatched: number;
    skipped: number;
  }> {
    const uploadsDir = path.join(process.cwd(), 'uploads', 'products');
    const db = await dbManager.getConnection();

    if (!fs.existsSync(uploadsDir)) {
      return { matched: 0, pending_review: 0, unmatched: 0, skipped: 0 };
    }

    const allFiles = fs.readdirSync(uploadsDir).filter(f =>
      /\.(jpg|jpeg|png|webp)$/i.test(f)
    );

    let matched = 0, pending_review = 0, unmatched = 0, skipped = 0;

    for (const filename of allFiles) {
      const relPath = `uploads/products/${filename}`;

      // Idempotency: skip if already in catalog_images
      const existing = await db.get(
        'SELECT id FROM catalog_images WHERE image_path = ?',
        [relPath]
      );
      if (existing) { skipped++; continue; }

      // --- Parse filename ---
      let cleanName = filename
        .replace(/\.(jpg|jpeg|png|webp)$/i, '')      // strip extension
        .replace(/-candidate-\d+$/i, '')              // strip -candidate-{timestamp}
        .replace(/-(front|back|side|box|tablet|combined)$/i, '') // strip angle suffix
        .replace(/-/g, ' ')                           // hyphens → spaces
        .trim();

      // Detect image_type from suffix before stripping
      const angleMatch = filename.match(/-(front|back|side|box|tablet|combined)\.(jpg|jpeg|png|webp)$/i);
      const imageType = angleMatch ? angleMatch[1].toLowerCase() : 'combined';

      // Extract manufacturer hint: typically the last major segment before timestamp
      // e.g. "geminor-m-1-500-mg-tablet-10-macleods-pharmaceuticals-candidate-1788441188108"
      // → manufacturer candidates are words at the tail: "macleods pharmaceuticals"
      const parts = cleanName.split(' ');
      // Heuristic: last 2–3 words that look like a company name (capitalized, no digits)
      const mfrWords: string[] = [];
      for (let i = parts.length - 1; i >= 0 && mfrWords.length < 3; i--) {
        if (/^[a-zA-Z]{3,}$/i.test(parts[i])) {
          mfrWords.unshift(parts[i]);
        } else {
          break;
        }
      }
      const manufacturerHint = mfrWords.join(' ');
      // Product name: everything except the manufacturer tail words
      const productNameWords = mfrWords.length > 0
        ? parts.slice(0, parts.length - mfrWords.length)
        : parts;
      const productSearchName = productNameWords.join(' ');

      // --- Fuzzy match against medicines ---
      const candidates = await db.all<any>(
        `SELECT id, name, manufacturer, strength, packaging, mrp, category
         FROM medicines
         WHERE name LIKE ? OR name LIKE ?
         LIMIT 10`,
        [`${productSearchName.slice(0, 15)}%`, `%${productSearchName.slice(0, 10)}%`]
      );

      let bestId: number | null = null;
      let bestScore = 0;
      let bestMed: any = null;

      for (const med of candidates) {
        const result = this.computeConfidence(med, {
          name: cleanName,
          manufacturer: manufacturerHint || null,
        });
        if (result.confidenceScore > bestScore) {
          bestScore = result.confidenceScore;
          bestId = med.id;
          bestMed = med;
        }
      }

      const imagePath = relPath;
      const now = new Date().toISOString();

      if (bestScore >= 85 && bestId) {
        // HIGH_CONFIDENCE — silent auto-approve, make active
        // Deactivate any existing active image of same type for this medicine
        await db.run(
          `UPDATE catalog_images SET is_active = 0
           WHERE medicine_id = ? AND image_type = ? AND is_active = 1`,
          [bestId, imageType]
        );
        await db.run(
          `INSERT INTO catalog_images
             (medicine_id, product_name, company_name, image_path, image_source,
              confidence_score, matching_method, verification_status, is_active,
              image_type, is_primary, match_source, match_confidence,
              verified_by, verified_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'local_file', ?, 'filename_auto', 'HIGH_CONFIDENCE', 1,
                   ?, ?, 'filename_auto', ?, 'auto_match', ?, ?, ?)`,
          [
            bestId,
            bestMed?.name || cleanName,
            bestMed?.manufacturer || manufacturerHint || null,
            imagePath,
            bestScore,
            imageType,
            imageType === 'combined' ? 1 : 0,
            bestScore,
            now, now, now
          ]
        );
        matched++;
      } else if (bestScore >= 60 && bestId) {
        // PENDING_REVIEW — needs human confirmation
        await db.run(
          `INSERT INTO catalog_images
             (medicine_id, product_name, company_name, image_path, image_source,
              confidence_score, matching_method, verification_status, is_active,
              image_type, is_primary, match_source, match_confidence,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, 'local_file', ?, 'filename_auto', 'PENDING_REVIEW', 0,
                   ?, 0, 'filename_auto', ?, ?, ?)`,
          [
            bestId,
            bestMed?.name || cleanName,
            bestMed?.manufacturer || manufacturerHint || null,
            imagePath,
            bestScore,
            imageType,
            bestScore,
            now, now
          ]
        );
        pending_review++;
      } else {
        // UNMATCHED — no confident medicine match; store with product_name from filename
        await db.run(
          `INSERT INTO catalog_images
             (medicine_id, product_name, company_name, image_path, image_source,
              confidence_score, matching_method, verification_status, is_active,
              image_type, is_primary, match_source, match_confidence,
              created_at, updated_at)
           VALUES (NULL, ?, ?, ?, 'local_file', ?, 'filename_auto', 'PENDING_REVIEW', 0,
                   ?, 0, 'filename_unmatched', ?, ?, ?)`,
          [
            cleanName,
            manufacturerHint || null,
            imagePath,
            bestScore,
            imageType,
            bestScore,
            now, now
          ]
        );
        unmatched++;
      }
    }

    return { matched, pending_review, unmatched, skipped };
  }
}

export const catalogImageService = CatalogImageService.getInstance();
