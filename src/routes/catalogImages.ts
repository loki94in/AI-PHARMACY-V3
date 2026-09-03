import express from 'express';
import { catalogImageService } from '../services/catalogImageService.js';
import { dbManager } from '../database/connection.js';

const router = express.Router();

/**
 * GET /api/catalog/images — Paginated list of catalog images with filters
 */
router.get('/', async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const medicine_id = req.query.medicine_id ? parseInt(String(req.query.medicine_id), 10) : undefined;
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;

    const result = await catalogImageService.getImages({
      status,
      search,
      medicine_id,
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
 * POST /api/catalog/images/:id/approve — Approve image as verified active catalog image
 */
router.post('/:id/approve', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const verifiedBy = req.body?.verified_by || 'pharmacist';
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

export default router;
