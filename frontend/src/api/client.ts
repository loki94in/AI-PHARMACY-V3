import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';

const API_URL = '/api';

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach store ID, owner token, or portal token if present
apiClient.interceptors.request.use((config) => {
  try {
    const activeStoreId = localStorage.getItem('active_store_id') || '1';
    if (config.headers) {
      config.headers['x-store-id'] = activeStoreId;
      const ownerToken = localStorage.getItem('pharmacy_owner_token');
      const portalToken = localStorage.getItem('customer_portal_token');
      const token = ownerToken || portalToken;
      if (token && !config.headers['Authorization']) {
        config.headers['Authorization'] = `Bearer ${token}`;
      }
    }
  } catch (_) {}
  return config;
});

// Response interceptor: handle 401 for remote owner sessions
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || '';
      if (!url.includes('/auth/login') && !url.includes('/auth/session') && !url.includes('/customer-portal/login')) {
        const isLocalHost = typeof window !== 'undefined' && (
          window.location.hostname === 'localhost' ||
          window.location.hostname === '127.0.0.1'
        );
        if (!isLocalHost) {
          localStorage.removeItem('pharmacy_owner_token');
          if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/owner/login') && !window.location.pathname.startsWith('/portal')) {
            const current = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = `/owner/login?next=${current}`;
          }
        }
      }
    }
    return Promise.reject(error);
  }
);

// Response interceptor: automatically unpack standard API response envelope { success: true, data }
export interface StandardApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export async function request<T = any>(config: AxiosRequestConfig): Promise<T> {
  const response: AxiosResponse<any> = await apiClient(config);
  // If response matches standardized envelope, return data payload directly
  if (response.data && typeof response.data === 'object' && 'success' in response.data) {
    if (response.data.success && 'data' in response.data) {
      return response.data.data as T;
    }
    if (!response.data.success && response.data.error) {
      throw new Error(response.data.error.message || 'API request failed');
    }
  }
  return response.data as T;
}

export const http = {
  get: <T = any>(url: string, config?: AxiosRequestConfig) => request<T>({ ...config, method: 'GET', url }),
  post: <T = any>(url: string, data?: any, config?: AxiosRequestConfig) => request<T>({ ...config, method: 'POST', url, data }),
  put: <T = any>(url: string, data?: any, config?: AxiosRequestConfig) => request<T>({ ...config, method: 'PUT', url, data }),
  delete: <T = any>(url: string, config?: AxiosRequestConfig) => request<T>({ ...config, method: 'DELETE', url }),
};
