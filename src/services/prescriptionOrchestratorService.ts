/**
 * Unified Prescription OCR & DB Matching Orchestrator
 * 
 * Unifies prescription processing across WhatsApp, Website, POS, and Mobile.
 */

import { Jimp } from 'jimp';
import { dbManager } from '../database/connection.js';
import { productNameFilterService } from './productNameFilterService.js';
import { visualIndexService } from './visualIndexService.js';
import { eventService } from './eventService.js';
import { classifyDosageGroup } from './dosageGroupService.js';
import { resolveInventoryStock, classifyAvailability } from './whatsappIntentService.js';
import { sanitizePharmarackQuery, isPlausibleMedicineName } from './intentKeywords.js';
import { searchCatalog } from './pharmarackCatalogCache.js';
import { aiCameraService } from './aiCameraService.js';
import { parseDoctorRxNumberedItems, extractDoctorRxSig, extractDoctorRxDuration } from './aiCameraRuleEngine.js';

export type ScanSource = 'whatsapp' | 'website' | 'mobile' | 'pos' | 'telegram';

export interface PrescriptionScanRequest {
  buffer: Buffer;
  source: ScanSource;
  msgId?: string;
  imagePath?: string;
  storeId?: number;
}

export interface MatchedMedicineDetail {
  medicineId: number;
  name: string;
  score: number;
  manufacturer?: string;
  mrp?: number | null;
  packaging?: string;
  dosageForm?: string;
}

export interface PrescriptionScanItemResult {
  rawText: string;
  brandHint: string;
  dosageForm?: string;
  strength?: string;
  prescribedQuantity: number;
  matches: MatchedMedicineDetail[];
  topScore: number;
  availability: string;
  inventoryQty: number;
  catalogHits?: any[];
  pharmarackHits?: any[];
}

export interface PrescriptionScanResult {
  scanId: number;
  rawOcrText: string;
  isPrescription: boolean;
  doctorName?: string;
  clinicName?: string;
  patientName?: string;
  patientAge?: string;
  items: PrescriptionScanItemResult[];
  visualBoostName?: string;
  source: ScanSource;
  imagePath: string;
  createdAt: string;
}

class PrescriptionOrchestratorService {
  /**
   * Preprocess image: scale to max 1200px, greyscale, contrast 0.25
   */
  public async preprocessImage(buffer: Buffer): Promise<Buffer> {
    try {
      const img = await Jimp.read(buffer);
      let width = img.bitmap.width;
      let height = img.bitmap.height;
      const maxDim = 1200;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        img.resize({ w: width, h: height });
      }

      img.greyscale().contrast(0.25);
      return await img.getBuffer('image/jpeg');
    } catch (err) {
      console.warn('[PrescriptionOrchestrator] Preprocessing fallback to raw buffer:', err);
      return buffer;
    }
  }

  /**
   * Apply handwriting doctor script OCR corrections
   */
  public normalizeHandwritingGlyphs(raw: string): string {
    let text = raw;
    text = text.replace(/\bpole\b/gi, 'Dolo');
    text = text.replace(/\besomg\b|\be50mg\b|\bbsomg\b/gi, '650mg');
    text = text.replace(/\bfap\b/gi, 'Pan');
    text = text.replace(/\baomqg\b|\baomg\b|\ba0mg\b|\b4omqg\b/gi, '40mg');
    text = text.replace(/\b21\s*[-=]*\s*[0oO]\b|\b21\s*[-=]?\s*o\b/gi, 'Zifi-O');
    text = text.replace(/\b20omg\b|\bzo0mg\b/gi, '200mg');
    text = text.replace(/\bopese\b|\boprise\b/gi, 'Uprise');
    text = text.replace(/\b-\s*02\b|\b-\s*03\b/gi, '- D3');
    text = text.replace(/\bdo\b(?=\s*[-—–\(\d]|$)/gi, '60K');
    text = text.replace(/\bth\.?\b|\btb\.?\b/gi, 'Tab.');
    text = text.replace(/\bgap\.?\b/gi, 'Cap.');
    return text;
  }

  /**
   * Extract header and candidate medicine lines
   */
  public extractPrescriptionStructure(text: string): {
    doctorName?: string;
    clinicName?: string;
    patientName?: string;
    patientAge?: string;
    candidateLines: Array<{ raw: string; normalized: string; qty: number }>;
  } {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let doctorName: string | undefined;
    let clinicName: string | undefined;
    let patientName: string | undefined;
    let patientAge: string | undefined;
    const candidateLines: Array<{ raw: string; normalized: string; qty: number }> = [];

    for (const line of lines) {
      if (!clinicName && /(clinic|hospital|healthcare|dispensary|medical centre)/i.test(line)) {
        clinicName = line.replace(/[^a-zA-Z\s]/g, ' ').trim();
        continue;
      }
      if (!doctorName && /(dr\.?|doctor|dt\.?)\s+[A-Za-z\s]{3,30}/i.test(line)) {
        doctorName = line.replace(/^(?:dr\.?|doctor|dt\.?)\s*/i, 'Dr. ').trim();
        continue;
      }
      if (!patientName && /(mr\.?|mrs\.?|ms\.?|master|patient\s*name)\s+[A-Za-z\s]{3,30}/i.test(line)) {
        const match = line.match(/(?:mr\.?|mrs\.?|ms\.?|master|name\s*[:\-])\s*([A-Za-z\s]{3,30})/i);
        patientName = match ? match[0].trim() : line;
        continue;
      }
      if (!patientAge && /(?:age|yrs?|years?)\s*[:\-]?\s*(\d{1,3})/i.test(line)) {
        const ageMatch = line.match(/(?:age|yrs?|years?)\s*[:\-]?\s*(\d{1,3})/i);
        if (ageMatch) patientAge = ageMatch[1];
      }

      const normalized = this.normalizeHandwritingGlyphs(line);
      const isMedicineLine =
        /\b(tab\.?|tablet|cap\.?|capsule|inj\.?|syp\.?|syrup|ointment|gel|drops)\b/i.test(normalized) ||
        /\b\d+\s*(?:mg|gm|g|ml|iu|k)\b/i.test(normalized) ||
        /\b(dolo|pan|zifi|uprise|azithro|amox|clav|telma|augmentin|cefixime|glycomet|metformin)\b/i.test(normalized) ||
        /\(\d+\)/.test(normalized);

      const isHeaderOrFooter =
        /(timing|closed|sunday|address|phone|tel|email|reg\.?\s*no|date\s*[:\-])/i.test(line);

      if (isMedicineLine && !isHeaderOrFooter) {
        let qty = 1;
        const qtyMatch = line.match(/\((\d+)\)/) || line.match(/x\s*(\d+)/i) || line.match(/\b(?:qty|count)\s*[:\-]?\s*(\d+)/i);
        if (qtyMatch) {
          const parsed = parseInt(qtyMatch[1], 10);
          if (parsed > 0 && parsed <= 100) qty = parsed;
        }
        candidateLines.push({ raw: line, normalized, qty });
      }
    }

    // Rule 92: Fallback to structured doctor numbered list parsing if no medicine keywords caught
    if (candidateLines.length === 0) {
      const numberedItems = parseDoctorRxNumberedItems(text);
      for (const item of numberedItems) {
        const norm = this.normalizeHandwritingGlyphs(item.text);
        candidateLines.push({ raw: item.text, normalized: norm, qty: item.qty });
      }
    }

    return { doctorName, clinicName, patientName, patientAge, candidateLines };
  }

  /**
   * Scan a single prescription image
   */
  public async scanPrescriptionImage(req: PrescriptionScanRequest): Promise<PrescriptionScanResult> {
    const { buffer, source, msgId, storeId = 1 } = req;
    const imagePath = req.imagePath || `uploads/prescriptions/Rx_${Date.now()}.jpg`;

    // 1. Run core AI camera OCR processor
    const ocrOutput = await aiCameraService.processImage(buffer, true);
    const rawOcrText = ocrOutput.text || ocrOutput.potentialName || '';
    const isPrescription = !!(ocrOutput.isPrescription || ocrOutput.prescriptionData || /dr\.?|rx|patient/i.test(rawOcrText));

    // 2. Extract structure
    const struct = this.extractPrescriptionStructure(rawOcrText);
    const doctorName = ocrOutput.prescriptionData?.doctorName || struct.doctorName;
    const clinicName = ocrOutput.prescriptionData?.clinicName || struct.clinicName;
    const patientName = ocrOutput.prescriptionData?.patientName || struct.patientName;
    const patientAge = ocrOutput.prescriptionData?.patientAge || struct.patientAge;

    // 3. Visual pHash search boost
    let visualBoostName: string | undefined;
    try {
      const visualMatches = await visualIndexService.fusedSearch(buffer, rawOcrText, { limit: 1, maxVisualDistance: 12 });
      if (visualMatches && visualMatches.length > 0 && visualMatches[0].fusedScore >= 75) {
        visualBoostName = visualMatches[0].product_name;
      }
    } catch (_) { }

    // 4. Line items candidate resolution (prefer structured Vision items if present)
    let candidateLines = struct.candidateLines;
    if (Array.isArray(ocrOutput.prescriptionData?.items) && ocrOutput.prescriptionData.items.length > 0) {
      const visionCandidates = ocrOutput.prescriptionData.items.map((it: any) => {
        const name = it.brandName || it.name || '';
        const raw = `${name} ${it.strength || ''} ${it.dosageForm || ''}`.trim();
        return {
          raw: raw || it.composition || 'Prescribed Medicine',
          normalized: this.normalizeHandwritingGlyphs(raw),
          qty: it.prescribedQuantity || 1
        };
      }).filter((c: any) => c.raw.length > 0);

      if (visionCandidates.length > 0) {
        candidateLines = visionCandidates;
      }
    }

    if (candidateLines.length === 0 && rawOcrText) {
      const fallbackName = ocrOutput.medicineInfo?.potentialName || ocrOutput.medicineInfo?.brandName;
      if (fallbackName && fallbackName.length >= 3) {
        candidateLines = [{ raw: fallbackName, normalized: this.normalizeHandwritingGlyphs(fallbackName), qty: 1 }];
      } else {
        candidateLines = [{ raw: rawOcrText.slice(0, 120), normalized: this.normalizeHandwritingGlyphs(rawOcrText.slice(0, 120)), qty: 1 }];
      }
    }

    const items: PrescriptionScanItemResult[] = [];
    const distinctNamesForStock = new Set<string>();

    for (const cand of candidateLines) {
      const dosageGroup = classifyDosageGroup(cand.normalized);
      let filterResult: any;
      try {
        filterResult = await productNameFilterService.filterProductNames(cand.normalized, {
          minConfidenceThreshold: 0.60
        });
      } catch (err) {
        filterResult = { matches: [], scoredMatches: [], topScore: 0 };
      }

      const matches: MatchedMedicineDetail[] = [];
      const db = await dbManager.getConnection();

      if (filterResult.scoredMatches && filterResult.scoredMatches.length > 0) {
        for (const sm of filterResult.scoredMatches.slice(0, 3)) {
          const med = await db.get(
            'SELECT id, name, manufacturer, mrp, packaging, dosage_form FROM medicines WHERE LOWER(name) = ? LIMIT 1',
            [sm.name.toLowerCase()]
          );
          if (med) {
            matches.push({
              medicineId: med.id,
              name: med.name,
              score: sm.score,
              manufacturer: med.manufacturer,
              mrp: med.mrp,
              packaging: med.packaging,
              dosageForm: med.dosage_form
            });
            distinctNamesForStock.add(med.name.toLowerCase());
          }
        }
      }

      // If visual boost matched and score is high, promote to top
      if (visualBoostName && matches.every(m => m.name.toLowerCase() !== visualBoostName!.toLowerCase())) {
        const boostMed = await db.get(
          'SELECT id, name, manufacturer, mrp, packaging, dosage_form FROM medicines WHERE LOWER(name) = ? LIMIT 1',
          [visualBoostName.toLowerCase()]
        );
        if (boostMed) {
          matches.unshift({
            medicineId: boostMed.id,
            name: boostMed.name,
            score: 0.90,
            manufacturer: boostMed.manufacturer,
            mrp: boostMed.mrp,
            packaging: boostMed.packaging,
            dosageForm: boostMed.dosage_form
          });
          distinctNamesForStock.add(boostMed.name.toLowerCase());
        }
      }

      const topScore = matches.length > 0 ? Math.max(...matches.map(m => m.score)) : (filterResult.topScore || 0);

      items.push({
        rawText: cand.raw,
        brandHint: matches[0]?.name || cand.normalized.split(/\s+/)[0] || '',
        dosageForm: matches[0]?.dosageForm || (dosageGroup !== 'ALL' ? dosageGroup : undefined),
        strength: cand.normalized.match(/\d+\s*(?:mg|gm|ml|k|iu)/i)?.[0],
        prescribedQuantity: cand.qty,
        matches,
        topScore,
        availability: 'REGISTERED_NO_STOCK',
        inventoryQty: 0
      });
    }

    // 5. Batched inventory stock check (1 single SQL query)
    if (distinctNamesForStock.size > 0) {
      try {
        const db = await dbManager.getConnection();
        const stockMap = await resolveInventoryStock(Array.from(distinctNamesForStock), db);

        for (const item of items) {
          const matchedNames = item.matches.map(m => m.name);
          item.availability = classifyAvailability(matchedNames, stockMap);
          const bestStock = Math.max(0, ...matchedNames.map(n => stockMap[n.toLowerCase()] ?? 0));
          item.inventoryQty = bestStock;
        }
      } catch (stockErr) {
        console.warn('[PrescriptionOrchestrator] Batched stock lookup error:', stockErr);
      }
    }

    // 6. Batched Pharmarack catalog lookup & live search (Capped at 3 live queries)
    let liveSearchCount = 0;
    for (const item of items) {
      if (item.matches.length > 0) {
        const primaryName = item.matches[0].name;
        const sanitized = sanitizePharmarackQuery(primaryName);

        // Offline catalog cache
        try {
          const cat = await searchCatalog(sanitized, item.dosageForm, item.matches[0].mrp ?? undefined);
          item.catalogHits = cat?.mapped?.slice(0, 3) || [];
        } catch (_) { }

        // Live search budget cap: 3 per scan
        if (liveSearchCount < 3 && isPlausibleMedicineName(sanitized)) {
          try {
            const { performPharmarackSearch } = await import('../routes/pharmarack.js');
            const outcome = await performPharmarackSearch(sanitized, null, true);
            if (outcome.status === 'ok' && Array.isArray(outcome.items) && outcome.items.length > 0) {
              item.pharmarackHits = outcome.items.slice(0, 3);
              liveSearchCount++;
            }
          } catch (_) { }
        }
      }
    }

    // 7. Atomic SQLite persistence (prescription_scans + prescription_scan_items)
    let scanId = 0;
    try {
      const db = await dbManager.getConnection();
      const insertScan = await db.run(
        `INSERT INTO prescription_scans (
          source, source_msg_id, image_path, raw_ocr_text,
          doctor_name, clinic_name, patient_name, patient_age,
          is_prescription, status, confidence, store_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scanned', ?, ?)`,
        [
          source,
          msgId || null,
          imagePath,
          rawOcrText,
          doctorName || null,
          clinicName || null,
          patientName || null,
          patientAge || null,
          isPrescription ? 1 : 0,
          items.length > 0 ? items[0].topScore : 0,
          storeId
        ]
      );
      scanId = Number(insertScan.lastID) || 0;

      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const matched = it.matches[0];
        await db.run(
          `INSERT INTO prescription_scan_items (
            scan_id, line_index, raw_text, brand_hint, strength, dosage_form,
            prescribed_qty, matched_medicine_id, match_score, match_type,
            availability, inventory_qty, catalog_hit_json, pharmarack_hit_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            scanId,
            idx,
            it.rawText,
            it.brandHint,
            it.strength || null,
            it.dosageForm || null,
            it.prescribedQuantity,
            matched ? matched.medicineId : null,
            it.topScore,
            matched ? (it.topScore >= 0.95 ? 'exact_name' : 'fuzzy_name') : 'unmatched',
            it.availability,
            it.inventoryQty,
            it.catalogHits ? JSON.stringify(it.catalogHits) : null,
            it.pharmarackHits ? JSON.stringify(it.pharmarackHits) : null
          ]
        );
      }
    } catch (dbSaveErr) {
      console.error('[PrescriptionOrchestrator] Failed to persist prescription scan to DB:', dbSaveErr);
    }

    const result: PrescriptionScanResult = {
      scanId,
      rawOcrText,
      isPrescription,
      doctorName,
      clinicName,
      patientName,
      patientAge,
      items,
      visualBoostName,
      source,
      imagePath,
      createdAt: new Date().toISOString()
    };

    // 8. Broadcast SSE events
    eventService.broadcast('prescription_scan_complete', result);

    if (source === 'whatsapp' && items.length > 0) {
      const primaryItem = items[0];
      eventService.broadcast('wa_medicine_match', {
        medicineName: primaryItem.brandHint,
        quantity: primaryItem.prescribedQuantity,
        dosageForm: primaryItem.dosageForm,
        localMatches: primaryItem.matches.map(m => m.name),
        availability: primaryItem.availability,
        inventoryStock: { [primaryItem.brandHint.toLowerCase()]: primaryItem.inventoryQty },
        confidence: Math.round(primaryItem.topScore * 100),
        source: 'ocr',
        mediaId: msgId,
        scanId
      });
    }

    return result;
  }

  /**
   * Scan multiple images (1-10) in a bundle and merge items
   */
  public async scanPrescriptionBundle(
    buffers: Buffer[],
    meta: Omit<PrescriptionScanRequest, 'buffer'>
  ): Promise<PrescriptionScanResult> {
    if (!buffers || buffers.length === 0) {
      throw new Error('No images provided for prescription bundle scan.');
    }

    // Process all images concurrently with Promise.all
    const results = await Promise.all(
      buffers.map((buf, idx) =>
        this.scanPrescriptionImage({
          buffer: buf,
          source: meta.source,
          msgId: meta.msgId,
          imagePath: `uploads/prescriptions/Rx_Bundle_${Date.now()}_${idx + 1}.jpg`,
          storeId: meta.storeId
        }).catch(err => {
          console.warn(`[PrescriptionOrchestrator] Bundle item ${idx} failed:`, err);
          return null;
        })
      )
    );

    const validResults = results.filter((r): r is PrescriptionScanResult => r !== null);
    if (validResults.length === 0) {
      throw new Error('All prescription images in bundle failed processing.');
    }

    // Merge deduped items: higher stock or higher score wins
    const itemMap = new Map<string, PrescriptionScanItemResult>();
    for (const res of validResults) {
      for (const it of res.items) {
        const key = it.brandHint.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!key) continue;
        const existing = itemMap.get(key);
        if (!existing) {
          itemMap.set(key, it);
        } else {
          if (it.inventoryQty > existing.inventoryQty || it.topScore > existing.topScore) {
            itemMap.set(key, it);
          }
        }
      }
    }

    const mergedItems = Array.from(itemMap.values());
    const primary = validResults[0];

    return {
      scanId: primary.scanId,
      rawOcrText: validResults.map(r => r.rawOcrText).join('\n---\n'),
      isPrescription: validResults.some(r => r.isPrescription),
      doctorName: validResults.find(r => r.doctorName)?.doctorName,
      clinicName: validResults.find(r => r.clinicName)?.clinicName,
      patientName: validResults.find(r => r.patientName)?.patientName,
      patientAge: validResults.find(r => r.patientAge)?.patientAge,
      items: mergedItems,
      source: meta.source,
      imagePath: primary.imagePath,
      createdAt: primary.createdAt
    };
  }
}

export const prescriptionOrchestratorService = new PrescriptionOrchestratorService();
export default prescriptionOrchestratorService;
