import express, { Request, Response } from 'express';
import { pricingService, PricingRule } from '../../services/pricing/pricingService.js';
import { catalogService } from '../../services/catalog/catalogService.js';
import { sendSuccess, sendError } from '../../middleware/apiResponse.js';

const router = express.Router();

// ─── Pricing Management Endpoints ─────────────────────────────────────────────

router.get('/pricing/rules', async (req: Request, res: Response) => {
  try {
    const rules = await pricingService.getActiveRules();
    return sendSuccess(res, { rules });
  } catch (err: any) {
    return sendError(res, 'PRICING_RULES_ERROR', err.message || 'Failed to fetch pricing rules', 500);
  }
});

router.post('/pricing/rules', async (req: Request, res: Response) => {
  try {
    const rule: PricingRule = req.body;
    if (!rule.rule_type) {
      return sendError(res, 'INVALID_RULE', 'rule_type is required', 400);
    }
    const ruleId = await pricingService.saveRule(rule);
    return sendSuccess(res, { ruleId, message: 'Pricing rule saved successfully' });
  } catch (err: any) {
    return sendError(res, 'PRICING_SAVE_ERROR', err.message || 'Failed to save pricing rule', 500);
  }
});

router.delete('/pricing/rules/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    await pricingService.deleteRule(id);
    return sendSuccess(res, { message: 'Pricing rule deleted successfully' });
  } catch (err: any) {
    return sendError(res, 'PRICING_DELETE_ERROR', err.message || 'Failed to delete pricing rule', 500);
  }
});

router.post('/pricing/calculate', async (req: Request, res: Response) => {
  try {
    const { mrp, costPrice, category, medicineId, storeId } = req.body;
    const result = await pricingService.calculatePrice({
      mrp: Number(mrp) || 0,
      costPrice: costPrice !== undefined ? Number(costPrice) : null,
      category,
      medicineId: medicineId ? Number(medicineId) : null,
      storeId: storeId ? Number(storeId) : null
    });
    return sendSuccess(res, result);
  } catch (err: any) {
    return sendError(res, 'CALCULATION_ERROR', err.message || 'Failed to calculate price', 500);
  }
});

// ─── Catalog Channel Visibility Endpoints ────────────────────────────────────

router.get('/catalog', async (req: Request, res: Response) => {
  try {
    const { search, category, channel, limit, offset, storeId } = req.query;
    const result = await catalogService.getCatalog({
      search: search as string,
      category: category as string,
      channel: (channel as any) || 'all',
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
      storeId: storeId ? parseInt(storeId as string, 10) : 1
    });
    return sendSuccess(res, result);
  } catch (err: any) {
    return sendError(res, 'ADMIN_CATALOG_ERROR', err.message || 'Failed to fetch catalog', 500);
  }
});

router.put('/catalog/:id/visibility', async (req: Request, res: Response) => {
  try {
    const medicineId = parseInt(String(req.params.id), 10);
    const { website, whatsapp, portal, pos, featuredRank } = req.body;
    await catalogService.updateChannelVisibility(medicineId, {
      website,
      whatsapp,
      portal,
      pos,
      featuredRank
    });
    return sendSuccess(res, { message: 'Channel visibility updated successfully' });
  } catch (err: any) {
    return sendError(res, 'VISIBILITY_UPDATE_ERROR', err.message || 'Failed to update visibility', 500);
  }
});

export default router;
