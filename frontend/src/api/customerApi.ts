import { http } from './client';

export interface CustomerDashboardSummary {
  customer: {
    id: number;
    name: string;
    phone: string;
    address: string;
    creditBalance: number;
  };
  stats: {
    activeRefillsCount: number;
    recentBillsCount: number;
    recentOrdersCount: number;
  };
  refills: any[];
  recentBills: any[];
  recentOrders: any[];
}

export const customerApi = {
  // Customer dashboard summary
  getDashboard: () =>
    http.get<CustomerDashboardSummary>('/customer/dashboard'),

  // Customer bills
  getBills: (params?: { limit?: number; offset?: number }) =>
    http.get<{ bills: any[] }>('/customer/bills', { params }),

  // Single bill detail
  getBillDetails: (id: number) =>
    http.get<{ invoice: any; items: any[] }>(`/customer/bills/${id}`),

  // Load previous items for quick reorder
  getReorderItems: (billId: number) =>
    http.get<{ items: any[] }>(`/customer/bills/${billId}/reorder`),
};
