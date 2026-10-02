import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getIndianFinancialYear } from '../src/utils/financialYear.js';
import { dbManager } from '../src/database/connection.js';

describe('Prevent Duplicate Purchase Bill Entries (FY & Distributor scoped)', () => {
  it('correctly calculates Indian Financial Year date boundaries', () => {
    // April 2026 -> FY 2026-27
    const apr = getIndianFinancialYear('2026-04-01');
    assert.equal(apr.fyLabel, '2026-27');
    assert.equal(apr.startDate, '2026-04-01');
    assert.equal(apr.endDate, '2027-03-31');

    // October 2026 -> FY 2026-27
    const oct = getIndianFinancialYear('2026-10-02');
    assert.equal(oct.fyLabel, '2026-27');
    assert.equal(oct.startDate, '2026-04-01');
    assert.equal(oct.endDate, '2027-03-31');

    // March 2026 -> FY 2025-26
    const mar = getIndianFinancialYear('2026-03-31');
    assert.equal(mar.fyLabel, '2025-26');
    assert.equal(mar.startDate, '2025-04-01');
    assert.equal(mar.endDate, '2026-03-31');

    // January 2026 -> FY 2025-26
    const jan = getIndianFinancialYear('2026-01-15');
    assert.equal(jan.fyLabel, '2025-26');
    assert.equal(jan.startDate, '2025-04-01');
    assert.equal(jan.endDate, '2026-03-31');
  });

  it('detects duplicate invoice in same FY and distributor, while allowing cross-year and cross-distributor', async () => {
    const db = await dbManager.getConnection();

    // Setup test distributors
    const distNameA = `__TEST_DIST_DUP_A_${Date.now()}`;
    const distNameB = `__TEST_DIST_DUP_B_${Date.now()}`;
    const resA = await db.run('INSERT INTO distributors (name) VALUES (?)', [distNameA]);
    const distIdA = resA.lastID;
    const resB = await db.run('INSERT INTO distributors (name) VALUES (?)', [distNameB]);
    const distIdB = resB.lastID;

    const testInvoiceNo = `TEST-INV-${Date.now()}`;

    // Insert purchase bill in FY 2026-27 (Date: 2026-05-15)
    const purchRes = await db.run(
      `INSERT INTO purchases (distributor_id, invoice_no, date, total_amount) VALUES (?, ?, ?, ?)`,
      [distIdA, testInvoiceNo, '2026-05-15 10:30:00', 4500.0]
    );
    const existingPurchaseId = purchRes.lastID;

    try {
      // Helper function matching the SQL query in /check-duplicate and /manual
      const checkDuplicate = async (params: {
        distId: number;
        distName: string;
        invoiceNo: string;
        date: string;
        excludeId?: number | null;
      }) => {
        const { startDate, endDate, fyLabel } = getIndianFinancialYear(params.date);
        const query = `
          SELECT p.id, p.invoice_no, p.date, p.total_amount, d.name as distributor_name
          FROM purchases p
          LEFT JOIN distributors d ON p.distributor_id = d.id
          WHERE (p.distributor_id = ? OR (d.name IS NOT NULL AND LOWER(TRIM(d.name)) = LOWER(TRIM(?))))
            AND LOWER(TRIM(p.invoice_no)) = LOWER(TRIM(?))
            AND substr(COALESCE(p.date, p.business_date, ''), 1, 10) >= ?
            AND substr(COALESCE(p.date, p.business_date, ''), 1, 10) <= ?
            ${params.excludeId ? 'AND p.id != ?' : ''}
          LIMIT 1
        `;
        const qParams = [
          params.distId,
          params.distName,
          params.invoiceNo.trim(),
          startDate,
          endDate,
          ...(params.excludeId ? [params.excludeId] : []),
        ];
        const row = await db.get(query, qParams);
        return { isDuplicate: !!row, fy: fyLabel, existing: row || null };
      };

      // 1. Same Distributor + Same Invoice + Same FY (different date in FY 2026-27, e.g. 2026-08-20) -> MUST BE DUPLICATE
      const result1 = await checkDuplicate({
        distId: distIdA,
        distName: distNameA,
        invoiceNo: testInvoiceNo,
        date: '2026-08-20',
      });
      assert.equal(result1.isDuplicate, true, 'Should detect duplicate in same financial year');
      assert.equal(result1.fy, '2026-27');
      assert.equal(result1.existing?.id, existingPurchaseId);

      // 2. Case-insensitive and trimmed Invoice No -> MUST BE DUPLICATE
      const result2 = await checkDuplicate({
        distId: distIdA,
        distName: distNameA,
        invoiceNo: `  ${testInvoiceNo.toLowerCase()}  `,
        date: '2026-09-01',
      });
      assert.equal(result2.isDuplicate, true, 'Should match case-insensitively with whitespace trimmed');

      // 3. Same Distributor + Same Invoice + DIFFERENT FY (e.g. 2025-10-10 -> FY 2025-26) -> ALLOWED (Not duplicate)
      const result3 = await checkDuplicate({
        distId: distIdA,
        distName: distNameA,
        invoiceNo: testInvoiceNo,
        date: '2025-10-10',
      });
      assert.equal(result3.isDuplicate, false, 'Should allow same invoice number in a different financial year');

      // 4. DIFFERENT Distributor (Distributor B) + Same Invoice + Same FY -> ALLOWED (Not duplicate)
      const result4 = await checkDuplicate({
        distId: distIdB,
        distName: distNameB,
        invoiceNo: testInvoiceNo,
        date: '2026-05-15',
      });
      assert.equal(result4.isDuplicate, false, 'Should allow same invoice number from a different distributor');

      // 5. Edit Mode: Same purchase bill updating itself (excludeId = existingPurchaseId) -> ALLOWED
      const result5 = await checkDuplicate({
        distId: distIdA,
        distName: distNameA,
        invoiceNo: testInvoiceNo,
        date: '2026-05-15',
        excludeId: existingPurchaseId,
      });
      assert.equal(result5.isDuplicate, false, 'Editing the existing purchase bill must not block itself');
    } finally {
      // Clean up test data
      await db.run('DELETE FROM purchases WHERE id = ?', [existingPurchaseId]);
      await db.run('DELETE FROM distributors WHERE id IN (?, ?)', [distIdA, distIdB]);
    }
  });
});
