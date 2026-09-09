import fs from 'fs';
import path from 'path';
import { Jimp } from 'jimp';
import { dbManager } from '../database/connection.js';
import { catalogImageService } from './catalogImageService.js';

/**
 * Visual Index Service — perceptual hash (aHash) for catalog product images.
 * - Computes 64-bit average hash (8x8 grayscale) as 16-char hex string.
 * - Stores in catalog_images.phash (indexed).
 * - Search by Hamming distance (<=10 = near duplicate, <=15 = similar).
 * - Fusion with brand/strength/form signals from catalogImageService.computeConfidence.
 */

export class VisualIndexService {
  private static instance: VisualIndexService;
  public static getInstance(): VisualIndexService {
    if (!VisualIndexService.instance) VisualIndexService.instance = new VisualIndexService();
    return VisualIndexService.instance;
  }

  /**
   * Compute 64-bit average hash (aHash) from image buffer.
   * Steps: resize 8x8, greyscale, avg, bits.
   */
  public async computePhashFromBuffer(buffer: Buffer): Promise<string | null> {
    try {
      const image = await Jimp.read(buffer);
      image.resize({ w: 8, h: 8 });
      image.greyscale();
      const { data } = image.bitmap; // RGBA flat array
      const pixels: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        pixels.push(data[i]); // R == G == B after greyscale
      }
      const avg = pixels.reduce((a, b) => a + b, 0) / pixels.length;
      let hash = '';
      let currentByte = 0;
      let bits = 0;
      for (const px of pixels) {
        currentByte = (currentByte << 1) | (px >= avg ? 1 : 0);
        bits++;
        if (bits === 8) {
          hash += currentByte.toString(16).padStart(2, '0');
          currentByte = 0;
          bits = 0;
        }
      }
      return hash; // 16 hex chars = 64 bits
    } catch (e) {
      return null;
    }
  }

  public async computePhashFromPath(filePath: string): Promise<string | null> {
    try {
      const clean = filePath.replace(/^\/+/, '');
      const p1 = path.resolve(process.cwd(), 'frontend/public', clean);
      const p2 = path.resolve(process.cwd(), clean);
      const p3 = path.resolve(process.cwd(), 'uploads', clean.replace(/^uploads\//, ''));
      let buf: Buffer | null = null;
      if (fs.existsSync(p1)) buf = fs.readFileSync(p1);
      else if (fs.existsSync(p2)) buf = fs.readFileSync(p2);
      else if (fs.existsSync(p3)) buf = fs.readFileSync(p3);
      else return null;
      return this.computePhashFromBuffer(buf);
    } catch {
      return null;
    }
  }

  public hammingDistance(hashA: string, hashB: string): number {
    if (!hashA || !hashB || hashA.length !== hashB.length) return 64;
    let dist = 0;
    for (let i = 0; i < hashA.length; i++) {
      const a = parseInt(hashA[i], 16);
      const b = parseInt(hashB[i], 16);
      let xor = a ^ b;
      while (xor) {
        dist += xor & 1;
        xor >>= 1;
      }
    }
    return dist;
  }

  /**
   * Build / backfill phash for all active images missing it.
   */
  public async backfillPhash(batchSize = 200): Promise<{ total: number; updated: number; failed: number }> {
    const db = await dbManager.getConnection();
    const rows = await db.all('SELECT id, image_path FROM catalog_images WHERE phash IS NULL AND is_active=1');
    let updated = 0;
    let failed = 0;
    for (const r of rows) {
      const phash = await this.computePhashFromPath(r.image_path);
      if (phash) {
        await db.run('UPDATE catalog_images SET phash=? WHERE id=?', [phash, r.id]);
        updated++;
      } else {
        failed++;
      }
      if ((updated + failed) % 500 === 0) {
        console.log(`[VisualIndex] backfill ${updated + failed}/${rows.length}`);
      }
    }
    return { total: rows.length, updated, failed };
  }

  /**
   * Visual search: find catalog images by phash Hamming distance.
   * Returns up to limit results with distance and medicine info.
   */
  public async searchByPhash(queryPhash: string, limit = 10, maxDistance = 12): Promise<Array<{ id: number; medicine_id: number; product_name: string; image_path: string; phash: string; distance: number; image_type: string }>> {
    const db = await dbManager.getConnection();
    const actives = await db.all('SELECT id, medicine_id, product_name, image_path, phash, image_type FROM catalog_images WHERE phash IS NOT NULL AND is_active=1 AND verification_status IN (\'APPROVED\',\'HIGH_CONFIDENCE\')');
    const scored = actives
      .map(r => ({ ...r, distance: this.hammingDistance(queryPhash, r.phash) }))
      .filter(r => r.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
    return scored;
  }

  /**
   * Fused search: visual phash + OCR text (brand/strength/form).
   * Used when user shares an image: we have both the image bitmap and its OCR text.
   * Returns merged, re-ranked candidates using catalogImageService.computeConfidence for textual signals.
   */
  public async fusedSearch(imageBuffer: Buffer, ocrText: string, options: { limit?: number; maxVisualDistance?: number } = {}): Promise<Array<{ medicine_id: number; product_name: string; image_path: string; visualDistance: number | null; textualScore: number; fusedScore: number; signals: any }>> {
    const limit = options.limit || 10;
    const maxVisualDistance = options.maxVisualDistance || 12;

    // 1. Visual candidates
    const queryPhash = await this.computePhashFromBuffer(imageBuffer);
    let visualHits: Array<any> = [];
    if (queryPhash) {
      visualHits = await this.searchByPhash(queryPhash, 50, maxVisualDistance);
    }

    // 2. Textual candidates via productNameFilterService (if OCR has tokens)
    // We reuse catalogImageService.computeConfidence for re-ranking instead of duplicating logic
    const db = await dbManager.getConnection();
    const visualIds = new Set(visualHits.map(h => h.medicine_id));
    let fused: Array<any> = [];

    for (const hit of visualHits) {
      const med = await db.get('SELECT name, manufacturer, strength, packaging FROM medicines WHERE id=?', [hit.medicine_id]);
      if (!med) continue;
      // Textual score must be OCR vs med, not hit product vs med (hit product is already confirmed for that med)
      const ocrCandidate = (ocrText || '').split(/[\r\n,]+/).map(s=>s.trim()).find(s=>s.length>=3) || hit.product_name;
      const textMatch = catalogImageService.computeConfidence(
        { name: med.name, manufacturer: med.manufacturer, strength: med.strength, packaging: med.packaging },
        { name: ocrCandidate, manufacturer: ocrCandidate, ocrText, imagePath: hit.image_path }
      );
      // Visual 0.4 + textual confidence 0.6 (normalized 0-100 -> 0-1)
      const visualScore = 1 - (hit.distance / 64); // 1 = identical, 0.81 = distance 12
      const textualScore = textMatch.confidenceScore / 100;
      const fusedScore = visualScore * 0.4 + textualScore * 0.6;
      // Penalize hard failures heavily
      const finalScore = (textMatch.signals.strengthConflict || textMatch.signals.dosageFormConflict || !textMatch.signals.brandMatch) ? fusedScore * 0.3 : fusedScore;
      fused.push({
        medicine_id: hit.medicine_id,
        product_name: hit.product_name,
        image_path: hit.image_path,
        visualDistance: hit.distance,
        textualScore: textMatch.confidenceScore,
        fusedScore: Math.round(finalScore * 100),
        signals: textMatch.signals,
        reason: textMatch.reason
      });
    }

    // If no visual hits, fallback to pure textual search via productNameFilterService is handled by caller (aiCamera/whatsapp)
    fused.sort((a, b) => b.fusedScore - a.fusedScore);
    return fused.slice(0, limit);
  }

  /**
   * Quick check: does a medicine have 2-4 images (front/back/combined) ready for app/website?
   */
  public async getGalleryStatus(medicineId: number): Promise<{ count: number; types: string[]; needsMore: boolean }> {
    const db = await dbManager.getConnection();
    const rows = await db.all('SELECT image_type FROM catalog_images WHERE medicine_id=? AND is_active=1 AND verification_status IN (\'APPROVED\',\'HIGH_CONFIDENCE\')', [medicineId]);
    const types = rows.map(r => r.image_type);
    return { count: rows.length, types, needsMore: rows.length < 2 };
  }
}

export const visualIndexService = VisualIndexService.getInstance();
