import express from 'express';
import { dbManager } from '../database/connection.js';

const router = express.Router();

export interface InteractionAlert {
  drugAId: number;
  drugAName: string;
  drugBId: number;
  drugBName: string;
  interactingEntity: string;
  severity: string;
  description?: string;
}

/**
 * POST /api/clinical/check-interactions
 * Cross-checks a list of medicine IDs in the active cart against known drug-drug interactions.
 */
router.post('/check-interactions', async (req, res) => {
  const { medicine_ids } = req.body;

  if (!Array.isArray(medicine_ids) || medicine_ids.length < 2) {
    return res.json({ interactions: [], count: 0 });
  }

  // Filter valid numbers and deduplicate
  const uniqueIds = Array.from(new Set(medicine_ids.map(id => Number(id)).filter(id => !isNaN(id) && id > 0)));
  if (uniqueIds.length < 2) {
    return res.json({ interactions: [], count: 0 });
  }

  try {
    const db = await dbManager.getConnection();
    const placeholders = uniqueIds.map(() => '?').join(',');

    const rows = await db.all(
      `SELECT m.id, m.name, c.salt_composition, c.drug_interactions
       FROM medicines m
       LEFT JOIN medicine_clinical_info c ON m.id = c.medicine_id
       WHERE m.id IN (${placeholders})`,
      uniqueIds
    );

    const interactions: InteractionAlert[] = [];
    const seenPairs = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const itemA = rows[i];
      if (!itemA.drug_interactions) continue;

      let interactionData: any = null;
      try {
        interactionData = typeof itemA.drug_interactions === 'string'
          ? JSON.parse(itemA.drug_interactions)
          : itemA.drug_interactions;
      } catch (_) {
        continue;
      }

      if (!interactionData || !Array.isArray(interactionData.drug)) continue;

      const drugs = interactionData.drug || [];
      const brands = interactionData.brand || [];
      const effects = interactionData.effect || [];

      for (let j = 0; j < rows.length; j++) {
        if (i === j) continue;
        const itemB = rows[j];

        // Unique pair key to prevent duplicate symmetric warnings (e.g. A->B and B->A)
        const pairKey = [Math.min(itemA.id, itemB.id), Math.max(itemA.id, itemB.id)].join('_');
        if (seenPairs.has(pairKey)) continue;

        const bNameLower = (itemB.name || '').toLowerCase();
        const bSaltLower = (itemB.salt_composition || '').toLowerCase();

        for (let k = 0; k < drugs.length; k++) {
          const drugName = (drugs[k] || '').trim().toLowerCase();
          const brandTokens = (brands[k] || '').toLowerCase().split(',').map((b: string) => b.trim()).filter(Boolean);
          const severity = effects[k] || 'MODERATE';

          let matched = false;
          let matchedEntity = '';

          // Check if drug matches salt composition or medicine name
          if (drugName.length >= 3) {
            if (bSaltLower.includes(drugName) || bNameLower.includes(drugName)) {
              matched = true;
              matchedEntity = drugs[k];
            }
          }

          // Check brand matches
          if (!matched) {
            for (const bToken of brandTokens) {
              if (bToken.length >= 3 && bNameLower.includes(bToken)) {
                matched = true;
                matchedEntity = bToken;
                break;
              }
            }
          }

          if (matched) {
            seenPairs.add(pairKey);
            interactions.push({
              drugAId: itemA.id,
              drugAName: itemA.name,
              drugBId: itemB.id,
              drugBName: itemB.name,
              interactingEntity: matchedEntity,
              severity: severity.toUpperCase()
            });
            break; // recorded for this pair
          }
        }
      }
    }

    res.json({
      interactions,
      count: interactions.length
    });
  } catch (error) {
    console.error('[Clinical] Failed to check drug interactions:', error);
    res.status(500).json({ error: 'Failed to verify drug interactions' });
  }
});

/**
 * GET /api/clinical/search-by-salt
 * Fast search for medicines by active salt or therapeutic class.
 */
router.get('/search-by-salt', async (req, res) => {
  const saltQuery = (req.query.salt as string || '').trim();
  if (!saltQuery || saltQuery.length < 2) {
    return res.json({ medicines: [] });
  }

  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      `SELECT m.id, m.name, m.manufacturer, m.mrp, m.sell_price,
              c.salt_composition, c.sub_category,
              COALESCE(im.quantity, 0) as stock_quantity
       FROM medicine_clinical_info c
       JOIN medicines m ON c.medicine_id = m.id
       LEFT JOIN inventory_master im ON m.id = im.medicine_id
       WHERE c.salt_composition LIKE ? OR c.sub_category LIKE ?
       ORDER BY COALESCE(im.quantity, 0) DESC, m.name ASC
       LIMIT 30`,
      [`%${saltQuery}%`, `%${saltQuery}%`]
    );

    res.json({ medicines: rows });
  } catch (error) {
    console.error('[Clinical] Search by salt failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
