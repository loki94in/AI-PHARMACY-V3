import { dbManager } from '../database/connection.js';
import { whatsappQueueWorker } from './whatsappQueueWorker.js';
import { isReady, isPuppeteerDetachedError } from '../whatsappClient.js';
import { getAppDataDir } from '../config/index.js';
import { toLocalSqlDateTime } from '../utils/localTime.js';
// pdfkit / xlsx load inside the two generate methods: the boot-time "is a report due?" check
// imports this service and was paying ~0.4 s of blocked event loop for them (bug P2-81).
import fs from 'fs';
import path from 'path';
// import { fileURLToPath } from 'url';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
const TEMP_DIR = path.resolve(getAppDataDir(), 'uploads', 'temp');

function isDateInRange(dateStr: string | null | undefined, startStr: string, endStr: string): boolean {
  if (!dateStr) return false;
  let itemDate: Date;
  const trimmed = dateStr.trim();
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    let month = parseInt(parts[0], 10) - 1; // 0-indexed
    let year = parseInt(parts[1], 10);
    if (year < 100) year += 2000;
    itemDate = new Date(year, month + 1, 0, 23, 59, 59, 999);
  } else if (trimmed.includes('-')) {
    const parts = trimmed.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      itemDate = new Date(year, month, day, 12, 0, 0);
    } else if (parts.length === 2) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      itemDate = new Date(year, month + 1, 0, 23, 59, 59, 999);
    } else {
      itemDate = new Date(trimmed);
    }
  } else {
    itemDate = new Date(trimmed);
  }

  if (isNaN(itemDate.getTime())) return false;
  const start = new Date(startStr);
  const end = new Date(endStr);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return itemDate >= start && itemDate <= end;
}

export interface MultiMonthTrendItem {
  monthKey: string;
  monthLabel: string;
  sales: number;
  salesCount: number;
  purchases: number;
  purchasesCount: number;
  grossMargin: number;
}

export interface ReorderAdvisoryItem {
  medicineId: number;
  medicineName: string;
  purchaseFrequency: number;
  totalPurchasedQty: number;
  avgCostPrice: number;
  currentStock: number;
  suggestedOrderQty: number;
  turnoverStatus: 'CRITICAL LOW' | 'REORDER DUE' | 'HEALTHY';
  distributorName: string;
}

export interface UpcomingExpiringProduct {
  id: number;
  medicineId: number;
  medicineName: string;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  mrp: number;
  costPrice: number;
  rackLocation: string;
  valueAtRisk: number;
}

export interface MonthlyReportData {
  periodType: 'monthly' | 'midmonth' | 'quarterly' | 'yearly' | 'custom';
  periodLabel: string;
  startDate: string;
  endDate: string;
  pharmacyName: string;
  totalSales: number;
  totalSalesCount: number;
  totalPurchases: number;
  totalPurchasesCount: number;
  costOfGoodsSold: number;
  grossProfit: number;
  profitMargin: number;
  totalInventoryValuationCost?: number;
  totalInventoryValuationMrp?: number;
  topMedicines: Array<{ name: string; quantity: number; revenue: number }>;
  weeklyBreakdown: Array<{ label: string; sales: number; purchases: number }>;
  multiMonthTrends?: MultiMonthTrendItem[];
  reorderAdvisories?: ReorderAdvisoryItem[];
  upcomingExpiringProducts?: UpcomingExpiringProduct[];
  expiringBatchesCount?: number;
  pendingCallsCount?: number;
  stagedRemindersCount?: number;
}

export class MonthlyReportService {
  /**
   * Helper to compute date range for monthly, midmonth, quarterly, yearly, or custom date ranges.
   */
  getReportPeriodDates(
    periodType: 'monthly' | 'midmonth' | 'quarterly' | 'yearly' | 'custom',
    refDate: Date = new Date(),
    customStart?: string,
    customEnd?: string
  ): { startDate: string; endDate: string; periodLabel: string } {
    const year = refDate.getFullYear();
    const month = refDate.getMonth(); // 0-indexed
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    if (periodType === 'monthly') {
      const prevMonthDate = new Date(year, month - 1, 1);
      const prevYear = prevMonthDate.getFullYear();
      const prevMonth = prevMonthDate.getMonth();
      const lastDayOfPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();

      const mStr = String(prevMonth + 1).padStart(2, '0');
      const startDate = `${prevYear}-${mStr}-01`;
      const endDate = `${prevYear}-${mStr}-${String(lastDayOfPrevMonth).padStart(2, '0')}`;
      const periodLabel = `Full Month Report (${monthNames[prevMonth]} ${prevYear})`;
      return { startDate, endDate, periodLabel };
    } else if (periodType === 'midmonth') {
      const mStr = String(month + 1).padStart(2, '0');
      const startDate = `${year}-${mStr}-01`;
      const endDate = `${year}-${mStr}-15`;
      const periodLabel = `Mid-Month Report (1st - 15th ${monthNames[month]} ${year})`;
      return { startDate, endDate, periodLabel };
    } else if (periodType === 'quarterly') {
      const quarterIndex = Math.floor(month / 3);
      const qStartMonth = quarterIndex * 3;
      const qEndMonth = qStartMonth + 2;
      const lastDayOfQEnd = new Date(year, qEndMonth + 1, 0).getDate();

      const startDate = `${year}-${String(qStartMonth + 1).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(qEndMonth + 1).padStart(2, '0')}-${String(lastDayOfQEnd).padStart(2, '0')}`;
      const periodLabel = `Quarterly Report (Q${quarterIndex + 1} ${year})`;
      return { startDate, endDate, periodLabel };
    } else if (periodType === 'yearly') {
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;
      const periodLabel = `Annual Yearly Report (${year})`;
      return { startDate, endDate, periodLabel };
    } else if (periodType === 'custom' && customStart && customEnd) {
      return {
        startDate: customStart,
        endDate: customEnd,
        periodLabel: `Custom Range Report (${customStart} to ${customEnd})`
      };
    } else {
      // Default to current month to date
      const mStr = String(month + 1).padStart(2, '0');
      const startDate = `${year}-${mStr}-01`;
      const endDate = refDate.toISOString().split('T')[0];
      return { startDate, endDate, periodLabel: `Month-to-Date Report (${monthNames[month]} ${year})` };
    }
  }

  /**
   * Aggregate metrics for the requested period.
   */
  async compileReportData(
    periodType: 'monthly' | 'midmonth' | 'quarterly' | 'yearly' | 'custom',
    refDate?: Date,
    customStart?: string,
    customEnd?: string
  ): Promise<MonthlyReportData> {
    const db = await dbManager.getConnection();
    const { startDate, endDate, periodLabel } = this.getReportPeriodDates(periodType, refDate, customStart, customEnd);

    // Fetch Pharmacy Name
    const nameRow = await db.get("SELECT value FROM app_settings WHERE key = 'pharmacy_name'");
    const pharmacyName = (nameRow && nameRow.value && nameRow.value.trim()) ? nameRow.value.trim() : 'AI Pharmacy';

//     const _startDateTime = `${startDate} 00:00:00`;
//     const _endDateTime = `${endDate} 23:59:59`;

    const salesDateExpr = "COALESCE(date(business_date), date(date), date(substr(date, 1, 10)))";
    const salesInvDateExpr = "COALESCE(date(sinv.business_date), date(sinv.date), date(substr(sinv.date, 1, 10)))";
    const purchasesDateExpr = "COALESCE(date(date), date(business_date), date(substr(date, 1, 10)))";

    // 1. Sales Summary
    const salesRow = await db.get(
      `SELECT IFNULL(SUM(total_amount), 0) as total, COUNT(*) as cnt 
       FROM sales_invoices 
       WHERE ${salesDateExpr} >= date(?) AND ${salesDateExpr} <= date(?)`,
      [startDate, endDate]
    );

    const totalSales = Number(salesRow?.total || 0);
    const totalSalesCount = Number(salesRow?.cnt || 0);

    // 2. Purchases Summary
    const purchaseRow = await db.get(
      `SELECT IFNULL(SUM(total_amount), 0) as total, COUNT(*) as cnt 
       FROM purchases 
       WHERE ${purchasesDateExpr} >= date(?) AND ${purchasesDateExpr} <= date(?)`,
      [startDate, endDate]
    );

    const totalPurchases = Number(purchaseRow?.total || 0);
    const totalPurchasesCount = Number(purchaseRow?.cnt || 0);

    // 3. COGS & Margin calculation
    const cogsRow = await db.get(
      `SELECT IFNULL(SUM(si.quantity * IFNULL(im.cost_price, 0)), 0) as cost
       FROM sale_items si
       JOIN sales_invoices sinv ON si.invoice_id = sinv.id
       JOIN inventory_master im ON si.inventory_id = im.id
       WHERE ${salesInvDateExpr} >= date(?) AND ${salesInvDateExpr} <= date(?)`,
      [startDate, endDate]
    );

    const costOfGoodsSold = Number(cogsRow?.cost || 0);
    const grossProfit = totalSales - costOfGoodsSold;
    const profitMargin = totalSales > 0 ? Number(((grossProfit / totalSales) * 100).toFixed(1)) : 0;

    // 4. Top 5 Selling Medicines
    const topMedsRows = await db.all(
      `SELECT m.name, SUM(si.quantity) as total_qty, SUM(si.quantity * si.unit_price) as total_rev
       FROM sale_items si
       JOIN sales_invoices sinv ON si.invoice_id = sinv.id
       JOIN inventory_master im ON si.inventory_id = im.id
       JOIN medicines m ON im.medicine_id = m.id
       WHERE ${salesInvDateExpr} >= date(?) AND ${salesInvDateExpr} <= date(?)
       GROUP BY m.id, m.name
       ORDER BY total_rev DESC
       LIMIT 5`,
      [startDate, endDate]
    );

    const topMedicines = topMedsRows.map(r => ({
      name: r.name,
      quantity: Number(r.total_qty || 0),
      revenue: Number(r.total_rev || 0)
    }));

    // 5. Interval / Weekly Breakdown
    const startD = new Date(startDate);
    const endD = new Date(endDate);
    const totalDays = Math.ceil((endD.getTime() - startD.getTime()) / (1000 * 3600 * 24)) + 1;
    const segmentDays = Math.max(1, Math.ceil(totalDays / (periodType === 'midmonth' ? 3 : 4)));

    const weeklyBreakdown: Array<{ label: string; sales: number; purchases: number }> = [];
    let currentStart = new Date(startD);

    while (currentStart <= endD) {
      let currentEnd = new Date(currentStart);
      currentEnd.setDate(currentEnd.getDate() + segmentDays - 1);
      if (currentEnd > endD) currentEnd = new Date(endD);

      const sStr = currentStart.toISOString().split('T')[0];
      const eStr = currentEnd.toISOString().split('T')[0];

      const segSales = await db.get(
        `SELECT IFNULL(SUM(total_amount), 0) as total FROM sales_invoices WHERE date(date) BETWEEN date(?) AND date(?)`,
        [sStr, eStr]
      );
      const segPurch = await db.get(
        `SELECT IFNULL(SUM(total_amount), 0) as total FROM purchases WHERE date(date) BETWEEN date(?) AND date(?)`,
        [sStr, eStr]
      );

      const dayStartNum = currentStart.getDate();
      const dayEndNum = currentEnd.getDate();

      weeklyBreakdown.push({
        label: `Days ${dayStartNum}-${dayEndNum}`,
        sales: Number(segSales?.total || 0),
        purchases: Number(segPurch?.total || 0)
      });

      currentStart = new Date(currentEnd);
      currentStart.setDate(currentStart.getDate() + 1);
    }

    // 6. Multi-Month Trends (default last 6 calendar months relative to endDate)
    const trendMonthsSetting = await db.get("SELECT value FROM app_settings WHERE key = 'monthly_report_trend_months'").catch(() => null);
    const trendMonthsCount = Math.max(3, Math.min(12, parseInt(trendMonthsSetting?.value || '6', 10) || 6));
    const multiMonthTrends: MultiMonthTrendItem[] = [];

    const endRefDate = new Date(endDate);
    for (let i = trendMonthsCount - 1; i >= 0; i--) {
      const targetMDate = new Date(endRefDate.getFullYear(), endRefDate.getMonth() - i, 1);
      const y = targetMDate.getFullYear();
      const m = targetMDate.getMonth();
      const mStr = String(m + 1).padStart(2, '0');
      const lastDay = new Date(y, m + 1, 0).getDate();
      const mStart = `${y}-${mStr}-01`;
      const mEnd = `${y}-${mStr}-${String(lastDay).padStart(2, '0')}`;
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const mLabel = `${monthNames[m]} ${y}`;

      const mSales = await db.get(
        `SELECT IFNULL(SUM(total_amount), 0) as total, COUNT(*) as cnt FROM sales_invoices WHERE ${salesDateExpr} >= date(?) AND ${salesDateExpr} <= date(?)`,
        [mStart, mEnd]
      ).catch(() => ({ total: 0, cnt: 0 }));

      const mPurch = await db.get(
        `SELECT IFNULL(SUM(total_amount), 0) as total, COUNT(*) as cnt FROM purchases WHERE ${purchasesDateExpr} >= date(?) AND ${purchasesDateExpr} <= date(?)`,
        [mStart, mEnd]
      ).catch(() => ({ total: 0, cnt: 0 }));

      const sTotal = Number(mSales?.total || 0);
      const pTotal = Number(mPurch?.total || 0);

      multiMonthTrends.push({
        monthKey: `${y}-${mStr}`,
        monthLabel: mLabel,
        sales: sTotal,
        salesCount: Number(mSales?.cnt || 0),
        purchases: pTotal,
        purchasesCount: Number(mPurch?.cnt || 0),
        grossMargin: sTotal - pTotal
      });
    }

    // 7. Total Inventory Valuation
    const invValRow = await db.get(`
      SELECT IFNULL(SUM(quantity * cost_price), 0) as cost_val,
             IFNULL(SUM(quantity * mrp), 0) as mrp_val
      FROM inventory_master
      WHERE quantity > 0 AND COALESCE(is_active, 1) = 1
    `).catch(() => ({ cost_val: 0, mrp_val: 0 }));
    const totalInventoryValuationCost = Number(invValRow?.cost_val || 0);
    const totalInventoryValuationMrp = Number(invValRow?.mrp_val || 0);

    // 8. Smart Reorder & Purchase Velocity Growth Advisory (last 20 supplier purchases)
    const reorderRows = await db.all(`
      SELECT 
        m.id as medicine_id,
        m.name as medicine_name,
        COUNT(DISTINCT pi.purchase_id) as purchase_frequency,
        IFNULL(SUM(pi.quantity), 0) as total_purchased_qty,
        IFNULL(AVG(pi.cost_price), 0) as avg_cost_price,
        COALESCE(d.name, 'Direct Supplier') as distributor_name,
        COALESCE((
          SELECT SUM(im.quantity) 
          FROM inventory_master im 
          WHERE im.medicine_id = m.id AND im.quantity > 0 AND COALESCE(im.is_active, 1) = 1
        ), 0) as current_stock
      FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      JOIN medicines m ON pi.medicine_id = m.id
      LEFT JOIN distributors d ON p.distributor_id = d.id
      WHERE p.id IN (SELECT id FROM purchases ORDER BY COALESCE(date, business_date) DESC, id DESC LIMIT 20)
      GROUP BY m.id, m.name
      ORDER BY total_purchased_qty DESC
      LIMIT 15
    `).catch(() => []);

    const reorderAdvisories: ReorderAdvisoryItem[] = reorderRows.map((r: any) => {
      const totalPurchased = Number(r.total_purchased_qty || 0);
      const stock = Number(r.current_stock || 0);
      let turnoverStatus: 'CRITICAL LOW' | 'REORDER DUE' | 'HEALTHY' = 'HEALTHY';
      if (stock <= Math.max(1, Math.round(totalPurchased * 0.15))) {
        turnoverStatus = 'CRITICAL LOW';
      } else if (stock <= Math.round(totalPurchased * 0.4)) {
        turnoverStatus = 'REORDER DUE';
      }

      const suggestedOrderQty = Math.max(
        1,
        Math.max(totalPurchased - stock, Math.round(totalPurchased * 0.6))
      );

      return {
        medicineId: r.medicine_id,
        medicineName: (r.medicine_name || '').trim().replace(/\s+/g, ' '),
        purchaseFrequency: Number(r.purchase_frequency || 0),
        totalPurchasedQty: totalPurchased,
        avgCostPrice: Number(r.avg_cost_price || 0),
        currentStock: stock,
        suggestedOrderQty,
        turnoverStatus,
        distributorName: (r.distributor_name || 'Main Supplier').trim()
      };
    });

    // 9. Upcoming Monthly Expiring Products Register (Strictly Alphabetical A-Z)
    const horizonDaysRow = await db.get("SELECT value FROM app_settings WHERE key = 'monthly_report_expiry_horizon_days'").catch(() => null);
    const horizonDays = parseInt(horizonDaysRow?.value || '60', 10) || 60;

    const expStart = startDate;
    const expEndObj = new Date(refDate || new Date());
    expEndObj.setDate(expEndObj.getDate() + horizonDays);
    const expEnd = toLocalSqlDateTime(expEndObj).slice(0, 10);

    const rawExpRows = await db.all(`
      SELECT im.id, im.medicine_id, m.name as medicine_name, im.batch_no, im.expiry_date,
             im.quantity, im.mrp, im.cost_price, im.rack_location
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      WHERE im.quantity > 0 AND COALESCE(im.is_active, 1) = 1
      ORDER BY m.name COLLATE NOCASE ASC, im.expiry_date ASC
    `).catch(() => []);

    const upcomingExpiringProducts: UpcomingExpiringProduct[] = [];
    for (const r of rawExpRows) {
      if (isDateInRange(r.expiry_date, expStart, expEnd)) {
        const qty = Number(r.quantity || 0);
        const mrp = Number(r.mrp || 0);
        const costPrice = Number(r.cost_price || 0);
        upcomingExpiringProducts.push({
          id: r.id,
          medicineId: r.medicine_id,
          medicineName: (r.medicine_name || '').trim().replace(/\s+/g, ' '),
          batchNo: (r.batch_no || '—').trim(),
          expiryDate: (r.expiry_date || '—').trim(),
          quantity: qty,
          mrp,
          costPrice,
          rackLocation: (r.rack_location || '—').trim(),
          valueAtRisk: Number((qty * (mrp > 0 ? mrp : costPrice)).toFixed(2))
        });
      }
    }

    // Sort alphabetically by sanitized medicine name
    upcomingExpiringProducts.sort((a, b) =>
      a.medicineName.localeCompare(b.medicineName, undefined, { numeric: true, sensitivity: 'base' })
    );

    const expiringBatchesCount = upcomingExpiringProducts.length;

    const callRow = await db.get(
      "SELECT COUNT(*) as count FROM patient_call_tasks WHERE status IN ('pending', 'rescheduled')"
    ).catch(() => ({ count: 0 }));
    const pendingCallsCount = Number(callRow?.count || 0);

    const stagedRow = await db.get(
      "SELECT COUNT(*) as count FROM automation_notifications WHERE status = 'staged'"
    ).catch(() => ({ count: 0 }));
    const stagedRemindersCount = Number(stagedRow?.count || 0);

    return {
      periodType,
      periodLabel,
      startDate,
      endDate,
      pharmacyName,
      totalSales,
      totalSalesCount,
      totalPurchases,
      totalPurchasesCount,
      costOfGoodsSold,
      grossProfit,
      profitMargin,
      totalInventoryValuationCost,
      totalInventoryValuationMrp,
      topMedicines,
      weeklyBreakdown,
      multiMonthTrends,
      reorderAdvisories,
      upcomingExpiringProducts,
      expiringBatchesCount,
      pendingCallsCount,
      stagedRemindersCount
    };
  }

  /**
   * Helper to format progress bar strings for text-based graphs
   */
  private renderProgressBar(val: number, maxVal: number, width: number = 14): string {
    if (maxVal <= 0 || val <= 0) {
      return '░'.repeat(width);
    }
    const filled = Math.min(width, Math.max(1, Math.round((val / maxVal) * width)));
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  }

  /**
   * Format report data into WhatsApp markdown message with custom chart style
   */
  formatReportMessage(data: MonthlyReportData, chartStyle: string = 'standard'): string {
    const fmt = (num: number) => `₹ ${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    let msg = `📊 *${data.pharmacyName.toUpperCase()} — ${data.periodLabel.toUpperCase()}*\n`;
    msg += `🗓️ *Period*: ${data.startDate} to ${data.endDate}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `💰 *FINANCIAL SUMMARY*\n`;
    msg += `• *Total Sales*: *${fmt(data.totalSales)}* (${data.totalSalesCount} Invoices)\n`;
    msg += `• *Total Purchases*: *${fmt(data.totalPurchases)}* (${data.totalPurchasesCount} Bills)\n`;
    msg += `• *Gross Profit*: *${fmt(data.grossProfit)}*\n`;
    msg += `• *Profit Margin*: *${data.profitMargin}%*\n\n`;

    if (chartStyle !== 'minimal') {
      // Purchase vs Sales Visual Comparison Bar Chart
      const maxFin = Math.max(data.totalSales, data.totalPurchases, Math.abs(data.grossProfit), 1);
      const salesBar = this.renderProgressBar(data.totalSales, maxFin, 14);
      const purchBar = this.renderProgressBar(data.totalPurchases, maxFin, 14);
      const profitBar = this.renderProgressBar(Math.max(0, data.grossProfit), maxFin, 14);

      msg += `📊 *PURCHASE VS SALES GRAPH*\n`;
      msg += `\`\`\`\n`;
      msg += `Sales  [${salesBar}] ${fmt(data.totalSales)}\n`;
      msg += `Purch  [${purchBar}] ${fmt(data.totalPurchases)}\n`;
      msg += `Profit [${profitBar}] ${fmt(data.grossProfit)}\n`;
      msg += `\`\`\`\n\n`;
    }

    // Trend Breakdown Graph (if style is 'trend')
    if (chartStyle === 'trend' && data.weeklyBreakdown && data.weeklyBreakdown.length > 0) {
      const maxSeg = Math.max(...data.weeklyBreakdown.flatMap(w => [w.sales, w.purchases]), 1);
      msg += `📈 *PERIOD TREND BREAKDOWN*\n`;
      msg += `\`\`\`\n`;
      for (const seg of data.weeklyBreakdown) {
        const sBar = this.renderProgressBar(seg.sales, maxSeg, 8);
        const pBar = this.renderProgressBar(seg.purchases, maxSeg, 8);
        msg += `${seg.label.padEnd(10)} | S:[${sBar}] ${fmt(seg.sales)}\n`;
        msg += `           | P:[${pBar}] ${fmt(seg.purchases)}\n`;
      }
      msg += `\`\`\`\n\n`;
    }

    // Top Selling Medicines
    if (data.topMedicines && data.topMedicines.length > 0) {
      msg += `⭐ *TOP SELLING MEDICINES*\n`;
      data.topMedicines.forEach((med, idx) => {
        msg += `${idx + 1}. *${med.name}*: ${med.quantity} units (${fmt(med.revenue)})\n`;
      });
      msg += `\n`;
    }

    // Monthly Operational & Inventory Overview
    if ((data.expiringBatchesCount ?? 0) > 0 || (data.reorderAdvisories && data.reorderAdvisories.length > 0)) {
      msg += `⚠️ *INVENTORY RESTOCK & EXPIRY ADVISORY*\n`;
      if (data.reorderAdvisories && data.reorderAdvisories.length > 0) {
        const critCount = data.reorderAdvisories.filter(r => r.turnoverStatus === 'CRITICAL LOW').length;
        msg += `• *Fast-Moving Restock Alert*: ${data.reorderAdvisories.length} velocity product(s) analyzed (${critCount} critical low)\n`;
      }
      if ((data.expiringBatchesCount ?? 0) > 0) {
        msg += `• *Upcoming Expiring Stock*: ${data.expiringBatchesCount} batch(es) nearing expiry in upcoming horizon\n`;
      }
      msg += `\n`;
    }

    msg += `📄 *Full Multi-Page PDF Audit Document Attached*\n`;
    msg += `Includes 6-Month Visual Trends, Smart Reorder Advice & Alphabetical A-Z Expiry Register.\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🤖 _Automated Pharmacy OS Scheduled Report_`;

    return msg;
  }

  /**
   * Generate an Apple-inspired executive PDF report document using pdfkit.
   * Multi-page architecture:
   *   Page 1: Executive KPI Cards, 6-Month Visual Dual-Bar Trend Chart, Top Volume Medicines.
   *   Page 2: Smart Reorder & Purchase-Velocity Growth Advisory.
   *   Page 3+: Full Upcoming Expiring Products Register (A to Z) with clean pagination.
   */
  async generateReportPdf(
    data: MonthlyReportData,
    chartStyle: string = 'standard',
    templateTheme: string = 'executive',
    outputPath?: string
  ): Promise<string> {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    const finalPath = outputPath || path.join(TEMP_DIR, `Report_${data.periodType}_${Date.now()}.pdf`);
    const PDFDocument: typeof import('pdfkit') = await import('pdfkit').then((m: any) => m.default ?? m);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
      const stream = fs.createWriteStream(finalPath);
      doc.pipe(stream);

      const fmt = (n: number) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const fmtShort = (n: number) => {
        const num = Number(n || 0);
        if (num >= 10000000) return `Rs. ${(num / 10000000).toFixed(2)} Cr`;
        if (num >= 100000) return `Rs. ${(num / 100000).toFixed(2)} L`;
        if (num >= 1000) return `Rs. ${(num / 1000).toFixed(1)}k`;
        return `Rs. ${num.toFixed(0)}`;
      };

      // Apple Design Palette: Crisp Slate, Subtle Surfaces & Muted Accents
      const slateDark = '#0f172a';
      const slateHeader = '#1e293b';
      const slateMuted = '#64748b';
      const slateLight = '#f8fafc';
      const slateBorder = '#e2e8f0';
      const oceanBlue = '#0284c7';
      const slateBar = '#475569';

      // ==========================================
      // PAGE 1: EXECUTIVE FINANCIALS & 6-MONTH TREND
      // ==========================================

      // Top Header Banner
      doc.rect(40, 40, 515, 62).fill(slateDark);
      doc.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold').text(data.pharmacyName.toUpperCase(), 50, 48, { width: 495, align: 'center' });
      doc.fillColor('#94a3b8').fontSize(8.5).font('Helvetica').text(`EXECUTIVE MONTHLY BUSINESS & INVENTORY AUDIT — ${data.periodLabel.toUpperCase()}`, 50, 68, { width: 495, align: 'center' });
      doc.fillColor('#cbd5e1').fontSize(7.5).text(`Report Period: ${data.startDate} to ${data.endDate} | Generated: ${new Date().toLocaleDateString('en-IN')}`, 50, 82, { width: 495, align: 'center' });

      // 4 KPI Cards Grid
      const cardY = 112;
      const cardW = 120;
      const cardH = 50;
      const gap = 11.5;

      // Card 1: Sales
      doc.rect(40, cardY, cardW, cardH).lineWidth(0.8).strokeColor(slateBorder).fillAndStroke(slateLight, slateBorder);
      doc.fillColor(slateMuted).fontSize(7.5).font('Helvetica-Bold').text('TOTAL SALES', 46, cardY + 7);
      doc.fillColor(slateDark).fontSize(11).font('Helvetica-Bold').text(fmtShort(data.totalSales), 46, cardY + 20);
      doc.fontSize(7).font('Helvetica').fillColor(slateMuted).text(`${data.totalSalesCount} Invoices Generated`, 46, cardY + 36);

      // Card 2: Purchases
      const pX = 40 + cardW + gap;
      doc.rect(pX, cardY, cardW, cardH).lineWidth(0.8).strokeColor(slateBorder).fillAndStroke(slateLight, slateBorder);
      doc.fillColor(slateMuted).fontSize(7.5).font('Helvetica-Bold').text('TOTAL PURCHASES', pX + 6, cardY + 7);
      doc.fillColor(slateDark).fontSize(11).font('Helvetica-Bold').text(fmtShort(data.totalPurchases), pX + 6, cardY + 20);
      doc.fontSize(7).font('Helvetica').fillColor(slateMuted).text(`${data.totalPurchasesCount} Supplier Bills`, pX + 6, cardY + 36);

      // Card 3: Gross Margin
      const gX = pX + cardW + gap;
      doc.rect(gX, cardY, cardW, cardH).lineWidth(0.8).strokeColor(slateBorder).fillAndStroke(slateLight, slateBorder);
      doc.fillColor(slateMuted).fontSize(7.5).font('Helvetica-Bold').text('GROSS PROFIT', gX + 6, cardY + 7);
      doc.fillColor(slateDark).fontSize(11).font('Helvetica-Bold').text(fmtShort(data.grossProfit), gX + 6, cardY + 20);
      doc.fontSize(7).font('Helvetica').fillColor(slateMuted).text(`Profit Margin: ${data.profitMargin}%`, gX + 6, cardY + 36);

      // Card 4: Inventory Valuation
      const mX = gX + cardW + gap;
      doc.rect(mX, cardY, cardW, cardH).lineWidth(0.8).strokeColor(slateBorder).fillAndStroke(slateLight, slateBorder);
      doc.fillColor(slateMuted).fontSize(7.5).font('Helvetica-Bold').text('STOCK VALUATION', mX + 6, cardY + 7);
      doc.fillColor(slateDark).fontSize(11).font('Helvetica-Bold').text(fmtShort(data.totalInventoryValuationCost || 0), mX + 6, cardY + 20);
      doc.fontSize(7).font('Helvetica').fillColor(slateMuted).text(`MRP Value: ${fmtShort(data.totalInventoryValuationMrp || 0)}`, mX + 6, cardY + 36);

      // 6-Month Visual Trend Dual-Bar Chart
      let currentY = 172;
      doc.fillColor(slateDark).fontSize(10).font('Helvetica-Bold').text('6-MONTH PURCHASE VS SALES PERFORMANCE TREND', 40, currentY);
      doc.fillColor(slateMuted).fontSize(7.5).font('Helvetica').text('Monochrome comparison: Ocean Blue = Sales Revenue, Slate = Purchase Expenditure', 40, currentY + 12);
      currentY += 26;

      const trends = (data.multiMonthTrends && data.multiMonthTrends.length > 0) ? data.multiMonthTrends : [];
      const chartBoxH = Math.max(90, trends.length * 22 + 18);
      doc.rect(40, currentY, 515, chartBoxH).lineWidth(0.8).strokeColor(slateBorder).fillAndStroke(slateLight, slateBorder);

      const maxTrendVal = Math.max(...trends.flatMap(t => [t.sales, t.purchases]), 1);
      const trendBarMaxW = 280;

      trends.forEach((t, idx) => {
        const rowY = currentY + 10 + (idx * 22);
        // Month label
        doc.fillColor(slateDark).fontSize(8).font('Helvetica-Bold').text(t.monthLabel, 48, rowY + 3, { width: 55 });

        // Sales bar
        const sW = Math.max(4, (t.sales / maxTrendVal) * trendBarMaxW);
        doc.rect(108, rowY, sW, 6).fill(oceanBlue);

        // Purchases bar
        const pW = Math.max(4, (t.purchases / maxTrendVal) * trendBarMaxW);
        doc.rect(108, rowY + 8, pW, 6).fill(slateBar);

        // Values annotation
        const annotation = `Sales: ${fmtShort(t.sales)}  |  Purch: ${fmtShort(t.purchases)}  |  Diff: ${t.grossMargin >= 0 ? '+' : ''}${fmtShort(t.grossMargin)}`;
        doc.fillColor(slateMuted).fontSize(7).font('Helvetica').text(annotation, 108 + Math.max(sW, pW) + 10, rowY + 2, { width: 220 });
      });

      currentY += chartBoxH + 18;

      // Top Volume Medicines Table (Page 1 bottom)
      doc.fillColor(slateDark).fontSize(10).font('Helvetica-Bold').text('TOP 5 VOLUME MEDICINES IN THIS PERIOD', 40, currentY);
      currentY += 14;

      doc.rect(40, currentY, 515, 18).fill(slateHeader);
      doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
      doc.text('#', 48, currentY + 5, { width: 25 });
      doc.text('MEDICINE NAME', 75, currentY + 5, { width: 260 });
      doc.text('QUANTITY SOLD', 345, currentY + 5, { width: 75, align: 'right' });
      doc.text('TOTAL REVENUE', 430, currentY + 5, { width: 115, align: 'right' });
      currentY += 18;

      if (data.topMedicines && data.topMedicines.length > 0) {
        data.topMedicines.slice(0, 5).forEach((med, idx) => {
          const bg = idx % 2 === 0 ? '#ffffff' : slateLight;
          doc.rect(40, currentY, 515, 16).fill(bg);
          doc.fillColor(slateDark).fontSize(7.5).font('Helvetica');
          doc.text(`${idx + 1}`, 48, currentY + 4, { width: 25 });
          doc.text(med.name, 75, currentY + 4, { width: 260 });
          doc.text(`${med.quantity} units`, 345, currentY + 4, { width: 75, align: 'right' });
          doc.text(fmt(med.revenue), 430, currentY + 4, { width: 115, align: 'right' });
          currentY += 16;
        });
      } else {
        doc.rect(40, currentY, 515, 18).fill('#ffffff');
        doc.fillColor(slateMuted).fontSize(7.5).font('Helvetica').text('No sales recorded in this period.', 50, currentY + 5);
        currentY += 18;
      }

      // ==========================================
      // PAGE 2: SMART REORDER & PURCHASE-VELOCITY
      // ==========================================
      doc.addPage();

      // Page 2 Header Banner
      doc.rect(40, 40, 515, 46).fill(slateDark);
      doc.fillColor('#ffffff').fontSize(13).font('Helvetica-Bold').text('SMART REORDER & PURCHASE-VELOCITY ADVISORY', 50, 48, { width: 495, align: 'center' });
      doc.fillColor('#94a3b8').fontSize(7.5).font('Helvetica').text('Turnover analysis based on recent supplier purchase invoices vs current shelf stock', 50, 68, { width: 495, align: 'center' });

      // Advisory Context Note Box
      doc.rect(40, 94, 515, 26).lineWidth(0.8).strokeColor('#cbd5e1').fillAndStroke('#f1f5f9', '#cbd5e1');
      doc.fillColor(slateDark).fontSize(7.2).font('Helvetica').text(
        'Note: Counter sales can be unrecorded during peak rush hours. This advisory evaluates recurring supplier purchases to detect high-demand velocity medicines that require restocking before running out.',
        46, 98, { width: 503, lineGap: 1 }
      );

      let p2Y = 128;

      // Table Header
      doc.rect(40, p2Y, 515, 18).fill(slateHeader);
      doc.fillColor('#ffffff').fontSize(7.2).font('Helvetica-Bold');
      doc.text('#', 46, p2Y + 5, { width: 20 });
      doc.text('MEDICINE NAME', 68, p2Y + 5, { width: 175 });
      doc.text('PURCH FREQ', 246, p2Y + 5, { width: 52, align: 'center' });
      doc.text('BOUGHT', 300, p2Y + 5, { width: 40, align: 'right' });
      doc.text('STOCK', 342, p2Y + 5, { width: 38, align: 'right' });
      doc.text('STATUS', 384, p2Y + 5, { width: 58, align: 'center' });
      doc.text('REORDER', 444, p2Y + 5, { width: 42, align: 'right' });
      doc.text('SUPPLIER', 490, p2Y + 5, { width: 62, align: 'left' });
      p2Y += 18;

      const advisories = data.reorderAdvisories || [];
      if (advisories.length > 0) {
        advisories.slice(0, 20).forEach((item, idx) => {
          const bg = idx % 2 === 0 ? '#ffffff' : slateLight;
          doc.rect(40, p2Y, 515, 17).fill(bg);

          doc.fillColor(slateDark).fontSize(7.2).font('Helvetica');
          doc.text(`${idx + 1}`, 46, p2Y + 4, { width: 20, lineBreak: false });
          doc.font('Helvetica-Bold').text(item.medicineName, 68, p2Y + 4, { width: 175, lineBreak: false, ellipsis: true });
          doc.font('Helvetica').text(`${item.purchaseFrequency} bills`, 246, p2Y + 4, { width: 52, align: 'center', lineBreak: false });
          doc.text(`${item.totalPurchasedQty}`, 300, p2Y + 4, { width: 40, align: 'right', lineBreak: false });
          doc.text(`${item.currentStock}`, 342, p2Y + 4, { width: 38, align: 'right', lineBreak: false });

          // Status Badge
          let statusColor = '#16a34a';
          if (item.turnoverStatus === 'CRITICAL LOW') statusColor = '#dc2626';
          else if (item.turnoverStatus === 'REORDER DUE') statusColor = '#d97706';
          doc.fillColor(statusColor).font('Helvetica-Bold').text(item.turnoverStatus, 384, p2Y + 4, { width: 58, align: 'center', lineBreak: false });

          doc.fillColor(slateDark).font('Helvetica-Bold').text(`+${item.suggestedOrderQty}`, 444, p2Y + 4, { width: 42, align: 'right', lineBreak: false });
          doc.font('Helvetica').fillColor(slateMuted).text(item.distributorName, 490, p2Y + 4, { width: 62, align: 'left', lineBreak: false, ellipsis: true });

          p2Y += 17;
        });
      } else {
        doc.rect(40, p2Y, 515, 20).fill('#ffffff');
        doc.fillColor(slateMuted).fontSize(7.5).font('Helvetica').text('No recent purchase patterns analyzed for velocity.', 50, p2Y + 5, { lineBreak: false });
        p2Y += 20;
      }

      // Strategic Note at bottom of Page 2
      p2Y += 10;
      doc.fillColor(slateMuted).fontSize(7).font('Helvetica').text(
        'Strategic Action: Stocking recommended quantities above avoids lost counter revenue and ensures high patient refill retention.',
        40, p2Y, { width: 515, align: 'center', lineBreak: false }
      );

      // ==========================================
      // PAGE 3+: UPCOMING MONTHLY EXPIRY REGISTER (A-Z)
      // ==========================================
      doc.addPage();

      const drawExpiryHeader = () => {
        doc.rect(40, 40, 515, 45).fill(slateDark);
        doc.fillColor('#ffffff').fontSize(13).font('Helvetica-Bold').text('UPCOMING MONTHLY EXPIRY AUDIT REGISTER', 50, 48, { width: 495, align: 'center' });
        doc.fillColor('#94a3b8').fontSize(7.5).font('Helvetica').text('All active stock batches nearing expiry — Sorted Strictly Alphabetically (A to Z)', 50, 68, { width: 495, align: 'center' });

        const headerY = 93;
        doc.rect(40, headerY, 515, 18).fill(slateHeader);
        doc.fillColor('#ffffff').fontSize(7.2).font('Helvetica-Bold');
        doc.text('#', 46, headerY + 5, { width: 22, lineBreak: false });
        doc.text('MEDICINE NAME', 70, headerY + 5, { width: 190, lineBreak: false });
        doc.text('BATCH NO', 262, headerY + 5, { width: 60, lineBreak: false });
        doc.text('EXPIRY', 324, headerY + 5, { width: 48, align: 'center', lineBreak: false });
        doc.text('QTY', 374, headerY + 5, { width: 36, align: 'right', lineBreak: false });
        doc.text('RACK', 414, headerY + 5, { width: 48, align: 'center', lineBreak: false });
        doc.text('VALUATION (MRP)', 464, headerY + 5, { width: 85, align: 'right', lineBreak: false });
        return headerY + 18;
      };

      let p3Y = drawExpiryHeader();
      const expiringItems = data.upcomingExpiringProducts || [];

      if (expiringItems.length > 0) {
        expiringItems.forEach((item, idx) => {
          // Page overflow check
          if (p3Y > 750) {
            doc.addPage();
            p3Y = drawExpiryHeader();
          }

          const bg = idx % 2 === 0 ? '#ffffff' : slateLight;
          doc.rect(40, p3Y, 515, 16).fill(bg);

          doc.fillColor(slateDark).fontSize(7.2).font('Helvetica');
          doc.text(`${idx + 1}`, 46, p3Y + 4, { width: 22, lineBreak: false });
          doc.font('Helvetica-Bold').text(item.medicineName, 70, p3Y + 4, { width: 190, lineBreak: false, ellipsis: true });
          doc.font('Helvetica').text(item.batchNo, 262, p3Y + 4, { width: 60, lineBreak: false, ellipsis: true });
          doc.text(item.expiryDate, 324, p3Y + 4, { width: 48, align: 'center', lineBreak: false });
          doc.font('Helvetica-Bold').text(`${item.quantity}`, 374, p3Y + 4, { width: 36, align: 'right', lineBreak: false });
          doc.font('Helvetica').text(item.rackLocation, 414, p3Y + 4, { width: 48, align: 'center', lineBreak: false });
          doc.text(fmt(item.valueAtRisk), 464, p3Y + 4, { width: 85, align: 'right', lineBreak: false });

          p3Y += 16;
        });
      } else {
        doc.rect(40, p3Y, 515, 24).fill('#ffffff');
        doc.fillColor('#16a34a').fontSize(8).font('Helvetica-Bold').text(
          '✓ No inventory items are expiring within the upcoming 60-day horizon.',
          50, p3Y + 7, { width: 495, align: 'center', lineBreak: false }
        );
      }

      // ==========================================
      // GLOBAL PAGE FOOTER PASS
      // ==========================================
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        // Suppress automatic page breaks while drawing inside bottom margin
        doc.page.margins.bottom = 0;
        doc.strokeColor(slateBorder).lineWidth(0.5).moveTo(40, 792).lineTo(555, 792).stroke();
        doc.fontSize(7.5).font('Helvetica').fillColor(slateMuted);
        doc.text(`${data.pharmacyName.toUpperCase()} — CONFIDENTIAL AUDIT REPORT`, 40, 798, { width: 250, align: 'left', lineBreak: false });
        doc.text(`Page ${i + 1} of ${range.count}`, 40, 798, { width: 515, align: 'center', lineBreak: false });
        doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 305, 798, { width: 250, align: 'right', lineBreak: false });
      }

      doc.end();
      stream.on('finish', () => resolve(finalPath));
      stream.on('error', (err) => reject(err));
    });
  }

  /**
   * Send all 3 PDF template design samples to the Owner's WhatsApp number.
   */
  async sendAllTemplateSamples(customPhone?: string): Promise<{ success: boolean; message: string; count: number }> {
    const recipientPhone = customPhone || await this.resolveRecipientPhone();
    if (!recipientPhone) {
      return { success: false, message: 'No owner/pharmacy phone number configured in Settings.', count: 0 };
    }

    const reportData = await this.compileReportData('monthly');
    const themes = [
      { name: 'Executive Modern (Emerald & Slate)', key: 'executive' },
      { name: 'Corporate Classic (Navy & Royal Blue)', key: 'classic' },
      { name: 'Minimalist High-Contrast (Charcoal & Indigo)', key: 'minimalist' }
    ];

    let count = 0;
    for (const theme of themes) {
      const pdfPath = await this.generateReportPdf(reportData, 'trend', theme.key);
      const caption = `🎨 *PDF REPORT TEMPLATE STYLE: ${theme.name.toUpperCase()}*\n\nReview this sample PDF report layout on your phone to choose your preferred design for monthly pharmacy billing & expiry reports.`;
      await whatsappQueueWorker.enqueue(recipientPhone, caption, 'monthly_report_sample', 'Pharmacy Owner / Admin', undefined, pdfPath);
      count++;
    }

    return {
      success: true,
      message: `Sent ${count} PDF template style samples to Owner WhatsApp (${recipientPhone})`,
      count
    };
  }

  /**
   * Generate an Excel spreadsheet report document.
   */
  async generateReportExcel(data: MonthlyReportData, outputPath?: string): Promise<string> {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    const finalPath = outputPath || path.join(TEMP_DIR, `Report_${data.periodType}_${Date.now()}.xlsx`);

    const wsData = [
      [`${data.pharmacyName} - ${data.periodLabel}`],
      [`Period: ${data.startDate} to ${data.endDate}`],
      [],
      ['FINANCIAL SUMMARY'],
      ['Total Sales (Rs.)', data.totalSales, `Invoices: ${data.totalSalesCount}`],
      ['Total Purchases (Rs.)', data.totalPurchases, `Bills: ${data.totalPurchasesCount}`],
      ['Gross Profit (Rs.)', data.grossProfit],
      ['Profit Margin %', `${data.profitMargin}%`],
      ['Cost of Goods Sold (Rs.)', data.costOfGoodsSold],
      [],
      ['TOP SELLING MEDICINES'],
      ['Rank', 'Medicine Name', 'Quantity Sold', 'Revenue (Rs.)'],
      ...data.topMedicines.map((m, i) => [i + 1, m.name, m.quantity, m.revenue]),
      [],
      ['PERIOD TREND BREAKDOWN'],
      ['Segment', 'Sales (Rs.)', 'Purchases (Rs.)', 'Net Segment (Rs.)'],
      ...data.weeklyBreakdown.map(w => [w.label, w.sales, w.purchases, w.sales - w.purchases])
    ];

    const XLSX: typeof import('xlsx') = await import('xlsx').then((m: any) => m.default ?? m);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws['!cols'] = [{ wch: 25 }, { wch: 30 }, { wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Scheduled Report');

    XLSX.writeFile(wb, finalPath);
    return finalPath;
  }

  /**
   * Resolve target recipient WhatsApp number from settings
   */
  async resolveRecipientPhone(): Promise<string> {
    const db = await dbManager.getConnection();

    // 1. Explicit monthly report phone
    const repPhone = await db.get("SELECT value FROM app_settings WHERE key = 'monthly_report_phone'");
    if (repPhone && repPhone.value && repPhone.value.trim() !== '') {
      return repPhone.value.trim();
    }

    // 2. Store Owner / Admin WhatsApp Number
    const ownerPhone = await db.get("SELECT value FROM app_settings WHERE key = 'owner_whatsapp_number'");
    if (ownerPhone && ownerPhone.value && ownerPhone.value.trim() !== '') {
      return ownerPhone.value.trim();
    }

    // 3. Shop phone setting
    const shopPhone = await db.get("SELECT value FROM app_settings WHERE key = 'shop_phone'");
    if (shopPhone && shopPhone.value && shopPhone.value.trim() !== '') {
      return shopPhone.value.trim();
    }

    // 4. Main pharmacy phone
    const mainPhone = await db.get("SELECT value FROM app_settings WHERE key = 'phone'");
    if (mainPhone && mainPhone.value && mainPhone.value.trim() !== '') {
      return mainPhone.value.trim();
    }

    return '';
  }

  /**
   * Send the scheduled report to WhatsApp in chosen format (text, pdf, combined, excel).
   */
  async sendReport(
    periodType: 'monthly' | 'midmonth' | 'quarterly' | 'yearly' | 'custom',
    customPhone?: string,
    customFormat?: string,
    customStyle?: string,
    customTheme?: string,
    customStart?: string,
    customEnd?: string
  ): Promise<{ success: boolean; message: string; recipientPhone: string; filePath?: string }> {
    const db = await dbManager.getConnection();

    const recipientPhone = customPhone || await this.resolveRecipientPhone();
    if (!recipientPhone) {
      return { success: false, message: 'No phone number configured in Settings for sending reports.', recipientPhone: '' };
    }

    // Resolve Format Preference
    let format: string = customFormat || '';
    if (!format) {
      const formatRow = await db.get("SELECT value FROM app_settings WHERE key = 'monthly_report_delivery_format'");
      format = (formatRow && formatRow.value) ? formatRow.value : 'combined';
    }

    // Resolve Style Preference
    let style = customStyle;
    if (!style) {
      const styleRow = await db.get("SELECT value FROM app_settings WHERE key = 'monthly_report_chart_style'");
      style = styleRow ? styleRow.value : 'standard';
    }

    // Resolve Theme Preference
    let theme = customTheme;
    if (!theme) {
      const themeRow = await db.get("SELECT value FROM app_settings WHERE key = 'monthly_report_template_theme'");
      theme = themeRow ? themeRow.value : 'executive';
    }

    const reportData = await this.compileReportData(periodType, undefined, customStart, customEnd);
    const messageText = this.formatReportMessage(reportData, style);

    try {
      console.log(`[Monthly Report] Dispatching ${periodType} report (format: ${format}, style: ${style}, theme: ${theme}) to ${recipientPhone}...`);

      let generatedFilePath: string | undefined = undefined;

      if (format === 'pdf' || format === 'combined') {
        generatedFilePath = await this.generateReportPdf(reportData, style, theme);
      } else if (format === 'excel') {
        generatedFilePath = await this.generateReportExcel(reportData);
      }

      if (format === 'pdf') {
        const caption = `📊 *${reportData.pharmacyName} — ${reportData.periodLabel}*\nPDF Report Document attached.`;
        await whatsappQueueWorker.enqueue(recipientPhone, caption, `scheduled_report_${periodType}`, 'Pharmacy Owner / Admin', undefined, generatedFilePath);
      } else if (format === 'excel') {
        const caption = `📊 *${reportData.pharmacyName} — ${reportData.periodLabel}*\nExcel Spreadsheet Report attached.`;
        await whatsappQueueWorker.enqueue(recipientPhone, caption, `scheduled_report_${periodType}`, 'Pharmacy Owner / Admin', undefined, generatedFilePath);
      } else if (format === 'combined') {
        // Enqueue WhatsApp text message AND attach PDF document
        await whatsappQueueWorker.enqueue(recipientPhone, messageText, `scheduled_report_${periodType}`, 'Pharmacy Owner / Admin', undefined, generatedFilePath);
      } else {
        // Text format only
        await whatsappQueueWorker.enqueue(recipientPhone, messageText, `scheduled_report_${periodType}`, 'Pharmacy Owner / Admin');
      }

      // Record in action_logs for Activity Alerts
      await db.run(
        `INSERT INTO action_logs (action_type, description) VALUES (?, ?)`,
        [`SCHEDULED_REPORT_${periodType.toUpperCase()}`, `Sent ${reportData.periodLabel} (${format}) to ${recipientPhone}`]
      );

      // Record in automation_notifications for WhatsApp Live Quick Controller tracking
      await db.run(
        `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['monthly_report', 'Pharmacy Owner / Admin', recipientPhone, messageText, 'sent', `report_${periodType}_${Date.now()}`]
      );

      // Update state in app_settings to mark sent
      const now = new Date();
      if (periodType === 'monthly') {
        const sentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_monthly_report_sent_month', ?)", [sentMonthKey]);
      } else {
        const sentDateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_midmonth_report_sent_date', ?)", [sentDateKey]);
      }

      return {
        success: true,
        message: `${reportData.periodLabel} (${format.toUpperCase()}) sent successfully to ${recipientPhone}`,
        recipientPhone,
        filePath: generatedFilePath
      };
    } catch (err: any) {
      console.error(`[Monthly Report] Error sending ${periodType} report:`, err);
      const rawMsg = err?.message || String(err);
      const userMessage = isPuppeteerDetachedError(rawMsg)
        ? 'WhatsApp connection lost (detached browser frame). Please scan the QR code in Settings to reconnect.'
        : rawMsg;
      await db.run(
        `INSERT INTO action_logs (action_type, description) VALUES (?, ?)`,
        [`SCHEDULED_REPORT_${periodType.toUpperCase()}`, `Failed to send ${reportData.periodLabel} to ${recipientPhone}: ${userMessage}`]
      );
      return {
        success: false,
        message: `Failed to send report: ${userMessage}`,
        recipientPhone
      };
    }
  }

  /**
   * Run background check to determine if 1st or 15th of the month report needs to be sent today.
   */
  async checkAndRunScheduledReports(): Promise<void> {
    try {
      const db = await dbManager.getConnection();

      // Check if monthly report feature is enabled
      const enabledRow = await db.get("SELECT value FROM app_settings WHERE key = 'monthly_report_enabled'");
      const isEnabled = !enabledRow || enabledRow.value !== 'false';
      if (!isEnabled) {
        return;
      }

//       const autoRow = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
      const waRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_enabled'");
//       const _isAuto = autoRow && autoRow.value === 'true';
      const isWa = waRow && waRow.value === 'true';

      const now = new Date();
      const currentHour = now.getHours();
      if (currentHour < 8) return;

      const currentDay = now.getDate();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      const monthStr = String(currentMonth).padStart(2, '0');

      // Check 1st of month schedule
      if (currentDay === 1) {
        const lastSentRow = await db.get("SELECT value FROM app_settings WHERE key = 'last_monthly_report_sent_month'");
        const lastSentMonth = lastSentRow ? lastSentRow.value : '';
        const thisMonthKey = `${currentYear}-${monthStr}`;

        if (lastSentMonth !== thisMonthKey) {
          console.log(`[Monthly Report Scheduler] 1st of month detected (${thisMonthKey}). Triggering monthly report...`);
          if (!isReady && isWa) {
            console.log('[Monthly Report Scheduler] WhatsApp client not ready yet. Will retry next check cycle.');
            return;
          }
          await this.sendReport('monthly', undefined, 'combined');
        }
      }

      // Check 15th of month schedule
      if (currentDay === 15) {
        const lastSentRow = await db.get("SELECT value FROM app_settings WHERE key = 'last_midmonth_report_sent_date'");
        const lastSentDate = lastSentRow ? lastSentRow.value : '';
        const thisMidMonthKey = `${currentYear}-${monthStr}-15`;

        if (lastSentDate !== thisMidMonthKey) {
          console.log(`[Monthly Report Scheduler] 15th of month detected (${thisMidMonthKey}). Triggering mid-month report...`);
          if (!isReady && isWa) {
            console.log('[Monthly Report Scheduler] WhatsApp client not ready yet. Will retry next check cycle.');
            return;
          }
          await this.sendReport('midmonth', undefined, 'combined');
        }
      }
    } catch (err) {
      console.error('[Monthly Report Scheduler] Error during background check:', err);
    }
  }
}

export const monthlyReportService = new MonthlyReportService();
