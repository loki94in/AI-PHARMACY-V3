import path from 'path';
import { parse } from 'csv-parse/sync';
import { isValidDistributorName } from '../utils/nameNormalizer.js';

export function getJaccardSimilarity(arr1: string[], arr2: string[]): number {
  const set1 = new Set(arr1.map(s => s.toLowerCase().trim()));
  const set2 = new Set(arr2.map(s => s.toLowerCase().trim()));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

export function normalizeMapping(map: Record<string, string> | null | undefined): Record<string, string> {
  if (!map) return {};
  const normalized: Record<string, string> = {};

  const canonicalSet = new Set([
    'distributor_name', 'invoice_no', 'invoice_date', 'global_cd_per', 'total_amount',
    'name', 'quantity', 'rate', 'mrp', 'batch_no', 'expiry_date', 'cgst', 'sgst',
    'free_qty', 'cd_per', 'cd_rs'
  ]);

  let keysAreCanonical = 0;
  let valuesAreCanonical = 0;

  for (const [k, v] of Object.entries(map)) {
    if (k && canonicalSet.has(k)) keysAreCanonical++;
    if (v && canonicalSet.has(v)) valuesAreCanonical++;
  }

  if (valuesAreCanonical > keysAreCanonical) {
    // Format is { rawHeader: canonicalName }, so invert it to { canonicalName: rawHeader }
    for (const [k, v] of Object.entries(map)) {
      if (v && k) {
        normalized[v] = k;
      }
    }
  } else {
    // Format is already { canonicalName: rawHeader }
    for (const [k, v] of Object.entries(map)) {
      if (k && v) {
        normalized[k] = v;
      }
    }
  }

  return normalized;
}

export async function getSuggestedMappingFromHeaders(headers: string[], db: any): Promise<Record<string, string>> {
  const suggested: Record<string, string> = {};
  const headerKey = headers.slice().sort().join(',');

  try {
    const matched = await db.get('SELECT mapping_json FROM catalog_mappings WHERE file_headers = ?', headerKey);
    if (matched && matched.mapping_json) {
      return JSON.parse(matched.mapping_json);
    }
  } catch (err) {
    console.warn('Smart learning mapping load failed:', err);
  }

  // Helper to normalize header for comparison
  const normalize = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

  const rules: Array<{
    field: string;
    priority1: RegExp;
    priority2?: RegExp;
  }> = [
      {
        field: 'distributor_name',
        priority1: /^(distributor|supplier|vendor|party|partyname)$/i,
        priority2: /distributor|supplier|vendor|party/i
      },
      {
        field: 'invoice_date',
        priority1: /^(invoicedate|billdate|date|invdate|trdate)$/i,
        priority2: /date|dt/i
      },
      {
        field: 'invoice_no',
        priority1: /^(invoiceno|billno|invno|vouno)$/i,
        priority2: /invno|invoiceno|billno|vou/i
      },
      {
        field: 'total_amount',
        priority1: /^(totalamount|invamt|netamt|grandtotal|total|inetamt)$/i,
        priority2: /total|amt|amount/i
      },
      {
        field: 'name',
        priority1: /^(itemname|productname|medicinename|prodname|pitemname|productdesc|itemdesc|description|name)$/i,
        priority2: /name|brand|product|item|desc/i
      },
      {
        field: 'api_reference',
        priority1: /^(api|composition|generic|salt|formula|active|molecule)$/i,
        priority2: /api|composition|generic|salt/i
      },
      {
        field: 'strength',
        priority1: /^(strength|dosage|potency)$/i,
        priority2: /strength|dosage|potency|mg|ml/i
      },
      {
        field: 'packaging',
        priority1: /^(pack|packaging|dosageform|type|unit)$/i,
        priority2: /pack|pkg|packaging/i
      },
      {
        field: 'manufacturer',
        priority1: /^(mfg|manufacturer|applicant|company|maker)$/i,
        priority2: /mfg|manufactur|company/i
      },
      {
        field: 'marketed_by',
        priority1: /^(mkt|marketedby|market)$/i,
        priority2: /mkt|market/i
      },
      {
        field: 'hsn_code',
        priority1: /^(hsn|hsncode)$/i,
        priority2: /hsn/i
      },
      {
        field: 'schedule_type',
        priority1: /^(schedule|scheduletype)$/i,
        priority2: /schedule/i
      },
      {
        field: 'mrp',
        priority1: /^(mrp|maxretailprice|retailprice|srp)$/i,
        priority2: /mrp|retail.*price|max.*price/i
      },
      {
        field: 'rate',
        priority1: /^(rate|ptr|cost|price|unitrate|purrate|purchaserate|prate|unitprice|basicrate|netrate|drate|dealerrate|tradeprice|buyprice|ftrate|srate|costprice)$/i,
        priority2: /rate|price|ptr|cost|pur.*rate|unit.*price/i
      },
      {
        field: 'cgst',
        priority1: /^(cgstper|cgstrate|cgst)$/i,
        priority2: /cgst/i
      },
      {
        field: 'sgst',
        priority1: /^(sgstper|sgstrate|sgst)$/i,
        priority2: /sgst/i
      },
      {
        field: 'rack',
        priority1: /^(rack|shelf|location)$/i,
        priority2: /rack|shelf|location/i
      },
      {
        field: 'quantity',
        priority1: /^(qty|quantity|quantitybld|bldqty|billedqty|billqty|units|nos|pack)$/i,
        priority2: /qty|quantity/i
      },
      {
        field: 'batch_no',
        priority1: /^(batch|batchno|lot|lotno|batchnum|batchid)$/i,
        priority2: /batch|lot/i
      },
      {
        field: 'expiry_date',
        priority1: /^(expiry|expdate|expirydate|expdt|valupto|validupto|validity|exp)$/i,
        priority2: /exp|expiry|valid/i
      },
      {
        field: 'free_qty',
        priority1: /^(free|freeqty|fqty)$/i,
        priority2: /free/i
      },
      {
        field: 'cd_per',
        priority1: /^(cdper|discper|discountper|discount)$/i,
        priority2: /disc|discount/i
      },
      {
        field: 'cd_rs',
        priority1: /^(cdamt|cdval|discamt|cdrs)$/i,
        priority2: /disc.*amt|cd.*amt|disc.*val|cd.*val/i
      },
      {
        field: 'cn_amount',
        priority1: /^(cnamount|cnamt|creditnoteamount|creditnoteamt|creditnoteval|extra_credit)$/i,
        priority2: /cn.*amt|cn.*amount|credit.*note.*amount|credit.*note.*amt/i
      },
      {
        field: 'cn_number',
        priority1: /^(cnno|cnnumber|creditnoteno|creditnotenumber)$/i,
        priority2: /cn.*no|cn.*num|credit.*note.*no|credit.*note.*num/i
      }
    ];

  // Keep track of which headers are already mapped to prevent double mapping of same header to multiple fields
  const mappedHeaders = new Set<string>();

  // Helper to check negative patterns (e.g. to exclude 'lrdate' from invoice_date or 'fqty' from qty)
  const isExcluded = (field: string, norm: string): boolean => {
    if (field === 'invoice_date') {
      return /exp|expiry|due|lr|deliv/i.test(norm);
    }
    if (field === 'invoice_no') {
      return /date/i.test(norm);
    }
    if (field === 'total_amount') {
      return /tax|disc|discount|qty|free|rate|per|prcode|barcode/i.test(norm);
    }
    if (field === 'quantity') {
      return /free|sch|adj|amt/i.test(norm);
    }
    if (field === 'rate') {
      return /mrp|free|sch|cgst|sgst|disc|discount|tax|qty|quantity|amount|total|value|hsn|batch|exp/i.test(norm);
    }
    if (field === 'cgst' || field === 'sgst') {
      return /amt|val|tax/i.test(norm);
    }
    if (field === 'expiry_date') {
      return /export|expense/i.test(norm);
    }
    if (field === 'cd_per') {
      return /amt|val|rs|net/i.test(norm);
    }
    if (field === 'cn_amount') {
      return /rate|mrp|tax|qty|free|disc|discount/i.test(norm);
    }
    if (field === 'cn_number') {
      return /date|amt|amount|val|value/i.test(norm);
    }
    return false;
  };

  // Phase 1: Try priority 1 (exact/strict matches) for all fields
  for (const rule of rules) {
    for (const h of headers) {
      if (mappedHeaders.has(h)) continue;
      const norm = normalize(h);
      if (isExcluded(rule.field, norm)) continue;

      if (rule.priority1.test(norm)) {
        suggested[h] = rule.field;
        mappedHeaders.add(h);
        break; // Match found, proceed to next field rule
      }
    }
  }

  // Phase 2: Try priority 2 (broader/substring matches) for remaining unmapped fields
  for (const rule of rules) {
    // Check if this field is already mapped
    const isAlreadyMapped = Object.values(suggested).includes(rule.field);
    if (isAlreadyMapped) continue;

    if (rule.priority2) {
      for (const h of headers) {
        if (mappedHeaders.has(h)) continue;
        const norm = normalize(h);
        if (isExcluded(rule.field, norm)) continue;

        if (rule.priority2.test(norm)) {
          suggested[h] = rule.field;
          mappedHeaders.add(h);
          break; // Match found, proceed to next field rule
        }
      }
    }
  }

  // Initialize unmapped fields with empty string
  for (const h of headers) {
    if (!suggested[h]) {
      suggested[h] = '';
    }
  }

  return suggested;
}

interface EmailOptions {
  user: string;
  password: string;
  host: string;
  port: number;
  tls: boolean;
  authTimeout?: number;
}

/* interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
} */

interface ProcessedEmail {
  from: string;
  subject: string;
  body: string;
  date?: Date;
  attachments: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

// High-priority final net payable / grand total pattern:
const NET_BILL_AMOUNT_PATTERN = /(?:(?:net\s*(?:amt|amount|payable|value)|grand\s*total|final\s*(?:bill|amount)|bill\s*amount|inv(?:oice)?\s*amount)\s*[:\-\s]*\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?))/i;

// Shared billing-amount pattern fallback: generic total / currency-prefixed numbers.
const BILL_AMOUNT_PATTERN = /(?:(?:grand\s*total|net\s*(?:amt|amount|payable|value)|bill\s*amount|inv(?:oice)?\s*amount|total\s*amount)\s*[:\-\s]*\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)|(?:total|amount|amt)\s*[:\-\s]*(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)|(?:total|amount|amt)\s*[:\-\s]*\s*(?!items|qty|quantity|units|pcs|medicines|rows)([\d,]+(?:\.\d{1,2})?)|(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?))/i;

export function extractBillAmount(text: string): string {
  // First, check explicit final net payable / grand total amount
  const netMatch = (text || '').match(NET_BILL_AMOUNT_PATTERN);
  if (netMatch && netMatch[1]) {
    const rawNum = netMatch[1].replace(/,/g, '').trim();
    const parsed = parseFloat(rawNum);
    if (!isNaN(parsed) && parsed > 0) {
      return `₹${parsed.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  }

  // Fallback: general pattern
  const amtMatch = (text || '').match(BILL_AMOUNT_PATTERN);
  if (!amtMatch) return '';
  const rawNum = (amtMatch[1] || amtMatch[2] || amtMatch[3] || amtMatch[4] || '').replace(/,/g, '').trim();
  const parsed = parseFloat(rawNum);
  if (isNaN(parsed) || parsed <= 0) return '';
  return `₹${parsed.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatExpiryDate(expVal: any): string {
  if (!expVal) return '';
  // If Excel parsed it as a number (serial date 30000 - 65000)
  if (typeof expVal === 'number' && expVal > 30000 && expVal < 65000) {
    const d = new Date(Math.round((expVal - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) {
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const yy = String(d.getUTCFullYear()).slice(-2);
      return `${mm}/${yy}`;
    }
  }

  const clean = String(expVal).trim();
  if (!clean || clean === '00000000' || clean === '00/00' || clean === '00/0000' || clean === '*' || clean === '***' || clean === '//*' || clean === '-') {
    return '';
  }

  // 1. ISO format: YYYY-MM-DD or YYYY-MM or YYYY/MM/DD or YYYY/MM
  const isoMatch = clean.match(/^(\d{4})[\/\-](\d{1,2})(?:[\/\-](\d{1,2}))?/);
  if (isoMatch) {
    const yy = isoMatch[1].slice(-2);
    const m = parseInt(isoMatch[2], 10);
    if (m >= 1 && m <= 12) {
      return `${String(m).padStart(2, '0')}/${yy}`;
    }
  }

  // 2. Format with month names, e.g. Dec-26, Dec-2026, 31-Dec-2026, Dec/26, Dec 2026
  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };
  const monthNameMatch = clean.match(/(?:(\d{1,2})[\/\-\s]+)?([a-z]{3,9})[\/\-\s]+(\d{2,4})/i);
  if (monthNameMatch) {
    const monthPrefix = monthNameMatch[2].substring(0, 3).toLowerCase();
    const mm = monthMap[monthPrefix];
    let yy = monthNameMatch[3];
    if (mm) {
      if (yy.length === 4) yy = yy.slice(-2);
      return `${mm}/${yy}`;
    }
  }

  // 3. 3-segment dates: DD/MM/YYYY or DD-MM-YYYY or DD/MM/YY or DD-MM-YY
  const threePartMatch = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (threePartMatch) {
    const p1 = parseInt(threePartMatch[1], 10);
    const p2 = parseInt(threePartMatch[2], 10);
    let yy = threePartMatch[3];
    if (yy.length === 4) yy = yy.slice(-2);

    let mm = '';
    if (p1 > 12 && p2 >= 1 && p2 <= 12) {
      mm = String(p2).padStart(2, '0');
    } else if (p2 > 12 && p1 >= 1 && p1 <= 12) {
      mm = String(p1).padStart(2, '0');
    } else if (p2 >= 1 && p2 <= 12) {
      mm = String(p2).padStart(2, '0');
    } else if (p1 >= 1 && p1 <= 12) {
      mm = String(p1).padStart(2, '0');
    }
    if (mm && yy) {
      return `${mm}/${yy}`;
    }
  }

  // 4. 2-segment dates: MM/YYYY or MM-YYYY or MM/YY or MM-YY
  const twoPartMatch = clean.match(/^(\d{1,2})[\/\-](\d{2,4})$/);
  if (twoPartMatch) {
    const mm = parseInt(twoPartMatch[1], 10);
    let yy = twoPartMatch[2];
    if (yy.length === 4) yy = yy.slice(-2);
    if (mm >= 1 && mm <= 12) {
      return `${String(mm).padStart(2, '0')}/${yy}`;
    }
  }

  // 5. Raw 8 digits (DDMMYYYY or YYYYMMDD)
  if (/^\d{8}$/.test(clean)) {
    if (clean.startsWith('20')) {
      const yy = clean.substring(2, 4);
      const mm = clean.substring(4, 6);
      const m = parseInt(mm, 10);
      if (m >= 1 && m <= 12) return `${mm}/${yy}`;
    }
    const mm = clean.substring(2, 4);
    const yy = clean.substring(6, 8);
    const m = parseInt(mm, 10);
    if (m >= 1 && m <= 12) return `${mm}/${yy}`;
  }

  // 6. Raw 6 digits (MMYYYY or DDMMYY)
  if (/^\d{6}$/.test(clean)) {
    if (clean.endsWith('2025') || clean.endsWith('2026') || clean.endsWith('2027') || clean.endsWith('2028') || clean.endsWith('2029') || clean.endsWith('2030') || clean.endsWith('2031') || clean.endsWith('2032')) {
      const mm = clean.substring(0, 2);
      const yy = clean.substring(4, 6);
      const m = parseInt(mm, 10);
      if (m >= 1 && m <= 12) return `${mm}/${yy}`;
    }
    const mm = clean.substring(0, 2);
    const yy = clean.substring(4, 6);
    const m = parseInt(mm, 10);
    if (m >= 1 && m <= 12) return `${mm}/${yy}`;
  }

  // 7. Raw 4 digits (MMYY)
  if (/^\d{4}$/.test(clean)) {
    const mm = clean.substring(0, 2);
    const yy = clean.substring(2, 4);
    const m = parseInt(mm, 10);
    if (m >= 1 && m <= 12) return `${mm}/${yy}`;
  }

  return '';
}

export function normalizeDateToYYYYMMDD(dateStr: string): string {
  if (!dateStr) return '';
  dateStr = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const match = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (match) {
    let day = match[1].padStart(2, '0');
    let month = match[2].padStart(2, '0');
    let year = match[3];
    if (year.length === 2) {
      year = '20' + year;
    }
    return `${year}-${month}-${day}`;
  }
  if (/^\d{8}$/.test(dateStr)) {
    const firstFour = parseInt(dateStr.substring(0, 4), 10);
    if (firstFour > 2000) {
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      return `${year}-${month}-${day}`;
    } else {
      const day = dateStr.substring(0, 2);
      const month = dateStr.substring(2, 4);
      const year = dateStr.substring(4, 8);
      return `${year}-${month}-${day}`;
    }
  }
  return dateStr;
}

export function parseRecordTypeInvoice(csvRecords: string[][], filename: string): {
  distributor_name: string;
  invoice_no: string;
  invoice_date: string;
  total_amount: number;
  global_cd_per: number;
  items: any[];
} {
  let distributor_name = '';
  let invoice_no = '';
  let invoice_date = '';
  let total_amount = 0;
  let global_cd_per = 0;
  // let _cd_amount = 0;
  const items: any[] = [];

  const headerRow = csvRecords.find(row => row[0]?.trim() === 'H');
  if (headerRow) {
    // CD% (headerRow[12]) and CD ₹ (headerRow[13]) in Marg EDI
    const p12 = parseFloat(headerRow[12] || '0');
    if (!isNaN(p12) && p12 > 0 && p12 <= 100) {
      global_cd_per = p12;
    }
    const p13 = parseFloat(headerRow[13] || '0');
    if (!isNaN(p13) && p13 > 0) {
      // _cd_amount = p13;
    }

    if (headerRow[5] && isNaN(Number(headerRow[5])) && headerRow[5].trim().length > 3 && !headerRow[5].includes('/') && !headerRow[5].includes('-')) {
      distributor_name = headerRow[5].trim();
      invoice_no = headerRow[3] ? headerRow[3].trim() : '';
      invoice_date = headerRow[2] ? normalizeDateToYYYYMMDD(headerRow[2]) : '';
      total_amount = parseFloat(headerRow[19]) || parseFloat(headerRow[8]) || 0;
    } else {
      distributor_name = headerRow[19] ? headerRow[19].trim() : '';
      invoice_no = (headerRow[18] && headerRow[18].trim().length > 0) ? headerRow[18].trim() : (headerRow[2] ? headerRow[2].trim() : '');
      const rawDate = headerRow[3] ? headerRow[3].trim() : '';
      invoice_date = normalizeDateToYYYYMMDD(rawDate);
      total_amount = parseFloat(headerRow[16]) || 0;
    }
  }

  for (const row of csvRecords) {
    if (row.length < 5) continue;
    if (row[0]?.trim() !== 'T') continue;

    const hasSlashesIn11 = Boolean(row[11] && (row[11].includes('/') || row[11].includes('-')));
    const isLayoutB = Boolean(
      (hasSlashesIn11 && !isNaN(parseFloat(row[6]))) ||
      (
        row[2] && isNaN(Number(row[2])) &&
        !isNaN(parseFloat(row[6])) && parseFloat(row[6]) > 0 &&
        !isNaN(parseFloat(row[8])) && parseFloat(row[8]) > 0 &&
        !isNaN(parseFloat(row[9])) && parseFloat(row[9]) > 0 &&
        (!row[5] || row[5] === '' || (isNaN(Number(row[5])) && row[5].length <= 6))
      )
    );

    if (isLayoutB) {
      let name = row[2] ? row[2].trim() : '';
      const pack = row[4] ? row[4].trim() : '';
      if (pack && name) {
        name = name + ' ' + pack;
      }

      const qty = parseFloat(row[6]) || 0;
      const free_qty = parseFloat(row[7]) || 0;
      const mrp = parseFloat(row[8]) || 0;
      const rate = parseFloat(row[9]) || 0;
      let batch = row[10] ? row[10].trim() : '';
      if (batch === '********' || batch === '//*' || batch === '*' || batch === '***') batch = '';
      const expiry = formatExpiryDate(row[11]);
      const gst = parseFloat(row[16]) || 0;
      const mfgB = (row[1] && isNaN(Number(row[1])) && row[1].trim().length >= 2) ? row[1].trim() : '';
      const hsnB = (row[26] || row[25] || '').trim();

      if (name) {
        items.push({
          name,
          quantity: qty,
          free_qty,
          rate,
          mrp,
          batch_no: batch,
          expiry_date: expiry,
          cgst_per: gst / 2,
          sgst_per: gst / 2,
          cd_per: global_cd_per,
          cd_rs: 0,
          manufacturer: mfgB,
          hsn_code: hsnB,
          _extracted_data: {
            name,
            manufacturer: mfgB,
            hsn_code: hsnB,
            rate,
            mrp,
            qty,
            free_qty,
            batch_no: batch,
            expiry_date: expiry,
            cgst_per: gst / 2,
            sgst_per: gst / 2,
            cd_per: global_cd_per,
            cd_rs: 0
          }
        });
      }
    } else {
      const offset = 1;
      let name = row[4 + offset] ? row[4 + offset].trim() : '';
      const pack = row[5 + offset] ? row[5 + offset].trim() : '';
      if (pack && name) {
        name = name + ' ' + pack;
      }

      const qty = parseFloat(row[19 + offset]) || parseFloat(row[10]) || 0;
      const free_qty = parseFloat(row[14 + offset]) || parseFloat(row[18]) || parseFloat(row[11]) || 0;
      const rate = parseFloat(row[13 + offset]) || parseFloat(row[14]) || 0;
      const mrp = parseFloat(row[15 + offset]) || parseFloat(row[16]) || 0;
      let batch = row[7 + offset] ? row[7 + offset].trim() : (row[8] ? row[8].trim() : '');
      if (batch === '********' || batch === '//*' || batch === '*' || batch === '***') batch = '';
      const expiry = formatExpiryDate(row[8 + offset] || row[9]);
      const gst = parseFloat(row[11 + offset]) || parseFloat(row[12]) || 0;
      const cd_rs = parseFloat(row[25]) || 0;
      const hsn = (row[26] || row[25 + offset] || row[37] || '').trim();
      const mfg = (row[2] && isNaN(Number(row[2])) && row[2].trim().length >= 2) ? row[2].trim() : (row[1] ? row[1].trim() : '');

      if (name) {
        items.push({
          name,
          quantity: qty,
          free_qty,
          rate,
          mrp,
          batch_no: batch,
          expiry_date: expiry,
          cgst_per: gst / 2,
          sgst_per: gst / 2,
          cd_per: global_cd_per,
          cd_rs: cd_rs,
          manufacturer: mfg,
          hsn_code: hsn,
          _extracted_data: {
            name,
            manufacturer: mfg,
            hsn_code: hsn,
            rate,
            mrp,
            qty,
            free_qty,
            batch_no: batch,
            expiry_date: expiry,
            cgst_per: gst / 2,
            sgst_per: gst / 2,
            cd_per: global_cd_per,
            cd_rs: cd_rs
          }
        });
      }
    }
  }

  if (!distributor_name && filename) {
    const base = path.basename(filename).toLowerCase();
    if (base.includes('prakash_pharmaceuticals') || base.includes('prakashpharmaceuticals')) {
      distributor_name = 'PRAKASH PHARMACEUTICALS';
    }
  }

  return {
    distributor_name,
    invoice_no,
    invoice_date,
    total_amount,
    global_cd_per,
    items
  };
}

export function detectLayoutType(content: string): 'vertical' | 'concatenated' | 'horizontal' {
  const lines = content.split('\n');
  let verticalScore = 0;
  let concatScore = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\d{3}$/.test(trimmed)) verticalScore++;
    if (/^\d{8}/.test(trimmed) || /^\d+[a-zA-Z]+$/.test(trimmed)) concatScore++;
  }

  if (verticalScore >= 2) return 'vertical';
  if (concatScore >= 2) return 'concatenated';
  return 'horizontal';
}

export function parseItemsFromTextLines(content: string, global_cd_per: number): any[] {
  const items: any[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const tokens = trimmed.split(/\s+/);
    if (tokens.length < 5) continue;

    const expIdx = tokens.findIndex(t => /^\d{1,2}[\/\-]\d{2,4}$/.test(t) || /^\d{2}[\/\-]\d{2}[\/\-]\d{2,4}$/.test(t));
    if (expIdx !== -1 && expIdx > 1 && expIdx < tokens.length - 3) {
      const batch = tokens[expIdx - 1];
      const expiry = formatExpiryDate(tokens[expIdx]);
      const qty = parseFloat(tokens[expIdx + 1]);
      const mrp = parseFloat(tokens[expIdx + 2]);
      const rate = parseFloat(tokens[expIdx + 3]);

      if (!isNaN(qty) && qty > 0 && !isNaN(mrp) && mrp > 0 && !isNaN(rate) && rate > 0) {
        const hasHsn = /^\d{4,8}$/.test(tokens[0]);
        const nameTokens = tokens.slice(hasHsn ? 1 : 0, expIdx - 1);

        const name = nameTokens.join(' ').trim();

        let cgst_per = 0;
        let sgst_per = 0;
        if (tokens[expIdx + 7] && !isNaN(parseFloat(tokens[expIdx + 7]))) {
          cgst_per = parseFloat(tokens[expIdx + 7]);
        }
        if (tokens[expIdx + 9] && !isNaN(parseFloat(tokens[expIdx + 9]))) {
          sgst_per = parseFloat(tokens[expIdx + 9]);
        }

        if (cgst_per > 30) cgst_per = 0;
        if (sgst_per > 30) sgst_per = 0;

        items.push({
          name,
          quantity: qty,
          rate,
          mrp,
          batch_no: batch === '*' || batch === '***' ? '' : batch,
          expiry_date: expiry,
          cgst_per,
          sgst_per,
          cd_per: global_cd_per,
          cd_rs: 0,
          free_qty: 0,
          hsn_code: hasHsn ? tokens[0] : ''
        });
      }
    }
  }
  return items;
}

export function parseShriyashInvoice(content: string, globalCdPer: number): { items: any[]; invoice_no: string; invoice_date: string; total_amount: number; distributor_name: string } {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const items: any[] = [];
  let invoice_no = '';
  let invoice_date = '';
  let total_amount = 0;

  for (const line of lines) {
    const invMatch = line.match(/(?:Invoice No\.|Inv No\.)\s*[:\-]?\s*([A-Za-z0-9\/]+)/i);
    if (invMatch && !invoice_no) {
      invoice_no = invMatch[1];
    }
    const dateMatch = line.match(/Date\s*[:\-]?\s*(\d{2}-\d{2}-\d{4})/i);
    if (dateMatch && !invoice_date) {
      invoice_date = normalizeDateToYYYYMMDD(dateMatch[1]);
    }
    const amtMatch = line.match(/NET AMT\s*[:\-]?\s*(\d+\.\d{2})/i);
    if (amtMatch && !total_amount) {
      total_amount = parseFloat(amtMatch[1]);
    }
  }

  const srIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\d{3}$/.test(lines[i])) {
      srIndices.push(i);
    }
  }

  for (let k = 0; k < srIndices.length; k++) {
    const startIdx = srIndices[k];
    const endIdx = srIndices[k + 1] || lines.length;
    const itemLines = lines.slice(startIdx, endIdx);

    if (itemLines.length < 5) continue;

//     const _srNo = itemLines[0];
//     const _mfg = itemLines[1];
    const hsn_code = itemLines[2];
    const rawProductDesc = itemLines[3];
    const qty = parseFloat(itemLines[4]) || 0;

    let batch_no = '';
    let expiry_date = '';
    let mrp = 0;
    let rate = 0;
    let gstVal = 0;

    const expLineIdx = itemLines.findIndex((line, index) => index >= 5 && /\d{2}-\d{2}/.test(line));

    if (expLineIdx !== -1) {
      const expLine = itemLines[expLineIdx];
      const parsed = decomposeShriyashConcatenatedLine(expLine);

      if (parsed.expiry) expiry_date = formatExpiryDate(parsed.expiry);

      if (parsed.batch) {
        batch_no = parsed.batch;
      } else if (expLineIdx > 5) {
        batch_no = itemLines[expLineIdx - 1];
      }

      if (parsed.mrp) mrp = parseFloat(parsed.mrp) || 0;
      if (parsed.rate) rate = parseFloat(parsed.rate) || 0;
      if (parsed.gst) gstVal = parseFloat(parsed.gst) || 0;

      if (!parsed.rate) {
        if (expLineIdx + 1 < itemLines.length) {
          mrp = parseFloat(itemLines[expLineIdx + 1]) || 0;
        }
        if (expLineIdx + 2 < itemLines.length) {
          const nextParsed = decomposeShriyashConcatenatedLine(itemLines[expLineIdx + 2]);
          rate = parseFloat(nextParsed.rate) || 0;
          if (nextParsed.gst) gstVal = parseFloat(nextParsed.gst) || 0;
        }
      }
    }

    let brandName = rawProductDesc;
    let packSize = '';

    const packMatch = rawProductDesc.match(/(10|15|20|30|60|100|120|150)(?:\s*(?:TA|TAB|Ta|ML|Dry SYP|CAP|Syp|Cap|G|Mg)s?)?$/i);
    if (packMatch) {
      packSize = packMatch[0];
      const index = rawProductDesc.lastIndexOf(packSize);
      brandName = rawProductDesc.substring(0, index).trim();
    }

    items.push({
      name: brandName,
      quantity: qty,
      rate,
      mrp,
      batch_no,
      expiry_date,
      cgst_per: gstVal / 2,
      sgst_per: gstVal / 2,
      cd_per: globalCdPer,
      cd_rs: 0,
      free_qty: 0,
      hsn_code
    });
  }

  return { items, invoice_no, invoice_date, total_amount, distributor_name: 'SHRIYASH DISTRIBUTORS' };
}

export function decomposeShriyashConcatenatedLine(line: string): { batch: string; expiry: string; mrp: string; rate: string; gst: string; amount: string } {
  let batch = '';
  let expiry = '';
  let mrp = '';
  let rate = '';
  let gst = '';
  let amount = '';

  const expMatch = line.match(/(\d{2}-\d{2})/);
  if (expMatch) {
    expiry = expMatch[1];
    const expIndex = line.indexOf(expiry);
    batch = line.substring(0, expIndex).trim();
    const rest = line.substring(expIndex + expiry.length).trim();

    const gstMatch = rest.match(/(5|12|18|28|0)%/);
    if (gstMatch) {
      gst = gstMatch[0].replace('%', '');
      const gstIndex = rest.indexOf(gstMatch[0]);
      const mrpRatePart = rest.substring(0, gstIndex).trim();
      amount = rest.substring(gstIndex + gstMatch[0].length).trim();

      const twoDecimals = mrpRatePart.match(/^(\d+\.\d{2})(\d+\.\d{2})$/);
      if (twoDecimals) {
        mrp = twoDecimals[1];
        rate = twoDecimals[2];
      } else {
        rate = mrpRatePart;
      }
    }
  } else {
    const gstMatch = line.match(/(5|12|18|28|0)%/);
    if (gstMatch) {
      gst = gstMatch[0].replace('%', '');
      const gstIndex = line.indexOf(gstMatch[0]);
      rate = line.substring(0, gstIndex).trim();
      amount = line.substring(gstIndex + gstMatch[0].length).trim();
    }
  }

  return { batch, expiry, mrp, rate, gst, amount };
}

export function parseNitinInvoice(content: string, globalCdPer: number): { items: any[]; invoice_no: string; invoice_date: string; total_amount: number; distributor_name: string } {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const items: any[] = [];
  let invoice_no = '';
  let invoice_date = '';
  let total_amount = 0;

  for (const line of lines) {
    const invMatch = line.match(/Invoice No:?\s*([A-Za-z0-9\/]+)/i);
    if (invMatch && !invoice_no) {
      invoice_no = invMatch[1];
    }
    const dateMatch = line.match(/Inv Date:?\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (dateMatch && !invoice_date) {
      const parts = dateMatch[1].split('/');
      invoice_date = `${parts[2]}-${parts[1]}-${parts[0]}`; // Normalize DD/MM/YYYY to YYYY-MM-DD
    }
  }

  const totalLines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const lastNumLine = totalLines.reverse().find(l => /^\d+\.\d{2}$/.test(l));
  if (lastNumLine) {
    total_amount = parseFloat(lastNumLine) || 0;
  }

  for (const line of lines) {
    if (/^\d{8}/.test(line)) {
      const hsn = line.substring(0, 8);
      const rest = line.substring(8);

      const expMatch = rest.match(/(\d{2}\/\d{2})/);
      if (!expMatch) continue;

      const expiry = expMatch[1];
      const expIndex = rest.indexOf(expiry);
      const partBeforeExp = rest.substring(0, expIndex).trim();
      let remaining = rest.substring(expIndex + expiry.length).trim();

      const mfgMatch = partBeforeExp.match(/([A-Z]{3})$/);
//       const _mfg = mfgMatch ? mfgMatch[1] : '';
      const productAndPack = mfgMatch ? partBeforeExp.substring(0, partBeforeExp.length - 3).trim() : partBeforeExp;

      const packMatch = productAndPack.match(/(\d+\s*(?:TAB|CAP|ML|Ta|Cap|Tab)s?)$/i);
      const packSize = packMatch ? packMatch[1] : '';
      const brandName = packMatch ? productAndPack.substring(0, productAndPack.length - packSize.length).trim() : productAndPack;

      const sgstMatch = remaining.match(/(2\.5|6\.0|9\.0|14\.0|6|9|14|0)(\d+\.\d{2})$/);
      if (!sgstMatch) continue;
      const sgstPercent = parseFloat(sgstMatch[1]);
      remaining = remaining.substring(0, remaining.length - sgstMatch[0].length).trim();

      const cgstMatch = remaining.match(/(2\.5|6\.0|9\.0|14\.0|6|9|14|0)(\d+\.\d{2})$/);
      if (!cgstMatch) continue;
      const cgstPercent = parseFloat(cgstMatch[1]);
      remaining = remaining.substring(0, remaining.length - cgstMatch[0].length).trim();

      const { decimals, remaining: batchPart } = splitConcatenatedDecimals(remaining);
      if (decimals.length < 5) continue;

//       const _taxable = parseFloat(decimals[decimals.length - 1]);
//       const _tdPercent = parseFloat(decimals[decimals.length - 2]);
      const amount = parseFloat(decimals[decimals.length - 3]);
      const rate = parseFloat(decimals[decimals.length - 4]);
      const rawMrpStr = decimals[decimals.length - 5];

      const { mrp, mrpOriginalDigits } = extractMrp(rawMrpStr, rate);
      const qty = Math.round(amount / rate);

      const rawMrpPrefix = rawMrpStr.substring(0, rawMrpStr.length - mrpOriginalDigits.length);
      let fullBatchPart = batchPart + rawMrpPrefix;

      let batch = fullBatchPart;
      if (batch.startsWith('SOT-')) {
        const standardMatch = batch.match(/^(SOT-\d+3B)/);
        if (standardMatch) batch = standardMatch[1];
      } else if (batch.startsWith('FND')) {
        batch = batch.substring(0, 10);
      } else if (batch.startsWith('I75')) {
        batch = batch.substring(0, 7);
      } else if (batch.startsWith('SIH')) {
        batch = batch.substring(0, 8);
      } else if (batch.startsWith('260')) {
        batch = batch.substring(0, 8);
      }

      items.push({
        name: brandName,
        quantity: qty,
        rate,
        mrp,
        batch_no: batch,
        expiry_date: formatExpiryDate(expiry),
        cgst_per: cgstPercent,
        sgst_per: sgstPercent,
        cd_per: globalCdPer,
        cd_rs: 0,
        free_qty: 0,
        hsn_code: hsn
      });
    }
  }

  return { items, invoice_no, invoice_date, total_amount, distributor_name: 'NITIN AGENCY' };
}

export function splitConcatenatedDecimals(str: string): { decimals: string[]; remaining: string } {
  const decimals: string[] = [];
  let remaining = str;

  while (true) {
    const match = remaining.match(/\.(\d{2})(\d+)\.(\d{2})$/);
    if (match) {
//       const _decPart = match[1];
      const intPart = match[2];
      const lastDecPart = match[3];

      decimals.unshift(intPart + '.' + lastDecPart);
      remaining = remaining.substring(0, remaining.length - intPart.length - lastDecPart.length - 1);
    } else {
      const lastMatch = remaining.match(/(\d+\.\d{2})$/);
      if (lastMatch) {
        decimals.unshift(lastMatch[1]);
        remaining = remaining.substring(0, remaining.length - lastMatch[1].length).trim();
      }
      break;
    }
  }

  return { decimals, remaining };
}

export function extractMrp(mrpStr: string, rate: number): { mrp: number; mrpOriginalDigits: string } {
  const dotIndex = mrpStr.indexOf('.');
  if (dotIndex === -1) return { mrp: parseFloat(mrpStr), mrpOriginalDigits: mrpStr };
  const decimals = mrpStr.substring(dotIndex);
  const integers = mrpStr.substring(0, dotIndex);

  for (let len = 1; len <= integers.length; len++) {
    const candidateStr = integers.substring(integers.length - len) + decimals;
    const candidate = parseFloat(candidateStr);
    if (candidate >= rate && candidate <= rate * 2.5) {
      return { mrp: candidate, mrpOriginalDigits: candidateStr };
    }
  }
  return { mrp: parseFloat(mrpStr), mrpOriginalDigits: mrpStr };
}

export function extractTotalsFromText(text: string) {
  const cleanLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let subtotal = 0;
  let total_amount = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let global_cd_per = 0;
  let total_discount = 0;
  let round_off = 0;
  let cn_amount = 0;
  let cn_number = '';

  for (const line of cleanLines) {
    // CGST
    const cgstMatch = line.match(/(?:cgst|central gst)\s*(?:amt|amount)?\s*[:\-]?\s*(\d+(?:\.\d{2})?)/i);
    if (cgstMatch && !cgst) {
      cgst = parseFloat(cgstMatch[1]) || 0;
    }

    // SGST
    const sgstMatch = line.match(/(?:sgst|state gst)\s*(?:amt|amount)?\s*[:\-]?\s*(\d+(?:\.\d{2})?)/i);
    if (sgstMatch && !sgst) {
      sgst = parseFloat(sgstMatch[1]) || 0;
    }

    // IGST
    const igstMatch = line.match(/(?:igst|integrated gst)\s*(?:amt|amount)?\s*[:\-]?\s*(\d+(?:\.\d{2})?)/i);
    if (igstMatch && !igst) {
      igst = parseFloat(igstMatch[1]) || 0;
    }

    // Subtotal
    const subMatch = line.match(/(?:sub\s*total|taxable\s*amt|taxable\s*amount|assessable\s*value)\s*[:\-]?\s*(\d+(?:\.\d{2})?)/i);
    if (subMatch && !subtotal) {
      subtotal = parseFloat(subMatch[1]) || 0;
    }

    // Discount Total
    const discMatch = line.match(/(?:total\s*disc|discount\s*total|total\s*discount)\s*[:\-]?\s*(\d+(?:\.\d{2})?)/i);
    if (discMatch && !total_discount) {
      total_discount = parseFloat(discMatch[1]) || 0;
    }

    // Round off
    const roundMatch = line.match(/(?:round\s*off|rounding)\s*[:\-]?\s*([+\-]?\s*\d+(?:\.\d{2})?)/i);
    if (roundMatch && !round_off) {
      round_off = parseFloat(roundMatch[1].replace(/\s+/g, '')) || 0;
    }

    // Discount percentage
    const pctMatch = line.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pctMatch && !global_cd_per) {
      const val = parseFloat(pctMatch[1]);
      if (val > 0 && val <= 10) {
        global_cd_per = val;
      }
    }

    // Credit Note Amount (Deduction)
    const cnAmtMatch = line.match(/(?:credit\s*note|cn|cr\.?\s*note|crn|credit\s*adj|cn\s*deduction)[^0-9#]*?\s*([+\-]?\s*\d+(?:\.\d{2})?)\s*$/i);
    if (cnAmtMatch && !cn_amount) {
      const matchText = cnAmtMatch[0].toLowerCase();
      if (!/(?:\bno\b|\bno\.|\bnum\b|\bnumber\b|#|cn\-|cr\-)/i.test(matchText)) {
        cn_amount = Math.abs(parseFloat(cnAmtMatch[1].replace(/\s+/g, ''))) || 0;
      }
    }

    // Credit Note Number
    const cnNoMatch = line.match(/(?:credit\s*note|cn|cr\.?\s*note|crn|credit\s*adj)(?:\s*(?:no\.?|num\.?|number|#))?\s*[:\-#]?\s*([a-zA-Z0-9\-\/]{3,})/i);
    if (cnNoMatch && !cn_number) {
      const candidate = cnNoMatch[1].trim();
      if (/\d/.test(candidate) && !/^(?:amt|amount|val|value|rs|dr|cr)$/i.test(candidate)) {
        const isDecimal = /^\d+\.\d{2}$/.test(candidate);
        const hasNoIndicator = /(?:no\.?|num|number|#)/i.test(cnNoMatch[0]);
        if (!isDecimal || hasNoIndicator) {
          cn_number = candidate;
        }
      }
    }
  }

  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i];
    if (line.toLowerCase() === 'net' || line.toLowerCase().includes('net amount') || line.toLowerCase().includes('grand total') || line.toLowerCase().includes('net value') || line.toLowerCase().includes('final bill') || line.toLowerCase().includes('payable')) {
      for (let j = Math.max(0, i - 3); j <= Math.min(cleanLines.length - 1, i + 3); j++) {
        const numMatch = cleanLines[j].match(/^\s*(\d+(?:\.\d{2})?)\s*$/);
        if (numMatch) {
          const val = parseFloat(numMatch[1]);
          if (val > 100) {
            total_amount = val;
          }
        }
      }
    }
  }

  if (!total_amount) {
    for (let i = cleanLines.length - 1; i >= 0; i--) {
      const line = cleanLines[i];
      const match = line.match(/(?:net|total|debit|grand|payable|final)\s*(?:amount|amt|val)?\s*[:\-]?\s*(\d+(?:\.\d{2})?)/i);
      if (match) {
        total_amount = parseFloat(match[1]);
        break;
      }
    }
  }

  if (!total_amount) {
    for (let i = cleanLines.length - 1; i >= Math.max(0, cleanLines.length - 15); i--) {
      const line = cleanLines[i];
      const match = line.match(/^\s*(\d+(?:\.\d{2})?)\s*$/);
      if (match) {
        const val = parseFloat(match[1]);
        if (val > 100) {
          total_amount = val;
          break;
        }
      }
    }
  }

  return { subtotal, cgst, sgst, igst, total_amount, global_cd_per, total_discount, round_off, cn_amount, cn_number };
}

