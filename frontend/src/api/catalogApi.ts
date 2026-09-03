import { http } from './client';

export interface CatalogProduct {
  id: number;
  name: string;
  genericName?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
  category?: string | null;
  strength?: string | null;
  packaging?: string | null;
  dosageForm?: string | null;
  scheduleType?: string | null;
  prescriptionRequired: boolean;
  mrp: number;
  sellingPrice: number;
  discountPercent: number;
  availableStock: number;
  isInStock: boolean;
  imagePath?: string | null;
  thumbnailPath?: string | null;
  visibility: {
    website: boolean;
    whatsapp: boolean;
    portal: boolean;
    pos: boolean;
  };
}

export interface CatalogResponse {
  products: CatalogProduct[];
  total: number;
}

export const catalogApi = {
  // Fetch products for customer portal / website
  getCatalog: (params: { search?: string; category?: string; channel?: string; limit?: number; offset?: number }) =>
    http.get<CatalogResponse>('/customer/catalog', { params }),

  // Fetch single product details
  getProductById: (id: number) =>
    http.get<CatalogProduct>(`/customer/catalog/${id}`),

  // Admin catalog query
  getAdminCatalog: (params: { search?: string; category?: string; channel?: string; limit?: number; offset?: number }) =>
    http.get<CatalogResponse>('/admin/catalog', { params }),

  // Admin update channel visibility
  updateChannelVisibility: (id: number, visibility: Partial<CatalogProduct['visibility']> & { featuredRank?: number }) =>
    http.put<{ message: string }>(`/admin/catalog/${id}/visibility`, visibility),
};
