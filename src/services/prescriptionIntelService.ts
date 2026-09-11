import fs from 'fs';
import path from 'path';
import { dbManager } from '../database/connection.js';
import { prescriptionScannerService } from './prescriptionScannerService.js';
import { performPharmarackSearch } from '../routes/pharmarack.js';
import { sendMessage } from '../whatsappClient.js';
import { eventService } from './eventService.js';

export interface PrescriptionOrderBriefingInput {
  orderId: number;
  customerName: string;
  customerPhone: string;
  imagePaths: string[];
  manualMedicineName?: string;
  targetStoreId?: number;
  host?: string;
  protocol?: string;
  savedUrls?: string[];
}

export interface ExtractedMedicineReport {
  name: string;
  dosageForm?: string;
  strength?: string;
  localStock: number | null;
  localMrp: number | null;
  pharmarackDistributor?: string;
  pharmarackPtr?: number | null;
  pharmarackMrp?: number | null;
  pharmarackStock?: string;
  pharmarackScheme?: string;
}

/**
 * Resolve the primary pharmacy WhatsApp number (prefers owner_whatsapp_number, then shop_phone)
 */
export async function getPharmacyAdminPhone(db: any): Promise<string> {
  const row = await db.get(
    `SELECT value FROM app_settings 
     WHERE key IN ('owner_whatsapp_number', 'admin_whatsapp', 'admin_whatsapp_number', 'shop_phone', 'store_phone', 'pharmacy_phone', 'phone')
       AND value IS NOT NULL AND TRIM(value) != ''
     ORDER BY CASE key
       WHEN 'owner_whatsapp_number' THEN 1
       WHEN 'admin_whatsapp' THEN 2
       WHEN 'admin_whatsapp_number' THEN 3
       WHEN 'shop_phone' THEN 4
       WHEN 'store_phone' THEN 5
       ELSE 6
     END
     LIMIT 1`
  );

  if (row?.value) {
    let clean = row.value.replace(/\D/g, '');
    if (clean.length === 11 && clean.startsWith('0')) clean = clean.slice(1);
    return clean.length === 10 ? `91${clean}` : clean;
  }
  return '';
}

/**
 * Find local in-store inventory stock & MRP for a prescribed medicine
 */
async function findLocalStock(db: any, medName: string): Promise<{ name: string; stock: number; mrp: number | null } | null> {
  const clean = medName.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
  const tokens = clean.split(/\s+/).filter(t => t.length >= 3);
  if (tokens.length === 0) return null;

  const firstWord = tokens[0];
  const rows = await db.all(
    `SELECT m.id, m.name, m.mrp, COALESCE(SUM(inv.quantity), 0) as stock
     FROM medicines m
     LEFT JOIN inventory inv ON inv.medicine_id = m.id
     WHERE m.name LIKE ? OR m.name LIKE ?
     GROUP BY m.id
     ORDER BY stock DESC, m.name ASC
     LIMIT 3`,
    [`${firstWord}%`, `%${tokens.slice(0, 2).join('%')}%`]
  ).catch(() => []);

  if (rows && rows.length > 0) {
    return {
      name: rows[0].name,
      stock: Number(rows[0].stock || 0),
      mrp: rows[0].mrp !== undefined && rows[0].mrp !== null ? Number(rows[0].mrp) : null
    };
  }
  return null;
}

/**
 * Cross-check live Pharmarack OpenSearch or cached distributor catalog for medicine availability & PTR
 */
async function findPharmarackDistributor(medName: string): Promise<{
  productName: string;
  distributor: string;
  ptr: number | null;
  mrp: number | null;
  stock: string;
  scheme: string;
} | null> {
  try {
    const cleanQuery = medName.replace(/\b(tab|tabs|tablet|tablets|cap|caps|capsule|syp|syrup|inj|injection)\b/gi, '').trim();
    const queryTerm = cleanQuery.length >= 3 ? cleanQuery : medName;

    const searchRes = await performPharmarackSearch(queryTerm, null, true);
    if (searchRes.status === 'ok' && searchRes.items && searchRes.items.length > 0) {
      const top = searchRes.items[0];
      return {
        productName: top.name || top.fullName || medName,
        distributor: top.distributor || 'Mapped Distributor',
        ptr: top.rate !== undefined && top.rate !== null ? Number(top.rate) : null,
        mrp: top.mrp !== undefined && top.mrp !== null ? Number(top.mrp) : null,
        stock: top.stock ? String(top.stock) : 'Available',
        scheme: top.scheme ? String(top.scheme) : ''
      };
    }
  } catch (err: any) {
    console.warn(`[PrescriptionIntel] Pharmarack search error for "${medName}":`, err.message || err);
  }
  return null;
}

/**
 * Asynchronous background worker:
 * 1. Runs OCR / AI vision on prescription photo.
 * 2. Cross-checks local inventory + live Pharmarack distributor catalog.
 * 3. Builds a structured intelligence briefing and sends directly to Pharmacy WhatsApp.
 * 4. Updates order notes & tracking history in SQLite.
 */
export async function processPrescriptionAndNotifyPharmacy(input: PrescriptionOrderBriefingInput): Promise<void> {
  const { orderId, customerName, customerPhone, imagePaths, manualMedicineName, host, protocol, savedUrls } = input;

  try {
    const db = await dbManager.getConnection();
    const primaryImagePath = imagePaths && imagePaths.length > 0 ? imagePaths[0] : null;

    let doctorName: string | undefined;
    let clinicName: string | undefined;
    let rawItems: Array<{ brandName: string; dosageForm?: string; strength?: string }> = [];

    // Step 1: Extract medicines via PrescriptionScannerService (Local Tesseract + Gemini fallback)
    if (primaryImagePath && fs.existsSync(primaryImagePath)) {
      try {
        console.log(`[PrescriptionIntel] Scanning prescription photo for Order #${orderId}...`);
        const scanResult = await prescriptionScannerService.scanPrescription(primaryImagePath);
        doctorName = scanResult.doctorName;
        clinicName = scanResult.clinicName;

        if (scanResult.items && scanResult.items.length > 0) {
          rawItems = scanResult.items.map(it => ({
            brandName: it.brandName,
            dosageForm: it.dosageForm,
            strength: it.strength
          }));
        }
      } catch (scanErr: any) {
        console.warn(`[PrescriptionIntel] OCR extraction note for Order #${orderId}:`, scanErr.message || scanErr);
      }
    }

    // Include manually typed medicine if provided and not already captured
    if (manualMedicineName && manualMedicineName.trim() && manualMedicineName !== 'Prescription / Medicine Inquiry') {
      const trimmed = manualMedicineName.trim();
      if (!rawItems.some(i => i.brandName.toLowerCase() === trimmed.toLowerCase())) {
        rawItems.unshift({ brandName: trimmed });
      }
    }

    // Step 2: Cross-check each medicine against Local Stock and Pharmarack
    const reportList: ExtractedMedicineReport[] = [];
    const searchPromises = rawItems.slice(0, 10).map(async (item) => {
      const [local, pharmarack] = await Promise.all([
        findLocalStock(db, item.brandName),
        findPharmarackDistributor(item.brandName)
      ]);

      return {
        name: item.brandName,
        dosageForm: item.dosageForm,
        strength: item.strength,
        localStock: local ? local.stock : 0,
        localMrp: local ? local.mrp : null,
        pharmarackDistributor: pharmarack ? pharmarack.distributor : undefined,
        pharmarackPtr: pharmarack ? pharmarack.ptr : null,
        pharmarackMrp: pharmarack ? pharmarack.mrp : null,
        pharmarackStock: pharmarack ? pharmarack.stock : undefined,
        pharmarackScheme: pharmarack ? pharmarack.scheme : undefined
      };
    });

    const settledReports = await Promise.all(searchPromises);
    reportList.push(...settledReports);

    // Step 3: Format the Structured WhatsApp Briefing
    const serverHost = host || 'localhost:5175';
    const serverProtocol = protocol || 'http';
    const photoUrl = (savedUrls && savedUrls.length > 0)
      ? `${serverProtocol}://${serverHost}${savedUrls[0]}`
      : undefined;

    let briefingText = `🔔 *NEW WEB PRESCRIPTION RECEIVED*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 *Order Ref:* #${orderId}\n` +
      `👤 *Customer:* ${customerName}\n` +
      `📱 *Mobile:* ${customerPhone}\n`;

    if (doctorName || clinicName) {
      briefingText += `🏥 *Doctor / Clinic:* ${[doctorName, clinicName].filter(Boolean).join(' • ')}\n`;
    }

    if (photoUrl) {
      briefingText += `📷 *Prescription Photo:* ${photoUrl}\n`;
    }

    briefingText += `\n🔍 *MEDICINES & PHARMARACK INTEL:*\n`;

    if (reportList.length > 0) {
      reportList.forEach((rep, idx) => {
        const itemNumber = idx + 1;
        const details: string[] = [];
        if (rep.dosageForm && rep.dosageForm !== 'OTHER') details.push(rep.dosageForm);
        if (rep.strength) details.push(rep.strength);
        const subHeader = details.length > 0 ? ` (${details.join(', ')})` : '';

        briefingText += `\n*${itemNumber}. ${rep.name.toUpperCase()}*${subHeader}\n`;

        // Local stock report
        if (rep.localStock !== null && rep.localStock > 0) {
          briefingText += `   • *In Store:* ${rep.localStock} units (MRP: ₹${rep.localMrp?.toFixed(2) || 'N/A'})\n`;
        } else {
          briefingText += `   • *In Store:* ⚠️ OUT OF STOCK (0 units)\n`;
        }

        // Pharmarack report
        if (rep.pharmarackDistributor) {
          let prLine = `   • *Pharmarack:* ${rep.pharmarackDistributor}`;
          if (rep.pharmarackPtr) prLine += ` | PTR: ₹${rep.pharmarackPtr.toFixed(2)}`;
          if (rep.pharmarackScheme) prLine += ` | Scheme: ${rep.pharmarackScheme}`;
          if (rep.pharmarackStock) prLine += ` | Stock: ${rep.pharmarackStock}`;
          briefingText += `${prLine}\n`;
        } else {
          briefingText += `   • *Pharmarack:* Not matched with active distributor\n`;
        }
      });
    } else {
      briefingText += `1 photo attached. No automatic medicine text detected — please review prescription image directly.\n`;
    }

    briefingText += `\n━━━━━━━━━━━━━━━━━━━━━\n` +
      `👉 *Action:* Open AI Pharmacy POS or Website Orders to fulfill!`;

    // Step 4: Resolve Target Pharmacy WhatsApp & Dispatch
    const pharmacyPhone = await getPharmacyAdminPhone(db);
    if (pharmacyPhone) {
      console.log(`[PrescriptionIntel] Dispatching briefing for Order #${orderId} to Pharmacy WhatsApp: ${pharmacyPhone}`);
      try {
        // Send with prescription image attached if available on disk
        if (primaryImagePath && fs.existsSync(primaryImagePath)) {
          await sendMessage(pharmacyPhone, primaryImagePath, briefingText);
        } else {
          await sendMessage(pharmacyPhone, undefined, briefingText);
        }
      } catch (sendErr: any) {
        console.warn(`[PrescriptionIntel] Failed to send briefing via media; attempting text fallback:`, sendErr.message);
        await sendMessage(pharmacyPhone, undefined, briefingText).catch(e => {
          console.error(`[PrescriptionIntel] Text send fallback failed:`, e.message);
        });
      }
    } else {
      console.warn(`[PrescriptionIntel] No pharmacy WhatsApp number configured in app_settings (owner_whatsapp_number / shop_phone).`);
    }

    // Step 5: Update Order Notes & Tracking Events in Database
    const intelSummary = reportList.map(r => {
      const stockStr = (r.localStock && r.localStock > 0) ? `Store: ${r.localStock}` : 'Store: 0 (OOS)';
      const prStr = r.pharmarackDistributor ? `PR: ${r.pharmarackDistributor} (₹${r.pharmarackPtr?.toFixed(2) || '?'})` : '';
      return `${r.name} [${[stockStr, prStr].filter(Boolean).join(' | ')}]`;
    }).join('; ');

    if (intelSummary) {
      await db.run(
        `UPDATE special_orders 
         SET notes = CASE 
           WHEN notes IS NULL OR notes = '' THEN ? 
           ELSE notes || ' | ' || ? 
         END,
         updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [`[AI Rx Intel: ${intelSummary}]`, `[AI Rx Intel: ${intelSummary}]`, orderId]
      ).catch(() => {});
    }

    await db.run(
      `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
       VALUES (?, 'prescription_analyzed', ?, 'system', CURRENT_TIMESTAMP)`,
      [orderId, `AI extracted ${reportList.length} medicines. Stock & Pharmarack briefing sent to pharmacy WhatsApp.`]
    ).catch(() => {});

    // Broadcast update so POS and Website Orders UI reflects new status
    eventService.broadcast('order_updated', { order_id: orderId, source: 'ai_rx_scanner' });

  } catch (err: any) {
    console.error(`[PrescriptionIntel] Error processing prescription for Order #${orderId}:`, err);
  }
}
