import express from 'express';
import path from 'path';
import fs from 'fs';
import { catalogImageService } from '../services/catalogImageService.js';
import { dbManager } from '../database/connection.js';
import { whatsappQueueWorker } from '../services/whatsappQueueWorker.js';

const router = express.Router();

/**
 * GET /api/catalog/images — Paginated list of catalog images with filters
 */
router.get('/', async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const medicine_id = req.query.medicine_id ? parseInt(String(req.query.medicine_id), 10) : undefined;
    const groupByMedicine = req.query.group_by_medicine === 'true' || req.query.groupByMedicine === 'true';
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;

    const result = await catalogImageService.getImages({
      status,
      search,
      medicine_id,
      groupByMedicine,
      page,
      limit
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error fetching images:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch catalog images' });
  }
});

/**
 * GET /api/catalog/images/counts — Summary counts by verification status
 */
router.get('/counts', async (req, res) => {
  try {
    const counts = await catalogImageService.getCounts();
    res.json({
      success: true,
      counts
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error fetching counts:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch counts' });
  }
});

/**
 * GET /api/catalog/images/queue — Unresolved images for Dedicated Correction Center
 */
router.get('/queue', async (req, res) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const status = (typeof req.query.status === 'string' ? req.query.status : 'unresolved') as any;
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;

    const result = await catalogImageService.getCorrectionQueue({
      category,
      search,
      status,
      page,
      limit
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error fetching correction queue:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch correction queue' });
  }
});

/**
 * GET /api/catalog/images/stats — Dedicated Correction Quality Dashboard stats
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await catalogImageService.getCorrectionStats();
    res.json({
      success: true,
      stats
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error fetching correction stats:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch correction stats' });
  }
});

/**
 * GET /api/catalog/images/:id — Specific image details with rejection history
 */
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = await dbManager.getConnection();
    const image = await db.get(
      `SELECT ci.*, 
              m.name as medicine_name, 
              m.generic_name, 
              m.strength, 
              m.packaging, 
              m.mrp, 
              m.manufacturer
       FROM catalog_images ci 
       LEFT JOIN medicines m ON m.id = ci.medicine_id 
       WHERE ci.id = ?`,
      [id]
    );

    if (!image) {
      return res.status(404).json({ success: false, error: 'Image not found' });
    }

    const rejections = await db.all(
      'SELECT * FROM catalog_image_rejections WHERE medicine_id = ? ORDER BY created_at DESC',
      [image.medicine_id]
    );

    res.json({
      success: true,
      image,
      rejections
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error fetching image details:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch image details' });
  }
});

/**
 * POST /api/catalog/images/:id/approve — Approve image as verified active catalog image.
 * Optionally accepts medicine_edits to atomically update medicine fields in the same call.
 */
router.post('/:id/approve', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const verifiedBy = req.body?.verified_by || 'pharmacist';
    const medicineEdits: { name?: string; manufacturer?: string; mrp?: number } | undefined = req.body?.medicine_edits;

    // If caller sent medicine field edits, apply them first (same logic as quick-edit)
    if (medicineEdits && Object.keys(medicineEdits).length > 0) {
      const db = await dbManager.getConnection();
      const imageRow = await db.get('SELECT medicine_id FROM catalog_images WHERE id = ?', [id]);
      if (imageRow?.medicine_id) {
        const updates: string[] = [];
        const vals: any[] = [];
        if (medicineEdits.name !== undefined)         { updates.push('name = ?');         vals.push(medicineEdits.name); }
        if (medicineEdits.manufacturer !== undefined) { updates.push('manufacturer = ?'); vals.push(medicineEdits.manufacturer); }
        if (medicineEdits.mrp !== undefined)          { updates.push('mrp = ?');          vals.push(medicineEdits.mrp); }
        if (updates.length > 0) {
          vals.push(imageRow.medicine_id);
          await db.run(`UPDATE medicines SET ${updates.join(', ')} WHERE id = ?`, vals);
        }
      }
    }

    const ok = await catalogImageService.approveImage(id, verifiedBy);
    if (!ok) {
      return res.status(404).json({ success: false, error: 'Image not found' });
    }

    res.json({
      success: true,
      message: 'Image approved successfully. It is now the active catalogue image.'
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error approving image:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to approve image' });
  }
});

/**
 * POST /api/catalog/images/:id/reject — Reject image, log exclusion, trigger controlled re-download
 */
router.post('/:id/reject', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const reason = req.body?.reason || 'Incorrect product image';
    const verifiedBy = req.body?.verified_by || 'pharmacist';

    const result = await catalogImageService.rejectImage(id, reason, verifiedBy);

    if (!result.success) {
      return res.status(404).json({ success: false, error: 'Image not found' });
    }

    res.json({
      message: 'Image rejected. Candidate logged to exclusion list and auto re-download initiated.',
      ...result
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error rejecting image:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to reject image' });
  }
});

/**
 * POST /api/catalog/images/:id/remove — Remove image from active catalogue (keeps product valid)
 */
router.post('/:id/remove', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const verifiedBy = req.body?.verified_by || 'pharmacist';

    const ok = await catalogImageService.removeImage(id, verifiedBy);
    if (!ok) {
      return res.status(404).json({ success: false, error: 'Image not found' });
    }

    res.json({
      success: true,
      message: 'Image removed from active catalogue. Medicine record remains intact.'
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error removing image:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to remove image' });
  }
});

/**
 * POST /api/catalog/images/:id/replace — Replace current image with a new image
 */
router.post('/:id/replace', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { new_image_path, source_url, verified_by } = req.body;

    if (!new_image_path) {
      return res.status(400).json({ success: false, error: 'new_image_path is required' });
    }

    const newRecord = await catalogImageService.replaceImage(
      id,
      new_image_path,
      source_url || null,
      verified_by || 'pharmacist'
    );

    if (!newRecord) {
      return res.status(404).json({ success: false, error: 'Original image not found' });
    }

    res.json({
      success: true,
      message: 'Image replaced successfully.',
      image: newRecord
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error replacing image:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to replace image' });
  }
});

/**
 * POST /api/catalog/images/:id/redownload — Request fresh online image search
 */
router.post('/:id/redownload', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = await dbManager.getConnection();
    const current = await db.get('SELECT medicine_id, retry_count FROM catalog_images WHERE id = ?', [id]);

    if (!current) {
      return res.status(404).json({ success: false, error: 'Image not found' });
    }

    const newRecord = await catalogImageService.searchAndDownloadCandidate(
      current.medicine_id,
      (current.retry_count || 0) + 1
    );

    if (!newRecord) {
      return res.json({
        success: false,
        message: 'No new alternative candidate image found online.'
      });
    }

    res.json({
      success: true,
      message: 'New candidate downloaded and scored successfully.',
      image: newRecord
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error re-downloading image:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to re-download image' });
  }
});

/**
 * POST /api/catalog/images/sync-state — Backfill existing downloaded images from state file
 */
router.post('/sync-state', async (req, res) => {
  try {
    const result = await catalogImageService.syncExistingDownloadedImages();
    res.json({
      success: true,
      ...result
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error syncing state:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to sync image state' });
  }
});

/**
 * POST /api/catalog/images/audit — Run Image Health Auditor (Section 6, 19, 34)
 */
router.post('/audit', async (req, res) => {
  try {
    const report = await catalogImageService.auditImageHealth();
    res.json({
      success: true,
      ...report
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error auditing images:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to audit images' });
  }
});

/**
 * POST /api/catalog/images/auto-approve — Batch auto-approve high confidence matches (Section 10 & 34)
 */
router.post('/auto-approve', async (req, res) => {
  try {
    const result = await catalogImageService.autoApproveHighConfidence();
    res.json({
      success: true,
      message: `Successfully evaluated ${result.evaluated} images and approved ${result.approved} verified active images.`,
      ...result
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error auto-approving images:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to auto-approve images' });
  }
});

/**
 * POST /api/catalog/images/scan-local — Scan uploads/products/ and auto-match filenames to medicines
 */
router.post('/scan-local', async (req, res) => {
  try {
    const result = await catalogImageService.scanAndAutoMatchLocalImages();
    res.json({
      success: true,
      message: `Scan complete: ${result.matched} auto-matched, ${result.pending_review} need review, ${result.unmatched} unmatched, ${result.skipped} already linked.`,
      ...result
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error scanning local images:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to scan local images' });
  }
});

/**
 * POST /api/catalog/images/cleanup — Purge stale, rejected, and missing image files
 */
router.post('/cleanup', async (req, res) => {
  try {
    const { purgeRejected, purgeMissingFiles, purgeOrphans } = req.body || {};
    const result = await catalogImageService.cleanStaleAndRejectedImages({
      purgeRejected,
      purgeMissingFiles,
      purgeOrphans
    });
    res.json({
      success: true,
      message: `Image cleanup complete: purged ${result.purged_rejected} rejected, ${result.purged_missing_files} missing files, ${result.purged_orphans} orphans. Active verified remaining: ${result.active_verified}.`,
      ...result
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error cleaning up images:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to clean up images' });
  }
});

/**
 * POST /api/catalog/images/audit-fix — Re-audit all images and deactivate form/strength/brand mismatches
 */
router.post('/audit-fix', async (req, res) => {
  try {
    const result = await catalogImageService.auditAndDeactivateMismatchedImages();
    res.json({
      success: true,
      message: `Audit & cleanup complete: evaluated ${result.total_audited} images. Deactivated ${result.total_deactivated} wrong images (${result.dosage_form_conflicts} form conflicts, ${result.strength_conflicts} strength conflicts, ${result.brand_mismatches} brand mismatches). ${result.remaining_active} verified good images remain active.`,
      ...result
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error auditing & deactivating mismatches:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to audit and fix mismatches' });
  }
});

/**
 * POST /api/catalog/images/repair-missing — Re-check & auto-repair missing catalog images (Section 18 & 34)
 */
router.post('/repair-missing', async (req, res) => {

  try {
    const limit = req.body?.limit ? parseInt(String(req.body.limit), 10) : 50;
    const result = await catalogImageService.repairMissingImages(limit);
    res.json({
      success: true,
      message: `Scanned ${result.scanned} medicines: repaired ${result.repaired}, ${result.failed} not found/failed.`,
      ...result
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error repairing missing images:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to repair missing images' });
  }
});

/**
 * POST /api/catalog/images/:id/correct — Mark image as verified / correct
 */
router.post('/:id/correct', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const verifiedBy = req.body?.verified_by || 'admin';
    const imageType = req.body?.image_type || undefined;
    const isPrimary = typeof req.body?.is_primary === 'boolean' ? req.body.is_primary : undefined;
    const ok = await catalogImageService.markImageCorrect(id, verifiedBy, imageType, isPrimary);
    if (!ok) return res.status(404).json({ success: false, error: 'Image not found' });
    res.json({ success: true, message: 'Image marked as correct and verified.' });
  } catch (err: any) {
    console.error('[CatalogImages API] Error marking correct:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to mark correct' });
  }
});

/**
 * POST /api/catalog/images/:id/incorrect — Flag image as incorrect or trigger smart angle workflow
 */
router.post('/:id/incorrect', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const reason = req.body?.reason || 'Incorrect image';
    const reasonCode = req.body?.reason_code || undefined;
    const verifiedBy = req.body?.verified_by || 'admin';
    const result = await catalogImageService.markImageIncorrect(id, reason, verifiedBy, reasonCode);
    if (!result.success) return res.status(404).json({ success: false, error: result.message || 'Image not found' });
    res.json(result);
  } catch (err: any) {
    console.error('[CatalogImages API] Error marking incorrect:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to mark incorrect' });
  }
});

/**
 * POST /api/catalog/images/:id/skip — Skip review temporarily with delay
 */
router.post('/:id/skip', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const hours = parseInt(String(req.body?.hours || 24), 10);
    const reason = req.body?.reason || 'Temporarily skipped';
    const verifiedBy = req.body?.verified_by || 'admin';
    const ok = await catalogImageService.skipImage(id, hours, reason, verifiedBy);
    if (!ok) return res.status(404).json({ success: false, error: 'Image not found' });
    res.json({ success: true, message: `Image review skipped for ${hours} hours.` });
  } catch (err: any) {
    console.error('[CatalogImages API] Error skipping image:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to skip image' });
  }
});

/**
 * POST /api/catalog/images/:id/search-candidates — Search online candidate images
 */
router.post('/:id/search-candidates', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = await dbManager.getConnection();
    const current = await db.get('SELECT medicine_id FROM catalog_images WHERE id = ?', [id]);
    if (!current) return res.status(404).json({ success: false, error: 'Image not found' });

    const queryOverride = req.body?.query || undefined;
    const imageType = req.body?.image_type || undefined;
    const candidates = await catalogImageService.searchCandidates(current.medicine_id, queryOverride, imageType);
    res.json({ success: true, candidates });
  } catch (err: any) {
    console.error('[CatalogImages API] Error searching candidates:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to search candidate images' });
  }
});

/**
 * POST /api/catalog/images/:id/replace-candidate — Replace image with selected candidate
 */
router.post('/:id/replace-candidate', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { candidate_url, candidate_title, verified_by, image_type, is_primary, keep_existing } = req.body;
    if (!candidate_url) {
      return res.status(400).json({ success: false, error: 'candidate_url is required' });
    }

    const newRecord = await catalogImageService.replaceWithCandidate(
      id,
      candidate_url,
      candidate_title,
      verified_by || 'admin',
      image_type,
      is_primary,
      !!keep_existing
    );
    if (!newRecord) return res.status(404).json({ success: false, error: 'Original image not found' });

    res.json({ success: true, message: 'Image successfully saved and verified.', image: newRecord });
  } catch (err: any) {
    console.error('[CatalogImages API] Error replacing candidate:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to replace image' });
  }
});

/**
 * POST /api/catalog/images/:id/relink — Connect image to a different master medicine record with selected face
 */
router.post('/:id/relink', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const targetMedicineId = parseInt(String(req.body?.target_medicine_id), 10);
    const imageType = req.body?.image_type || 'front';
    const isPrimary = req.body?.is_primary !== undefined ? !!req.body.is_primary : true;
    const verifiedBy = req.body?.verified_by || 'pharmacist';

    if (!targetMedicineId || isNaN(targetMedicineId)) {
      return res.status(400).json({ success: false, error: 'target_medicine_id is required' });
    }

    const result = await catalogImageService.relinkImage(
      id,
      targetMedicineId,
      imageType,
      isPrimary,
      verifiedBy
    );

    res.json({
      message: `Image successfully linked to "${result.medicine.name}" as ${imageType.toUpperCase()} packaging.`,
      ...result
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error relinking image:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to relink image' });
  }
});

/**
 * POST /api/catalog/images/medicine/:medicineId/approve-all — Single confirm per medicine (stream infinite-scroll)
 * Approves all downloaded images for this medicine as one logical confirm; publishes to website.
 */
router.post('/medicine/:medicineId/approve-all', async (req, res) => {
  try {
    const medicineId = parseInt(req.params.medicineId, 10);
    if (!medicineId) return res.status(400).json({ success: false, error: 'Invalid medicineId' });
    const verifiedBy = req.body?.verified_by || 'admin';
    const result = await catalogImageService.approveAllForMedicine(medicineId, verifiedBy);
    res.json({ success: true, message: `Approved ${result.approved} image(s) for medicine ${medicineId}. Published to website.`, ...result });
  } catch (err: any) {
    console.error('[CatalogImages API] Error bulk approving medicine:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to bulk approve' });
  }
});

/**
 * POST /api/catalog/images/medicine/:medicineId/reject-all — Single reject per medicine (stream infinite-scroll)
 * Rejects all app images for this medicine and triggers fresh re-download from internet.
 */
router.post('/medicine/:medicineId/reject-all', async (req, res) => {
  try {
    const medicineId = parseInt(req.params.medicineId, 10);
    if (!medicineId) return res.status(400).json({ success: false, error: 'Invalid medicineId' });
    const reason = req.body?.reason || 'Rejected via stream - incorrect image';
    const verifiedBy = req.body?.verified_by || 'admin';
    const result = await catalogImageService.rejectAllForMedicine(medicineId, reason, verifiedBy);
    res.json({ success: true, message: `Rejected ${result.rejected} image(s). Re-fetch from internet initiated.`, ...result });
  } catch (err: any) {
    console.error('[CatalogImages API] Error bulk rejecting medicine:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to bulk reject' });
  }
});

/**
 * GET /api/catalog/images/medicine/:medicineId/gallery — All angles/slots for a medicine
 */
router.get('/medicine/:medicineId/gallery', async (req, res) => {
  try {
    const medicineId = parseInt(req.params.medicineId, 10);
    const images = await catalogImageService.getMedicineGallery(medicineId);
    res.json({ success: true, images });
  } catch (err: any) {
    console.error('[CatalogImages API] Error fetching medicine gallery:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch gallery' });
  }
});

/**
 * POST /api/catalog/images/:id/reopen — Reopen verified image for QC review
 */
router.post('/:id/reopen', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const verifiedBy = req.body?.verified_by || 'admin';
    const ok = await catalogImageService.reopenImage(id, verifiedBy);
    if (!ok) return res.status(404).json({ success: false, error: 'Image not found' });
    res.json({ success: true, message: 'Image reopened for review.' });
  } catch (err: any) {
    console.error('[CatalogImages API] Error reopening image:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to reopen image' });
  }
});

/**
 * GET /api/catalog/images/:id/history — Audit trail of reviews and replacements
 */
router.get('/:id/history', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = await dbManager.getConnection();
    const current = await db.get('SELECT medicine_id FROM catalog_images WHERE id = ?', [id]);
    if (!current) return res.status(404).json({ success: false, error: 'Image not found' });

    const history = await catalogImageService.getImageHistory(current.medicine_id);
    res.json({ success: true, history });
  } catch (err: any) {
    console.error('[CatalogImages API] Error fetching history:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch history' });
  }
});

/**
 * GET /api/catalog/images/medicine/:medicineId/visual-reference
 * Resolves verified visual packaging reference for a medicine.
 * Checks storage first; if missing, auto-pulls from CDN (PharmEasy / 1mg / etc.)
 * If missing on CDN as well, returns clean fallback (has_image: false) without errors.
 */
router.get('/medicine/:medicineId/visual-reference', async (req, res) => {
  try {
    const medicineId = parseInt(req.params.medicineId, 10);
    if (!medicineId) return res.status(400).json({ success: false, error: 'Invalid medicineId' });

    const db = await dbManager.getConnection();
    const med = await db.get(
      'SELECT id, name, generic_name, manufacturer, dosage_form, strength, mrp, packaging FROM medicines WHERE id = ?',
      [medicineId]
    );
    if (!med) return res.status(404).json({ success: false, error: 'Medicine not found' });

    // 1. Check local storage first
    let gallery = await catalogImageService.getMedicineGallery(medicineId);
    let resolved = await catalogImageService.resolveProductImages(medicineId);

    // 2. If no active image in storage, attempt auto-pull from CDN
    let autoPulled = false;
    if (!resolved.primaryUrl && gallery.length === 0) {
      try {
        console.log(`[VisualReference] No local image for ${med.name} (#${medicineId}). Auto-pulling from CDN...`);
        const candidate = await catalogImageService.searchAndDownloadCandidate(medicineId);
        if (candidate) {
          autoPulled = true;
          gallery = await catalogImageService.getMedicineGallery(medicineId);
          resolved = await catalogImageService.resolveProductImages(medicineId);
        }
      } catch (cdnErr: any) {
        console.warn(`[VisualReference] CDN auto-pull failed for medicine ${medicineId}:`, cdnErr?.message);
      }
    }

    res.json({
      success: true,
      medicine: med,
      has_image: !!resolved.primaryUrl,
      auto_pulled: autoPulled,
      primaryUrl: resolved.primaryUrl,
      images: resolved.images,
      gallery: gallery.map((img: any) => ({
        id: img.id,
        url: img.image_path || img.thumbnail_path,
        type: img.image_type || 'combined',
        verification_status: img.verification_status,
        is_primary: !!img.is_primary,
        is_active: !!img.is_active
      }))
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error resolving visual reference:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to resolve visual reference' });
  }
});

/**
 * POST /api/catalog/images/send-visual-reference
 * Dispatches medicine visual packaging reference + safety disclaimer to customer WhatsApp.
 * Also alerts owner/admin if image is pending review so human can verify and promote for refills.
 */
router.post('/send-visual-reference', async (req, res) => {
  try {
    const {
      phone,
      medicineId,
      imageId,
      imageUrl,
      customNote,
      livePhoto,
      customerName
    } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, error: 'Recipient phone number is required' });
    }
    if (!medicineId) {
      return res.status(400).json({ success: false, error: 'medicineId is required' });
    }

    const db = await dbManager.getConnection();
    const med = await db.get(
      'SELECT id, name, generic_name, manufacturer, dosage_form, strength, mrp, packaging FROM medicines WHERE id = ?',
      [medicineId]
    );
    if (!med) return res.status(404).json({ success: false, error: 'Medicine not found' });

    let finalFileObj: { mimetype: string; data: string; filename?: string } | undefined = undefined;
    let isPendingReview = false;
    let usedImageRecord: any = null;

    // A) If a live camera photo was taken on counter
    if (livePhoto && livePhoto.data) {
      try {
        const uploadsDir = path.resolve(process.cwd(), 'uploads/products');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

        const filename = `counter-live-${medicineId}-${Date.now()}.jpg`;
        const diskPath = path.join(uploadsDir, filename);
        fs.writeFileSync(diskPath, Buffer.from(livePhoto.data, 'base64'));

        const webPath = `/uploads/products/${filename}`;
        const ins = await db.run(
          `INSERT INTO catalog_images (medicine_id, image_path, thumbnail_path, image_source, verification_status, is_active, is_primary, match_source, created_at, updated_at)
           VALUES (?, ?, ?, 'counter_camera', 'PENDING_REVIEW', 1, 1, 'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [medicineId, webPath, webPath]
        );

        finalFileObj = {
          mimetype: livePhoto.mimetype || 'image/jpeg',
          data: livePhoto.data,
          filename: filename
        };
        isPendingReview = true;
        usedImageRecord = { id: ins.lastID, image_path: webPath, verification_status: 'PENDING_REVIEW', image_source: 'counter_camera' };
      } catch (camErr: any) {
        console.error('[VisualReference] Failed to save live counter photo:', camErr);
      }
    } else {
      // B) Using catalog image (either specific imageId, or passed imageUrl, or primary)
      if (imageId) {
        usedImageRecord = await db.get('SELECT * FROM catalog_images WHERE id = ?', [imageId]);
      }
      if (!usedImageRecord && imageUrl) {
        usedImageRecord = await db.get('SELECT * FROM catalog_images WHERE image_path = ? OR thumbnail_path = ? LIMIT 1', [imageUrl, imageUrl]);
      }
      if (!usedImageRecord) {
        usedImageRecord = await db.get(
          'SELECT * FROM catalog_images WHERE medicine_id = ? AND is_active = 1 ORDER BY is_primary DESC, id DESC LIMIT 1',
          [medicineId]
        );
      }

      if (usedImageRecord) {
        if (usedImageRecord.verification_status === 'PENDING_REVIEW') {
          isPendingReview = true;
        }

        const relativePath = (usedImageRecord.image_path || usedImageRecord.thumbnail_path || '').replace(/^[/\\]+/, '');
        const fullDiskPath = path.resolve(process.cwd(), relativePath);

        if (fs.existsSync(fullDiskPath)) {
          const buf = fs.readFileSync(fullDiskPath);
          const ext = path.extname(fullDiskPath).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          finalFileObj = {
            mimetype: mime,
            data: buf.toString('base64'),
            filename: path.basename(fullDiskPath)
          };
        }
      }
    }

    // Build the clinical verification message with mandatory safety disclaimer note
    const specLines: string[] = [];
    if (med.strength || med.dosage_form) {
      specLines.push(`• *Strength / Form:* ${[med.strength, med.dosage_form].filter(Boolean).join(' ')}`);
    }
    if (med.generic_name) {
      specLines.push(`• *Composition:* ${med.generic_name}`);
    }
    if (med.manufacturer) {
      specLines.push(`• *Manufacturer:* ${med.manufacturer}`);
    }
    if (med.mrp) {
      specLines.push(`• *MRP:* ₹${med.mrp}`);
    }

    const greeting = customerName ? `Hello ${customerName}, ` : 'Hello, ';
    const noteBlock = customNote && customNote.trim() ? `\n📝 *Pharmacist Note:* ${customNote.trim()}\n` : '';

    const messageText = 
`📋 *Medicine Verification / Visual Reference*
${greeting}please check if this packaging matches what you need:

💊 *${med.name}*
${specLines.join('\n')}${noteBlock}
⚠️ *Note:* Packaging artwork, colors, or strip designs may vary across manufacturer batches. Please verify the active medicine name and strength printed on your physical strip.

👉 *Please reply to confirm if this is the correct medicine.*`;

    // Dispatch to Customer WhatsApp
    const queueId = await whatsappQueueWorker.enqueue(
      phone,
      messageText,
      'customer_medicine_clarification',
      customerName || 'Customer',
      undefined,
      undefined,
      finalFileObj
    );

    // Human-in-the-Loop Admin Notification:
    // If the image is unverified / pending review, alert the store owner on WhatsApp so they can verify in-app
    let ownerNotified = false;
    if (isPendingReview || usedImageRecord?.verification_status === 'PENDING_REVIEW') {
      try {
        const ownerRow = await db.get(
          "SELECT value FROM app_settings WHERE key IN ('owner_whatsapp_number', 'shop_phone') AND value IS NOT NULL AND value != '' ORDER BY (CASE WHEN key = 'owner_whatsapp_number' THEN 1 ELSE 2 END) ASC LIMIT 1"
        );
        const ownerPhone = ownerRow?.value?.replace(/\\D/g, '');
        const cleanCustPhone = phone.replace(/\\D/g, '');

        if (ownerPhone && ownerPhone !== cleanCustPhone && ownerPhone.length >= 10) {
          const ownerAlertMsg = 
`📸 *Visual Reference Review Alert*
Medicine: *${med.name}*
Customer: ${customerName || 'Customer'} (${phone})
Status: *Pending Review (${usedImageRecord?.image_source || 'CDN/Camera'})*

👉 Please verify packaging in App: *Database ➔ Catalog Images* so this verified image is permanently cached for future refills.`;

          await whatsappQueueWorker.enqueue(
            ownerPhone,
            ownerAlertMsg,
            'admin_escalation',
            'Store Owner'
          );
          ownerNotified = true;
        }
      } catch (ownerErr) {
        console.warn('[VisualReference] Could not notify owner WhatsApp:', ownerErr);
      }
    }

    res.json({
      success: true,
      message: 'Visual reference sent successfully',
      queueId,
      has_image: !!finalFileObj,
      is_pending_review: isPendingReview,
      owner_notified: ownerNotified
    });
  } catch (err: any) {
    console.error('[CatalogImages API] Error sending visual reference:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to send visual reference' });
  }
});

export default router;
