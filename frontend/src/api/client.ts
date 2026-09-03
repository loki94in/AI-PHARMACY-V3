import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';

const API_URL = '/api';

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach store ID and portal token if present
apiClient.interceptors.request.use((config) => {
  try {
    const activeStoreId = localStorage.getItem('active_store_id') || '1';
    if (config.headers) {
      config.headers['x-store-id'] = activeStoreId;
      const portalToken = localStorage.getItem('customer_portal_token');
      if (portalToken && !config.headers['Authorization']) {
        config.headers['Authorization'] = `Bearer ${portalToken}`;
      }
    }
  } catch (_) {}
  return config;
});

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
