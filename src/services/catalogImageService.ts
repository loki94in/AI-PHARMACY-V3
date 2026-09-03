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
  verification_status: 'HIGH_CONFIDENCE' | 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED' | 'REMOVED';
  verification_reason: string | null;
  ocr_text: string | null;
  ocr_confidence: number | null;
  is_active: number;
  retry_count: number;
  replaced_from_image_id: number | null;
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

    // 1. Brand Match (35%)
    let brandMatch = false;
    let brandScore = 0;
    if (medBrand && candUpper.includes(medBrand)) {
      brandMatch = true;
      brandScore = 35;
    } else if (medBrand) {
      // Partial brand prefix (min 4 chars)
      const prefix = medBrand.slice(0, Math.min(medBrand.length, 5));
      if (prefix.length >= 4 && candUpper.includes(prefix)) {
        brandMatch = true;
        brandScore = 20;
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

    // Categorization
    let verificationStatus: 'HIGH_CONFIDENCE' | 'PENDING_REVIEW' | 'REJECTED' = 'PENDING_REVIEW';
    if (totalScore >= 99 && brandMatch && !strengthConflict && !dosageFormConflict) {
      verificationStatus = 'HIGH_CONFIDENCE';
    } else if (totalScore < 45 || strengthConflict || dosageFormConflict) {
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
    page?: number;
    limit?: number;
  }): Promise<{
    images: CatalogImageRecord[];
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
      if (options.status === 'review') {
        whereSql += " AND ci.verification_status = 'PENDING_REVIEW'";
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
              m.manufacturer
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
      removed: 0
    };

    for (const r of rows) {
      counts.total += r.count;
      if (r.verification_status === 'PENDING_REVIEW') counts.pending_review = r.count;
      else if (r.verification_status === 'HIGH_CONFIDENCE') counts.high_confidence = r.count;
      else if (r.verification_status === 'APPROVED') counts.approved = r.count;
      else if (r.verification_status === 'REJECTED') counts.rejected = r.count;
      else if (r.verification_status === 'REMOVED') counts.removed = r.count;
    }

    return counts;
  }

  /**
   * Approve an image -> marks as APPROVED and active catalogue image
   */
  public async approveImage(imageId: number, verifiedBy = 'pharmacist'): Promise<boolean> {
    const db = await dbManager.getConnection();
    const image = await db.get('SELECT * FROM catalog_images WHERE id = ?', [imageId]);
    if (!image) return false;

    // Begin transaction
    await db.run('BEGIN TRANSACTION');
    try {
      // 1. Deactivate any previous active image for this medicine
      await db.run(
        'UPDATE catalog_images SET is_active = 0 WHERE medicine_id = ? AND id != ?',
        [image.medicine_id, imageId]
      );

      // 2. Mark this image approved and active
      await db.run(
        `UPDATE catalog_images 
         SET verification_status = 'APPROVED', 
             is_active = 1, 
             verified_by = ?, 
             verified_at = CURRENT_TIMESTAMP, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [verifiedBy, imageId]
      );

      await db.run('COMMIT');

      eventService.broadcast('catalog_image_updated', {
        id: imageId,
        medicine_id: image.medicine_id,
        status: 'APPROVED',
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

      const insertRes = await db.run(
        `INSERT INTO catalog_images (
           medicine_id, company_name, product_name, image_path, thumbnail_path,
           image_source, source_url, image_hash, confidence_score, matching_method,
           verification_status, verification_reason, is_active, retry_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_multi_signal', ?, ?, 0, ?)`,
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
}

export const catalogImageService = CatalogImageService.getInstance();
