import { getReportCutoverDate, effectiveReportFromDate } from './reportCutover.js';

export const SALES_DATE_EXPR = "COALESCE(date(business_date), date(date), date(substr(date, 1, 10)), date(substr(business_date, 1, 10)))";
export const SALES_INV_DATE_EXPR = "COALESCE(date(sinv.business_date), date(sinv.date), date(substr(sinv.date, 1, 10)), date(substr(sinv.business_date, 1, 10)))";
export const PURCHASES_DATE_EXPR = "COALESCE(date(date), date(business_date), date(substr(date, 1, 10)), date(substr(business_date, 1, 10)))";
export const PURCHASES_P_DATE_EXPR = "COALESCE(date(p.date), date(p.business_date), date(substr(p.date, 1, 10)), date(substr(p.business_date, 1, 10)))";

export async function resolveFromDate(requestedFrom: string, db?: any): Promise<string> {
  const requested = (requestedFrom && requestedFrom.trim()) ? requestedFrom.trim() : '';
  if (requested || !db) return requested || '1970-01-01';
  try {
    const cutover = await getReportCutoverDate(db);
    return effectiveReportFromDate(requested, cutover);
  } catch {
    return '1970-01-01';
  }
}

export interface ReportExportConfig {
  title: string;
  headers: string[];
  csvHeaders: string[];
  keys: string[];
  query: string;
  params: any[];
  alignMap: Record<string, 'left' | 'center' | 'right'>;
  colWidths: number[];
  isCustomRows?: boolean;
}

/**
 * Builds the query, column mappings, and metadata for both PDF and CSV exports.
 * Eliminates duplicate schema definitions between /export-pdf and /export-csv.
 */
export function getReportExportConfig(
  type: string,
  from: string,
  to: string,
  hasDateFilter: boolean,
  periodDays: number = 200
): ReportExportConfig {
  let title = 'Pharmacy OS Report';
  let headers: string[] = [];
  let csvHeaders: string[] = [];
  let keys: string[] = [];
  let query = '';
  let params: any[] = [];
  let alignMap: Record<string, 'left' | 'center' | 'right'> = {};
  let colWidths: number[] = [];
  let isCustomRows = false;

  if (type === 'sales') {
    title = 'Sales History Report';
    headers = ['Invoice No', 'Date', 'Amount'];
    csvHeaders = ['Invoice No', 'Date', 'Amount (Rs.)'];
    keys = ['invoice_no', 'date', 'total_amount'];
    query = `SELECT invoice_no, COALESCE(date, business_date) as date, total_amount FROM sales_invoices WHERE ${SALES_DATE_EXPR} BETWEEN date(?) AND date(?) ORDER BY id DESC`;
    params = [from, to];
    alignMap = { invoice_no: 'left', date: 'center', total_amount: 'right' };
    colWidths = [180, 180, 152];
  } else if (type === 'purchases') {
    title = 'Purchase History Report';
    headers = ['Invoice / Bill No', 'Distributor / Supplier', 'Date', 'Amount'];
    csvHeaders = ['Invoice / Bill No', 'Distributor / Supplier', 'Date', 'Amount (Rs.)'];
    keys = ['invoice_no', 'distributor_name', 'date', 'total_amount'];
    query = `SELECT p.invoice_no, d.name as distributor_name, COALESCE(p.date, p.business_date) as date, p.total_amount FROM purchases p LEFT JOIN distributors d ON p.distributor_id = d.id WHERE ${PURCHASES_P_DATE_EXPR} BETWEEN date(?) AND date(?) ORDER BY p.id DESC`;
    params = [from, to];
    alignMap = { invoice_no: 'left', distributor_name: 'left', date: 'center', total_amount: 'right' };
    colWidths = [120, 180, 112, 100];
  } else if (type === 'inventory') {
    title = 'Current Inventory Status Report';
    headers = ['Medicine Name', 'Batch No', 'Stock Qty', 'Expiry Date', 'Cost Price', 'MRP', 'Valuation (Cost)'];
    csvHeaders = ['Medicine Name', 'Batch No', 'Stock Qty', 'Expiry Date', 'Cost Price (Rs.)', 'MRP (Rs.)', 'Valuation Cost (Rs.)'];
    keys = ['medicine_name', 'batch_no', 'quantity', 'expiry_date', 'cost_price', 'mrp', 'value'];
    query = 'SELECT m.name as medicine_name, im.batch_no, im.quantity, im.expiry_date, im.cost_price, im.mrp, (im.quantity * im.cost_price) as value FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE COALESCE(im.is_active, 1) = 1 ORDER BY medicine_name ASC';
    alignMap = { medicine_name: 'left', batch_no: 'left', quantity: 'right', expiry_date: 'center', cost_price: 'right', mrp: 'right', value: 'right' };
    colWidths = [130, 60, 50, 70, 50, 50, 102];
  } else if (type === 'expiry') {
    if (hasDateFilter) {
      title = `Expiry Warning Report (${from} to ${to})`;
      query = 'SELECT m.name as medicine_name, im.batch_no, im.quantity, im.cost_price, im.expiry_date, (im.quantity * im.cost_price) as value FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE COALESCE(date(im.expiry_date), date(substr(im.expiry_date, 1, 10))) BETWEEN date(?) AND date(?) AND COALESCE(im.is_active, 1) = 1 AND im.quantity > 0 ORDER BY im.expiry_date ASC, m.name COLLATE NOCASE ASC';
      params = [from, to];
    } else {
      title = 'Expiry Warning Report (Next 365 Days)';
      query = 'SELECT m.name as medicine_name, im.batch_no, im.quantity, im.cost_price, im.expiry_date, (im.quantity * im.cost_price) as value FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE COALESCE(date(im.expiry_date), date(substr(im.expiry_date, 1, 10))) <= date(\'now\', \'+365 days\') AND COALESCE(im.is_active, 1) = 1 AND im.quantity > 0 ORDER BY im.expiry_date ASC, m.name COLLATE NOCASE ASC';
      params = [];
    }
    headers = ['Medicine Name', 'Batch No', 'Stock Qty', 'Cost Price', 'Expiry Date', 'Cost Value'];
    csvHeaders = ['Medicine Name', 'Batch No', 'Stock Qty', 'Cost Price (Rs.)', 'Expiry Date', 'Cost Value (Rs.)'];
    keys = ['medicine_name', 'batch_no', 'quantity', 'cost_price', 'expiry_date', 'value'];
    alignMap = { medicine_name: 'left', batch_no: 'left', quantity: 'right', cost_price: 'right', expiry_date: 'center', value: 'right' };
    colWidths = [150, 70, 60, 60, 80, 92];
  } else if (type === 'nonMoving') {
    title = `Non-Moving Inventory Report (${periodDays}+ Days Inactive)`;
    headers = ['Medicine Name', 'Batch No', 'Purchase Date', 'Stock Qty', 'Expiry Date', 'Cost Price', 'Hold Value (Cost)', 'Hold Value (MRP)', 'Dormant Period'];
    csvHeaders = ['Medicine Name', 'Batch No', 'Purchase Date', 'Stock Qty', 'Expiry Date', 'Cost Price (Rs.)', 'Hold Value Cost (Rs.)', 'Hold Value MRP (Rs.)', 'Dormant Period'];
    keys = ['medicineName', 'batchNo', 'purchaseDate', 'quantity', 'expiryDate', 'costPrice', 'totalCostValue', 'totalValue', 'dormantDaysLabel'];
    alignMap = { medicineName: 'left', batchNo: 'left', purchaseDate: 'center', quantity: 'right', expiryDate: 'center', costPrice: 'right', totalCostValue: 'right', totalValue: 'right', dormantDaysLabel: 'center' };
    colWidths = [110, 45, 55, 40, 60, 50, 55, 55, 52];
    isCustomRows = true;
  }

  return {
    title,
    headers,
    csvHeaders,
    keys,
    query,
    params,
    alignMap,
    colWidths,
    isCustomRows
  };
}
