import { Database } from 'sqlite';

// Sale bill money: prices are MRP-based and GST-INCLUSIVE. The bill total is
// round(subtotal - bill discount); GST is extracted from each line, never added on top.
// Shared by POS save (POST /sales), sale edit (PUT /sales/:id) and the Investigation
// sale correction (via services/saleBillEditService.ts) so every path totals the same way.

export interface GstItemBreakdown {
  item: any;
  cgst_value: number;
  sgst_value: number;
  cgst_per: number;
  sgst_per: number;
}

export const calculateSalesGstAndTotals = async (
  db: Database,
  items: any[],
  discount: number
) => {
  let subtotal = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  const itemTaxBreakdowns: GstItemBreakdown[] = [];

  const missingInventoryIds = items
    .filter(item => {
      const c = Number(item.cgst_per !== undefined ? item.cgst_per : (item.cgst !== undefined ? item.cgst : NaN));
      const s = Number(item.sgst_per !== undefined ? item.sgst_per : (item.sgst !== undefined ? item.sgst : NaN));
      return (isNaN(c) || isNaN(s) || (c === 0 && s === 0)) && item.inventory_id;
    })
    .map(item => item.inventory_id);

  const medTaxMap = new Map<number, { cgst_per: number; sgst_per: number }>();
  if (missingInventoryIds.length > 0) {
    const placeholders = missingInventoryIds.map(() => '?').join(',');
    const rows = await db.all(
      `SELECT im.id as inventory_id, m.cgst_per, m.sgst_per,
              (SELECT pi.cgst_per FROM purchase_items pi WHERE pi.medicine_id = im.medicine_id AND pi.batch_no = im.batch_no ORDER BY pi.id DESC LIMIT 1) AS pur_cgst,
              (SELECT pi.sgst_per FROM purchase_items pi WHERE pi.medicine_id = im.medicine_id AND pi.batch_no = im.batch_no ORDER BY pi.id DESC LIMIT 1) AS pur_sgst
       FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE im.id IN (${placeholders})`,
      missingInventoryIds
    );
    for (const r of rows) {
      // The purchase line of the same batch is the real GST rate (a 0% there is a real 0%);
      // the medicine master rate is only used when the batch has no purchase line.
      const hasPurchaseRate = r.pur_cgst !== null && r.pur_cgst !== undefined && r.pur_sgst !== null && r.pur_sgst !== undefined;
      medTaxMap.set(r.inventory_id, hasPurchaseRate
        ? { cgst_per: r.pur_cgst, sgst_per: r.pur_sgst }
        : { cgst_per: r.cgst_per, sgst_per: r.sgst_per });
    }
  }

  const lines = items.map(item => {
    const { quantity = 0, unit_price = 0, loose_qty = 0, pack_size = 1, discount_per = 0 } = item;
    const pSize = Math.max(1, Number(pack_size || 1));
    const d = Number(discount_per || item.discountPer || 0);
    const dPrice = Number(unit_price) * (1 - d / 100);
    const lineGross = (Number(quantity) * dPrice) + (Number(loose_qty) * (dPrice / pSize));
    subtotal += lineGross;
    return { item, lineGross };
  });

  // The bill discount lowers the taxable value of every line pro rata (checked against 15,203
  // migrated retailer bills: GST matches only when it is scaled this way).
  const discountFactor = subtotal > 0 ? Math.max(0, subtotal - Number(discount)) / subtotal : 1;

  for (const { item, lineGross: gross } of lines) {
    const inventory_id = item.inventory_id;
    const lineGross = gross * discountFactor;

    let cgstPer = Number(item.cgst_per !== undefined ? item.cgst_per : (item.cgst !== undefined ? item.cgst : NaN));
    let sgstPer = Number(item.sgst_per !== undefined ? item.sgst_per : (item.sgst !== undefined ? item.sgst : NaN));

    if ((isNaN(cgstPer) || isNaN(sgstPer) || (cgstPer === 0 && sgstPer === 0)) && inventory_id) {
      const medTax = medTaxMap.get(inventory_id);
      if (medTax) {
        if (isNaN(cgstPer) || cgstPer === 0) cgstPer = Number(medTax.cgst_per) || 0;
        if (isNaN(sgstPer) || sgstPer === 0) sgstPer = Number(medTax.sgst_per) || 0;
      }
    }

    // No invented rate: unknown GST stays 0, and a real 0% (exempt) line stays 0%.
    if (isNaN(cgstPer)) cgstPer = 0;
    if (isNaN(sgstPer)) sgstPer = 0;

    const gstRate = cgstPer + sgstPer;
    const taxable = gstRate > 0 ? (lineGross / (1 + (gstRate / 100))) : lineGross;
    const lineTax = lineGross - taxable;
    const cgst_value = Number(((lineTax * cgstPer) / (gstRate || 1)).toFixed(2));
    const sgst_value = Number(((lineTax * sgstPer) / (gstRate || 1)).toFixed(2));

    totalCgst += cgst_value;
    totalSgst += sgst_value;

    itemTaxBreakdowns.push({
      item,
      cgst_value,
      sgst_value,
      cgst_per: cgstPer,
      sgst_per: sgstPer
    });
  }

  const roundedCgst = Number(totalCgst.toFixed(2));
  const roundedSgst = Number(totalSgst.toFixed(2));
  const total = Math.round(subtotal - Number(discount));
  const tax = Number((roundedCgst + roundedSgst).toFixed(2));
  const roff = Number((total - (subtotal - Number(discount))).toFixed(2));

  return {
    subtotal,
    total,
    tax,
    roff,
    totalCgst: roundedCgst,
    totalSgst: roundedSgst,
    itemTaxBreakdowns
  };
};
