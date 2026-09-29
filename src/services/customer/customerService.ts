import { dbManager } from '../../database/connection.js';
// import { logger } from '../../utils/logger.js';
import { formatCustomerName } from '../../utils/nameFormatter.js';
import { pricingService } from '../pricing/pricingService.js';

class CustomerService {
  /**
   * Get customer dashboard summary data
   */
  async getDashboardSummary(customerId: number) {
    const db = await dbManager.getConnection();

    // 1. Customer profile
    const customer = await db.get(
      `SELECT id, name, phone, address, credit_balance, credit_enabled 
       FROM customers WHERE id = ?`,
      [customerId]
    );

    if (!customer) {
      throw new Error('Customer record not found');
    }

    // 2. Active refills count
    const refillCountRow = await db.get(
      `SELECT COUNT(*) as count FROM patient_refills WHERE customer_id = ? AND is_active = 1`,
      [customerId]
    );

    // 3. Active refills preview
    const refills = await db.all(
      `SELECT pr.*, m.name as medicine_name, m.generic_name, 1 as item_count
       FROM patient_refills pr
       LEFT JOIN medicines m ON m.id = pr.medicine_id
       WHERE pr.customer_id = ? AND pr.is_active = 1
       ORDER BY pr.next_refill_date ASC LIMIT 5`,
      [customerId]
    );

    // 4. Recent bills (from sales_invoices)
    const bills = await db.all(
      `SELECT id, invoice_no, invoice_no as invoice_number, date, total_amount, payment_status, payment_medium, store_id
       FROM sales_invoices
       WHERE customer_id = ?
       ORDER BY date DESC LIMIT 5`,
      [customerId]
    );

    // 5. Recent orders (from special_orders)
    const orders = await db.all(
      `SELECT id, product, medicine_name, qty, status, priority, date, delivery_status, advance_payment
       FROM special_orders
       WHERE customer_id = ?
       ORDER BY date DESC LIMIT 5`,
      [customerId]
    );

    return {
      customer: {
        id: customer.id,
        name: formatCustomerName(customer.name),
        phone: customer.phone,
        address: customer.address || '',
        creditBalance: customer.credit_balance || 0
      },
      stats: {
        activeRefillsCount: refillCountRow?.count || 0,
        recentBillsCount: bills.length,
        recentOrdersCount: orders.length
      },
      refills,
      recentBills: bills,
      recentOrders: orders
    };
  }

  /**
   * Get customer's purchase bills with clean customer-facing fields
   */
  async getCustomerBills(customerId: number, limit = 50, offset = 0) {
    const db = await dbManager.getConnection();
    const bills = await db.all(
      `SELECT 
         id, invoice_no, invoice_no as invoice_number, date, subtotal, tax_amount, 
         discount, discount as discount_amount, 
         total_amount, payment_status, payment_medium, store_id
       FROM sales_invoices
       WHERE customer_id = ?
       ORDER BY date DESC LIMIT ? OFFSET ?`,
      [customerId, limit, offset]
    );

    return bills;
  }

  /**
   * Get single bill details with items (safe for customer view)
   */
  async getBillDetails(customerId: number, billId: number) {
    const db = await dbManager.getConnection();
    const invoice = await db.get(
      `SELECT id, invoice_no, invoice_no as invoice_number, date, subtotal, tax_amount, 
              discount, discount as discount_amount, 
              total_amount, payment_status, payment_medium, store_id
       FROM sales_invoices
       WHERE id = ? AND customer_id = ?`,
      [billId, customerId]
    );

    if (!invoice) return null;

    const items = await db.all(
      `SELECT 
         si.id, 
         COALESCE(im.medicine_id, 0) as medicine_id, 
         COALESCE(si.medicine_name_snapshot, m.name, 'Medicine') as medicine_name, 
         si.batch_no, 
         si.quantity, 
         si.unit_price, 
         si.discount_per, 
         ROUND(si.quantity * si.unit_price * (1 - COALESCE(si.discount_per, 0) / 100.0), 2) as total_amount
       FROM sale_items si
       LEFT JOIN inventory_master im ON im.id = si.inventory_id
       LEFT JOIN medicines m ON m.id = im.medicine_id
       WHERE si.invoice_id = ?`,
      [billId]
    );

    return {
      invoice,
      items
    };
  }

  /**
   * Load medicines from a previous bill for quick reordering with current catalog pricing
   */
  async getReorderMedicinesFromBill(_customerId: number, billId: number) {
    const db = await dbManager.getConnection();
    const items = await db.all(
      `SELECT 
         COALESCE(im.medicine_id, 0) as medicine_id, 
         COALESCE(si.medicine_name_snapshot, m.name, 'Medicine') as medicine_name, 
         COALESCE(si.mrp_snapshot, m.mrp, 0) as mrp, 
         m.packaging, 
         m.category,
         si.quantity as previous_quantity
       FROM sale_items si
       LEFT JOIN inventory_master im ON im.id = si.inventory_id
       LEFT JOIN medicines m ON m.id = im.medicine_id
       WHERE si.invoice_id = ?`,
      [billId]
    );

    // Filter out items without valid medicine_id
    const validItems = items.filter((item: any) => item.medicine_id && item.medicine_id > 0);

    // Reprice each item using current centralized pricing engine
    const currentItems = await Promise.all(
      validItems.map(async (item: any) => {
        const pricing = await pricingService.calculatePrice({
          mrp: item.mrp,
          category: item.category,
          medicineId: item.medicine_id
        });
        return {
          medicineId: item.medicine_id,
          name: item.medicine_name,
          quantity: item.previous_quantity || 1,
          mrp: item.mrp,
          currentSellingPrice: pricing.sellingPrice,
          discountPercent: pricing.discountPercent,
          packaging: item.packaging
        };
      })
    );

    return currentItems;
  }
}

export const customerService = new CustomerService();
