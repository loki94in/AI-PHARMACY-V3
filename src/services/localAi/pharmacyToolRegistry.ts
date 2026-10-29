/**
 * Scoped Pharmacy Tool Registry
 *
 * Exposes strictly bounded, typed tool functions over existing canonical application services:
 * - Refill lookup and execution (patient_refills, refillCartService)
 * - Catalog stock & public price verification (medicines, pharmacyKnowledgeRetriever)
 * - Medicine alternatives & salt comparison (medicineAvailabilityEngine, substitutes)
 * - Expiry audit & stock breakdown (inventory_master, inventoryCache)
 * - Sales reporting & comparative analytics (sales_invoices, sale_items)
 * - Document OCR for prescriptions and invoices (prescriptionOrchestratorService, invoiceVisionService)
 * - Customer enquiries (medicine_enquiries)
 * - Call tasks & follow-ups (patient_call_tasks)
 * - Application screen & workflow assistance
 * - Pharmacist escalation and takeover
 *
 * Safety & Privacy Controls:
 * - Unrestricted generated SQL is STRICTLY FORBIDDEN.
 * - Customer-facing outputs NEVER leak wholesale rates (PTR), supplier costs, or internal margins.
 * - Consequential mutations require explicit confirmation (Rule 6 Human-in-the-Loop).
 * - Full audit trail recorded for all executed mutations via logMutationAudit.
 */

import { dbManager } from '../../database/connection.js';
import { logMutationAudit } from '../auditLoggerService.js';
import { pharmacyKnowledgeRetriever } from './pharmacyKnowledgeRetriever.js';
import { eventService } from '../eventService.js';
import { medicineAvailabilityEngine } from '../medicineAvailabilityEngine.js';
import { prescriptionOrchestratorService } from '../prescriptionOrchestratorService.js';
import { invoiceVisionService } from '../invoiceVisionService.js';

export interface RefillRecordItem {
  id: number;
  medicineName: string;
  quantityNeeded: number;
  nextRefillDate: string | null;
  status: string;
  isReady: boolean;
  inStock: boolean;
  totalStock: number;
  pricePerUnit: number;
}

export interface MedicineAvailabilityItem {
  id: number;
  name: string;
  genericName?: string;
  dosageForm?: string;
  strength?: string;
  packSize?: string;
  mrp: number;
  sellingPrice: number;
  inStock: boolean;
  stockQuantity: number;
  rackLocation?: string;
}

export interface AlternativeCandidateItem {
  id: number;
  name: string;
  genericName?: string;
  dosageForm?: string;
  strength?: string;
  packSize?: string;
  mrp: number;
  sellingPrice: number;
  inStock: boolean;
  stockQuantity: number;
  manufacturer?: string;
  differenceNote?: string;
}

export interface AlternativesResult {
  sourceMedicine: string;
  sourceSalt?: string;
  sourceInStock: boolean;
  candidates: AlternativeCandidateItem[];
  clinicalNotice: string;
}

export interface ExpiringBatchItem {
  id: number;
  medicineId: number;
  medicineName: string;
  batchNo: string;
  quantity: number;
  expiryDate: string;
  rackLocation?: string;
  mrp: number;
}

export interface SalesComparisonResult {
  role: string;
  period: string;
  todayRevenue: number;
  yesterdayRevenue: number;
  deltaRevenue: number;
  percentChange: number;
  todayBillCount: number;
  yesterdayBillCount: number;
  todayAverageTicket: number;
  yesterdayAverageTicket: number;
  analysisExplanation: string;
  topSellersToday: string[];
  topSellersYesterday: string[];
}

export class PharmacyToolRegistry {
  /**
   * Retrieves active chronic refills for a verified customer phone/ID
   */
  public async lookupPatientRefills(
    phone: string,
    customerId?: number | null,
    dbInstance?: any
  ): Promise<RefillRecordItem[]> {
    const db = dbInstance || (await dbManager.getConnection());
    const raw = String(phone || '').replace(/\D/g, '');
    const cleanPhone = raw.length >= 10 ? raw.slice(-10) : raw;

    let query = `
      SELECT pr.id, pr.patient_name, pr.patient_phone, pr.quantity_needed,
             pr.next_refill_date, pr.status, pr.is_ready, pr.medicine_name,
             m.name as catalog_med, m.sell_price, m.mrp, m.total_stock
      FROM patient_refills pr
      LEFT JOIN medicines m ON pr.medicine_id = m.id
      WHERE (pr.is_active = 1 OR pr.is_active IS NULL)
        AND pr.status NOT IN ('completed', 'canceled', 'cancelled')
        AND (
          pr.patient_phone LIKE ? OR pr.patient_phone = ?
          ${customerId ? 'OR pr.customer_id = ?' : ''}
        )
      ORDER BY pr.next_refill_date ASC LIMIT 10
    `;

    const params: any[] = [`%${cleanPhone}`, cleanPhone];
    if (customerId) params.push(customerId);

    const rows = await db.all(query, params).catch(() => []);

    return rows.map((r: any) => ({
      id: r.id,
      medicineName: r.medicine_name || r.catalog_med || 'Medicine',
      quantityNeeded: r.quantity_needed || 1,
      nextRefillDate: r.next_refill_date ? String(r.next_refill_date).slice(0, 10) : null,
      status: r.status || 'pending',
      isReady: Boolean(r.is_ready),
      inStock: Number(r.total_stock || 0) >= Number(r.quantity_needed || 1),
      totalStock: Number(r.total_stock || 0),
      pricePerUnit: Number(r.sell_price || r.mrp || 0)
    }));
  }

  /**
   * Authoritative medicine search with customer-safe pricing (PTR/costs strictly masked)
   */
  public async searchMedicineAvailability(
    queryText: string,
    dbInstance?: any
  ): Promise<MedicineAvailabilityItem[]> {
    const db = dbInstance || (await dbManager.getConnection());
    const evidence = await pharmacyKnowledgeRetriever.retrieveMedicineEvidence(queryText, db);

    return evidence.map(m => ({
      id: m.id,
      name: m.name,
      genericName: m.genericName,
      dosageForm: m.dosageForm,
      strength: m.strength,
      packSize: m.packSize,
      mrp: m.mrp,
      sellingPrice: m.sellingPrice,
      inStock: m.inStock,
      stockQuantity: m.stockQuantity,
      rackLocation: m.rackLocation
    }));
  }

  /**
   * Compares formulations and finds same-salt alternatives for a given medicine
   */
  public async findAlternatives(
    medicineQuery: string,
    dbInstance?: any
  ): Promise<AlternativesResult> {
    const db = dbInstance || (await dbManager.getConnection());
    const cleanQuery = medicineQuery.trim();

    // 1. Locate the source medicine
    let sourceRow = await db.get(
      `SELECT id, name, generic_name, dosage_form, mrp, sell_price, total_stock, manufacturer
       FROM medicines
       WHERE name = ? COLLATE NOCASE LIMIT 1`,
      [cleanQuery]
    ).catch(() => null);

    if (!sourceRow) {
      sourceRow = await db.get(
        `SELECT id, name, generic_name, dosage_form, mrp, sell_price, total_stock, manufacturer
         FROM medicines
         WHERE name LIKE ? COLLATE NOCASE
         ORDER BY total_stock DESC LIMIT 1`,
        [`%${cleanQuery}%`]
      ).catch(() => null);
    }

    const sourceName = sourceRow?.name || cleanQuery;
    const sourceSalt = sourceRow?.generic_name || '';
    const sourceInStock = Number(sourceRow?.total_stock || 0) > 0;
    const sourceId = sourceRow?.id || 0;

    let candidates: AlternativeCandidateItem[] = [];

    // 2. Find exact generic_name matches
    if (sourceSalt && sourceSalt.length >= 3) {
      const matchRows = await db.all(
        `SELECT id, name, generic_name, dosage_form, pack_size, mrp, sell_price, total_stock, manufacturer, rack
         FROM medicines
         WHERE generic_name = ? COLLATE NOCASE AND id != ?
         ORDER BY total_stock DESC, name ASC LIMIT 10`,
        [sourceSalt, sourceId]
      ).catch(() => []);

      candidates = matchRows.map((r: any) => ({
        id: r.id,
        name: r.name,
        genericName: r.generic_name || sourceSalt,
        dosageForm: r.dosage_form,
        packSize: r.pack_size,
        mrp: Number(r.mrp || 0),
        sellingPrice: Number(r.sell_price || r.mrp || 0),
        inStock: Number(r.total_stock || 0) > 0,
        stockQuantity: Number(r.total_stock || 0),
        manufacturer: r.manufacturer,
        differenceNote: `Same composition (${sourceSalt}). ${Number(r.total_stock || 0) > 0 ? `Available in stock: ${r.total_stock} units` : 'Currently out of stock'}.`
      }));
    }

    // 3. Fallback: use medicineAvailabilityEngine if generic_name search returned empty
    if (candidates.length === 0 && cleanQuery.length >= 3) {
      try {
        const altRows = await medicineAvailabilityEngine.getAvailableMedicinesOrAlternatives(cleanQuery, {
          mode: 'POS',
          includeOutOfStock: true,
          limit: 10
        });

        const items = [...(altRows.results || []), ...(altRows.suggestions || [])];
        for (const item of items) {
          const m = item.medicine;
          if (m && m.id !== sourceId && !candidates.some(c => c.id === m.id)) {
            candidates.push({
              id: m.id,
              name: m.name,
              genericName: m.generic_name,
              dosageForm: m.dosage_form,
              packSize: m.pack_size,
              mrp: Number(m.mrp || 0),
              sellingPrice: Number(m.sell_price || m.mrp || 0),
              inStock: item.inStock,
              stockQuantity: item.currentStock || Number(m.total_stock || 0),
              manufacturer: m.manufacturer,
              differenceNote: item.matchType ? `Matched by ${item.matchType} similarity.` : undefined
            });
          }
        }
      } catch (_) {}
    }

    return {
      sourceMedicine: sourceName,
      sourceSalt: sourceSalt || undefined,
      sourceInStock,
      candidates,
      clinicalNotice: '⚠️ Pharmacist Verification Required: All medicine substitutions must be clinically verified and approved by a registered pharmacist before dispensing.'
    };
  }

  /**
   * Audits near-expiry and expired batches across inventory
   */
  public async auditExpiringStock(
    timeframe: string = 'next_month',
    dbInstance?: any
  ): Promise<ExpiringBatchItem[]> {
    const db = dbInstance || (await dbManager.getConnection());
    const tf = timeframe.toLowerCase();

    let dateCondition = `im.expiry_date <= date('now', '+60 days') AND im.expiry_date >= date('now')`;

    if (tf.includes('next_month') || tf.includes('next month')) {
      dateCondition = `(
        (im.expiry_date >= date('now', 'start of month', '+1 month') AND im.expiry_date < date('now', 'start of month', '+2 months'))
        OR im.expiry_month = strftime('%Y-%m', date('now', '+1 month'))
        OR (im.expiry_date <= date('now', '+60 days') AND im.expiry_date >= date('now'))
      )`;
    } else if (tf.includes('30') || tf.includes('month')) {
      dateCondition = `im.expiry_date <= date('now', '+30 days') AND im.expiry_date >= date('now')`;
    } else if (tf.includes('90')) {
      dateCondition = `im.expiry_date <= date('now', '+90 days') AND im.expiry_date >= date('now')`;
    } else if (tf.includes('expired')) {
      dateCondition = `im.expiry_date < date('now')`;
    }

    const rows = await db.all(
      `SELECT im.id, im.batch_no, im.quantity, im.expiry_date, im.rack_location,
              m.id as medicine_id, m.name as medicine_name, m.mrp
       FROM inventory_master im
       JOIN medicines m ON im.medicine_id = m.id
       WHERE im.quantity > 0 AND ${dateCondition}
       ORDER BY im.expiry_date ASC LIMIT 25`
    ).catch(() => []);

    return rows.map((r: any) => ({
      id: r.id,
      medicineId: r.medicine_id,
      medicineName: r.medicine_name,
      batchNo: r.batch_no || 'UNKNOWN',
      quantity: Number(r.quantity || 0),
      expiryDate: r.expiry_date ? String(r.expiry_date).slice(0, 10) : 'Near Expiry',
      rackLocation: r.rack_location || undefined,
      mrp: Number(r.mrp || 0)
    }));
  }

  /**
   * Retrieves sales metrics and comparative explanation (today vs yesterday)
   */
  public async getSalesSummary(
    options: { role?: string; dbInstance?: any } = {}
  ): Promise<SalesComparisonResult> {
    const role = options.role || 'staff';
    const db = options.dbInstance || (await dbManager.getConnection());

    if (role === 'customer') {
      return {
        role: 'customer',
        period: 'today',
        todayRevenue: 0,
        yesterdayRevenue: 0,
        deltaRevenue: 0,
        percentChange: 0,
        todayBillCount: 0,
        yesterdayBillCount: 0,
        todayAverageTicket: 0,
        yesterdayAverageTicket: 0,
        analysisExplanation: '🔒 Store financial sales summaries are confidential and restricted to pharmacy staff and store owners.',
        topSellersToday: [],
        topSellersYesterday: []
      };
    }

    // Today's numbers
    const todayStats = await db.get(
      `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total, COALESCE(AVG(total_amount), 0) as avg
       FROM sales_invoices
       WHERE DATE(COALESCE(date, updated_at)) = DATE('now', 'localtime')`
    ).catch(() => ({ count: 0, total: 0, avg: 0 }));

    // Yesterday's numbers
    const yesterdayStats = await db.get(
      `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total, COALESCE(AVG(total_amount), 0) as avg
       FROM sales_invoices
       WHERE DATE(COALESCE(date, updated_at)) = DATE('now', 'localtime', '-1 day')`
    ).catch(() => ({ count: 0, total: 0, avg: 0 }));

    const todayRev = Number(todayStats?.total || 0);
    const yestRev = Number(yesterdayStats?.total || 0);
    const todayCount = Number(todayStats?.count || 0);
    const yestCount = Number(yesterdayStats?.count || 0);
    const todayAvg = Number(todayStats?.avg || 0);
    const yestAvg = Number(yesterdayStats?.avg || 0);

    const deltaRevenue = todayRev - yestRev;
    const percentChange = yestRev > 0 ? Math.round(((todayRev - yestRev) / yestRev) * 100) : 0;

    // Top sellers today
    const topTodayRows = await db.all(
      `SELECT m.name, SUM(si.quantity) as qty
       FROM sale_items si
       JOIN sales_invoices inv ON si.invoice_id = inv.id
       JOIN inventory_master im ON si.inventory_id = im.id
       JOIN medicines m ON im.medicine_id = m.id
       WHERE DATE(COALESCE(inv.date, inv.updated_at)) = DATE('now', 'localtime')
       GROUP BY m.name ORDER BY qty DESC LIMIT 3`
    ).catch(() => []);

    // Top sellers yesterday
    const topYestRows = await db.all(
      `SELECT m.name, SUM(si.quantity) as qty
       FROM sale_items si
       JOIN sales_invoices inv ON si.invoice_id = inv.id
       JOIN inventory_master im ON si.inventory_id = im.id
       JOIN medicines m ON im.medicine_id = m.id
       WHERE DATE(COALESCE(inv.date, inv.updated_at)) = DATE('now', 'localtime', '-1 day')
       GROUP BY m.name ORDER BY qty DESC LIMIT 3`
    ).catch(() => []);

    const topSellersToday = topTodayRows.map((r: any) => `${r.name} (${r.qty})`);
    const topSellersYesterday = topYestRows.map((r: any) => `${r.name} (${r.qty})`);

    // Comparative explanation
    let analysisExplanation = '';
    if (deltaRevenue < 0) {
      if (todayCount < yestCount) {
        analysisExplanation = `Today's revenue is lower than yesterday by ₹${Math.abs(deltaRevenue).toFixed(2)} (${Math.abs(percentChange)}% decrease). The primary factor is customer footfall: ${todayCount} bills billed today compared to ${yestCount} yesterday.`;
      } else {
        analysisExplanation = `Today's revenue is lower by ₹${Math.abs(deltaRevenue).toFixed(2)} despite similar bill volume (${todayCount} vs ${yestCount}). The average bill ticket was ₹${todayAvg.toFixed(2)} today compared to ₹${yestAvg.toFixed(2)} yesterday, indicating fewer high-value prescription sales.`;
      }
    } else if (deltaRevenue > 0) {
      analysisExplanation = `Today's sales are higher by ₹${deltaRevenue.toFixed(2)} (+${percentChange}%) compared to yesterday (₹${todayRev.toFixed(2)} vs ₹${yestRev.toFixed(2)} across ${todayCount} invoices).`;
    } else {
      analysisExplanation = `Sales today are equal to yesterday at ₹${todayRev.toFixed(2)} across ${todayCount} invoices.`;
    }

    return {
      role,
      period: 'today_vs_yesterday',
      todayRevenue: todayRev,
      yesterdayRevenue: yestRev,
      deltaRevenue,
      percentChange,
      todayBillCount: todayCount,
      yesterdayBillCount: yestCount,
      todayAverageTicket: todayAvg,
      yesterdayAverageTicket: yestAvg,
      analysisExplanation,
      topSellersToday,
      topSellersYesterday
    };
  }

  /**
   * Provides practical operational guidance for application screens and workflows
   */
  public explainApplicationScreen(pageOrTopic: string): {
    title: string;
    guidance: string;
    shortcuts?: string[];
    tips?: string[];
  } {
    const lower = pageOrTopic.toLowerCase();

    if (lower.includes('purchase') || lower.includes('bill entry') || lower.includes('/purchases')) {
      return {
        title: 'Purchase Bill Entry Screen Guidance',
        guidance: 'The Purchase Entry screen allows recording new stock invoices from registered distributors. You select the distributor, enter the invoice number and date, and add line items with batch, expiry, quantity, PTR, and GST.',
        shortcuts: ['F3: Select Distributor', 'Ctrl+S: Save Draft', 'Tab: Move across fields', 'Enter: Add medicine row'],
        tips: [
          'Verify that the PTR and MRP match the physical paper invoice before final commit.',
          'Always check expiry dates to prevent registering expired or near-expiry batches.',
          'Consequential purchase finalization automatically updates inventory_master and stock_ledger.'
        ]
      };
    }

    if (lower.includes('pos') || lower.includes('billing') || lower.includes('/pos')) {
      return {
        title: 'POS Billing Screen Guidance',
        guidance: 'The Point of Sale (POS) screen is designed for fast barcode or search-assisted medicine dispensing to walk-in and registered patients.',
        shortcuts: ['F2: Focus Medicine Search', 'Ctrl+P: Print & Settle Bill', 'Alt+N: New Customer', 'Escape: Clear Search'],
        tips: [
          'Scan barcodes or type 3+ characters of the brand or salt name.',
          'Schedule H & H1 drugs trigger mandatory doctor name prompt for compliance.',
          'Check stock availability chips before finalizing the sale.'
        ]
      };
    }

    if (lower.includes('inventory') || lower.includes('stock') || lower.includes('/inventory')) {
      return {
        title: 'Inventory & Batch Management Guidance',
        guidance: 'The Inventory screen displays active batches, physical rack locations, expiry dates, and real-time quantities in stock.',
        shortcuts: ['Ctrl+F: Filter batches', 'Alt+E: Audit Near-Expiry'],
        tips: [
          'To correct stock quantities, perform a physical audit count and record a stock adjustment.',
          'Batches within 60 days of expiry are highlighted in amber; expired batches in red.'
        ]
      };
    }

    if (lower.includes('crm') || lower.includes('refill') || lower.includes('/crm')) {
      return {
        title: 'CRM & Patient Refills Guidance',
        guidance: 'The CRM screen manages chronic patient profiles, repeat refill schedules, follow-up call tasks, and inbound WhatsApp messages.',
        shortcuts: ['Alt+R: Open Refills Due', 'Alt+T: New Call Task'],
        tips: [
          'When a patient approves a refill on WhatsApp or chat, stage it as Ready to notify the POS counter.',
          'Never disclose confidential distributor purchase rates to patients.'
        ]
      };
    }

    if (lower.includes('dispatch') || lower.includes('delivery') || lower.includes('/dispatch')) {
      return {
        title: 'Dispatch & Delivery Operations Guidance',
        guidance: 'The Dispatch screen assigns packed orders to delivery personnel, prints dispatch challans, and tracks delivery status.',
        shortcuts: ['Alt+D: Assign Delivery Agent', 'Ctrl+P: Print Challan'],
        tips: ['Ensure customer address and phone digits are verified before dispatching.']
      };
    }

    return {
      title: 'Pharmacy Application Guidance',
      guidance: `AI-PHARMACY-V3 integrates POS billing, inventory batches, purchase invoices, distributor Live Cart, and CRM refills. You can ask for assistance on any screen by typing "Explain this page" or asking how to perform specific workflows.`,
      shortcuts: ['F2: POS Search', 'F3: Purchases', 'Ctrl+K: Assistant Command Palette'],
      tips: ['All consequential stock and billing adjustments require explicit operator confirmation (Rule 6).']
    };
  }

  /**
   * Guides staff on stock quantity corrections and stages an adjustment proposal
   */
  public async correctStockQuantity(options: {
    medicineName?: string;
    medicineId?: number;
    batchNo?: string;
    newQuantity?: number;
    reason?: string;
    dbInstance?: any;
  }): Promise<{ guidance: string; stagedProposal?: any }> {
    const guidance =
      `To correct stock quantities in AI-PHARMACY-V3:\n\n` +
      `1. Perform a physical shelf count of the medicine and note the batch number.\n` +
      `2. Navigate to *Inventory* or *POS*, find the medicine record, and select *Adjust Stock*.\n` +
      `3. Enter the audited quantity and state the reason (e.g. "Physical count discrepancy", "Damaged goods", "Return").\n` +
      `4. Confirm the adjustment to record an audit entry in the \`stock_ledger\`.\n\n` +
      `⚠️ *Accounting Rule:* Stock adjustments should never be made without physical verification.`;

    let stagedProposal: any = null;
    if (options.medicineId && options.batchNo && typeof options.newQuantity === 'number') {
      stagedProposal = {
        type: 'ADJUST_STOCK',
        summary: `Adjust stock for medicine #${options.medicineId} (Batch: ${options.batchNo}) to ${options.newQuantity} units`,
        data: {
          medicineId: options.medicineId,
          medicineName: options.medicineName,
          batchNo: options.batchNo,
          newQuantity: options.newQuantity,
          reason: options.reason || 'Physical count adjustment'
        }
      };
    }

    return { guidance, stagedProposal };
  }

  /**
   * Processes uploaded prescription or purchase invoice document images using OCR
   */
  public async processDocumentImage(options: {
    buffer?: Buffer;
    imagePath?: string;
    docType?: 'prescription' | 'invoice' | 'packaging';
    storeId?: number;
    dbInstance?: any;
  }): Promise<{
    docType: string;
    success: boolean;
    extractedItems: any[];
    headerInfo?: Record<string, any>;
    stagedDraft?: any;
    message: string;
  }> {
    const docType = options.docType || 'prescription';

    if (docType === 'invoice' && options.buffer) {
      try {
        const parsedInvoice = await invoiceVisionService.parseInvoiceImage(
          options.buffer,
          'image/jpeg',
          options.imagePath || 'invoice.jpg'
        );

        return {
          docType: 'invoice',
          success: Boolean(parsedInvoice.success),
          extractedItems: (parsedInvoice.items || []).map(item => ({
            name: item.name,
            matchedDbName: item.matched_db_name,
            batchNo: item.batch_no,
            expiryDate: item.expiry_date,
            quantity: item.quantity,
            freeQty: item.free_qty,
            costPrice: item.cost_price,
            mrp: item.mrp
          })),
          headerInfo: {
            distributor: parsedInvoice.distributor_name,
            invoiceNo: parsedInvoice.invoice_no,
            invoiceDate: parsedInvoice.invoice_date,
            totalAmount: parsedInvoice.total_amount
          },
          stagedDraft: {
            type: 'PURCHASE_ENTRY_DRAFT',
            distributor: parsedInvoice.distributor_name,
            invoiceNo: parsedInvoice.invoice_no,
            itemCount: parsedInvoice.items?.length || 0
          },
          message: `Successfully parsed invoice with ${parsedInvoice.items?.length || 0} line items from ${parsedInvoice.distributor_name || 'distributor'}. Staged for review.`
        };
      } catch (err: any) {
        return {
          docType: 'invoice',
          success: false,
          extractedItems: [],
          message: `Invoice OCR processing encountered an issue: ${err.message || err}`
        };
      }
    }

    // Prescription OCR workflow
    if (options.buffer) {
      try {
        const scanRes = await prescriptionOrchestratorService.scanPrescriptionImage({
          buffer: options.buffer,
          source: 'pos',
          storeId: options.storeId || 1
        });

        const items = (scanRes.items || []).map((i: any) => ({
          rawText: i.rawText,
          brandHint: i.brandHint,
          dosageForm: i.dosageForm,
          strength: i.strength,
          prescribedQty: i.prescribedQuantity,
          topMatch: i.matches?.[0]?.name,
          matchScore: i.topScore,
          availability: i.availability,
          inventoryQty: i.inventoryQty
        }));

        return {
          docType: 'prescription',
          success: true,
          extractedItems: items,
          headerInfo: {
            doctorName: scanRes.doctorName,
            clinicName: scanRes.clinicName,
            patientName: scanRes.patientName,
            isPrescription: scanRes.isPrescription
          },
          stagedDraft: {
            type: 'PRESCRIPTION_WORKFLOW_DRAFT',
            scanId: scanRes.scanId,
            itemCount: items.length
          },
          message: `Prescription OCR identified ${items.length} prescribed medicines. Staged for pharmacist verification.`
        };
      } catch (err: any) {
        return {
          docType: 'prescription',
          success: false,
          extractedItems: [],
          message: `Prescription OCR processing error: ${err.message || err}`
        };
      }
    }

    return {
      docType,
      success: false,
      extractedItems: [],
      message: 'No image buffer or document payload provided.'
    };
  }

  /**
   * Confirms a refill request and stages it for dispensing (Rule 6 verified execution)
   */
  public async confirmRefillExecution(
    refillId: number,
    phone: string,
    options: {
      qty?: number;
      actorName?: string;
      channel?: string;
      dbInstance?: any;
    } = {}
  ): Promise<{ success: boolean; message: string; refill?: RefillRecordItem }> {
    const db = options.dbInstance || (await dbManager.getConnection());
    const raw = String(phone || '').replace(/\D/g, '');
    const cleanPhone = raw.length >= 10 ? raw.slice(-10) : raw;

    // Verify refill exists and belongs to this phone number
    const refill = await db.get(
      `SELECT pr.*, m.name as catalog_med, m.sell_price, m.total_stock
       FROM patient_refills pr
       LEFT JOIN medicines m ON pr.medicine_id = m.id
       WHERE pr.id = ? AND (pr.patient_phone LIKE ? OR pr.patient_phone = ?) LIMIT 1`,
      [refillId, `%${cleanPhone}`, cleanPhone]
    ).catch(() => null);

    if (!refill) {
      return {
        success: false,
        message: `Refill #${refillId} could not be verified for phone number ${cleanPhone}.`
      };
    }

    const medName = refill.medicine_name || refill.catalog_med || 'Medicine';
    const quantity = options.qty || refill.quantity_needed || 1;

    // Try canonical live cart insertion if supported, else mark ready for pharmacy dispensing
    let cartMsg = '';
    try {
      const { processRefillCartItem } = await import('../refillCartService.js');
      const cartResult = await processRefillCartItem(refillId, { qty: quantity, dryRun: false });
      if (cartResult.status === 'added' || cartResult.status === 'in_cart') {
        cartMsg = ` (Live Cart updated: ${cartResult.message})`;
      }
    } catch (_) {}

    await db.run(
      `UPDATE patient_refills
       SET is_ready = 1, status = 'ready', patient_confirmed = 1
       WHERE id = ?`,
      [refillId]
    );

    await logMutationAudit({
      storeId: 1,
      userId: undefined,
      username: options.actorName || 'customer_assistant',
      action: 'CONFIRM_REFILL',
      entity: 'patient_refills',
      entityId: refillId,
      description: `Customer confirmed Refill #${refillId} (${medName}, Qty: ${quantity}) via ${options.channel || 'chat'}${cartMsg}`
    });

    eventService.broadcast('refill_updated', { refillId, is_ready: 1, patient_confirmed: 1 });

    return {
      success: true,
      message: `Your refill for ${medName} (Qty: ${quantity}) has been confirmed and is now staged for dispensing!${cartMsg}`,
      refill: {
        id: refill.id,
        medicineName: medName,
        quantityNeeded: quantity,
        nextRefillDate: refill.next_refill_date ? String(refill.next_refill_date).slice(0, 10) : null,
        status: 'ready',
        isReady: true,
        inStock: Number(refill.total_stock || 0) >= quantity,
        totalStock: Number(refill.total_stock || 0),
        pricePerUnit: Number(refill.sell_price || 0)
      }
    };
  }

  /**
   * Records a customer enquiry for an unstocked or requested medicine
   */
  public async createCustomerEnquiry(
    patientName: string,
    patientPhone: string,
    medicineName: string,
    notes?: string,
    dbInstance?: any
  ): Promise<{ success: boolean; enquiryId: number; message: string }> {
    const db = dbInstance || (await dbManager.getConnection());

    const result = await db.run(
      `INSERT INTO medicine_enquiries
         (patient_name, patient_phone, medicine_name, source, notes, status)
       VALUES (?, ?, ?, 'whatsapp', ?, 'open')`,
      [patientName || 'Customer', patientPhone || null, medicineName.trim(), notes || null]
    );

    const enquiryId = Number(result.lastID);

    await logMutationAudit({
      storeId: 1,
      userId: undefined,
      username: 'conversational_agent',
      action: 'CREATE_ENQUIRY',
      entity: 'medicine_enquiries',
      entityId: enquiryId,
      description: `AI recorded medicine enquiry #${enquiryId} for ${patientName} (${medicineName})`
    });

    return {
      success: true,
      enquiryId,
      message: `Enquiry #${enquiryId} for "${medicineName}" has been recorded. Our pharmacy team will check distributor availability.`
    };
  }

  /**
   * Schedules a follow-up callback or reminder task for pharmacy staff
   */
  public async scheduleCallTask(
    patientName: string,
    patientPhone: string,
    details: string,
    priority: 'normal' | 'high' = 'normal',
    dueDateOrDb?: string | any,
    dbInstance?: any
  ): Promise<{ success: boolean; taskId: number; message: string }> {
    let dueDate: string | undefined;
    let db: any;
    if (dueDateOrDb && typeof dueDateOrDb === 'object') {
      db = dueDateOrDb;
    } else if (typeof dueDateOrDb === 'string') {
      dueDate = dueDateOrDb;
      db = dbInstance;
    } else {
      db = dbInstance;
    }
    if (!db) db = await dbManager.getConnection();

    const result = await db.run(
      `INSERT INTO patient_call_tasks
         (task_type, patient_name, patient_phone, details_json, priority, due_date, status)
       VALUES ('callback', ?, ?, ?, ?, ?, 'pending')`,
      [patientName || 'Customer', patientPhone, JSON.stringify({ details }), priority, dueDate || null]
    );

    const taskId = Number(result.lastID);

    await logMutationAudit({
      storeId: 1,
      userId: undefined,
      username: 'conversational_agent',
      action: 'SCHEDULE_TASK',
      entity: 'patient_call_tasks',
      entityId: taskId,
      description: `AI scheduled callback task #${taskId} for ${patientName} (${patientPhone}): ${details}`
    });

    eventService.broadcast('call_tasks_updated', { taskId, taskType: 'callback' });

    return {
      success: true,
      taskId,
      message: `A staff reminder task #${taskId} has been scheduled for ${patientName}.`
    };
  }

  /**
   * Switches chat session to manual mode for licensed pharmacist takeover
   */
  public async escalateToPharmacist(
    phone: string,
    reason: string,
    dbInstance?: any
  ): Promise<{ success: boolean; message: string }> {
    const db = dbInstance || (await dbManager.getConnection());
    const raw = String(phone || '').replace(/\D/g, '');
    const cleanPhone = raw.length >= 10 ? raw.slice(-10) : raw;
    const chatId = `${cleanPhone}@c.us`;

    const twoHoursFromNow = Date.now() + (2 * 60 * 60 * 1000);
    await db.run(
      `UPDATE whatsapp_chats
       SET session_mode = 'manual', manual_active_until = ?, session_status = 'active'
       WHERE id = ? OR (resolved_number IS NOT NULL AND resolved_number LIKE ?)`,
      [twoHoursFromNow, chatId, `%${cleanPhone}%`]
    ).catch(() => {});

    // Create high-priority call task so staff sees the alert in CRM
    await this.scheduleCallTask(
      'Pharmacist Handover Requested',
      cleanPhone,
      `Handover reason: ${reason}`,
      'high',
      undefined,
      db
    ).catch(() => {});

    eventService.broadcast('wa_session_updated', {
      chat_id: chatId,
      session_mode: 'manual',
      reason
    });

    return {
      success: true,
      message: 'I have alerted our registered on-duty pharmacist to assist you directly. A team member will respond shortly.'
    };
  }
}

export const pharmacyToolRegistry = new PharmacyToolRegistry();
