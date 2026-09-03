import { http } from './client';

export interface CustomerAuthResponse {
  token: string;
  customer: {
    id: number;
    name: string;
    phone: string;
    address: string;
    loginId: string;
    preferredStoreId: number;
    storeName: string;
  };
  features: {
    bills: boolean;
    refills: boolean;
    orders: boolean;
    catalog: boolean;
    prescriptions: boolean;
  };
}

export const authApi = {
  // Request WhatsApp OTP
  requestOtp: (phone: string) =>
    http.post<{ success: boolean; message: string; debugOtp?: string }>('/customer/auth/request-otp', { phone }),

  // Verify OTP
  verifyOtp: (phone: string, otp: string) =>
    http.post<CustomerAuthResponse>('/customer/auth/verify-otp', { phone, otp }),

  // Login with ID and PIN
  loginWithPin: (loginId: string, pin: string) =>
    http.post<CustomerAuthResponse>('/customer/auth/login', { loginId, pin }),

  // Heartbeat to maintain active session duration
  heartbeat: () =>
    http.post<{ durationSeconds: number }>('/customer/auth/heartbeat'),

  // Logout session
  logout: () =>
    http.post<{ durationSeconds: number; message: string }>('/customer/auth/logout'),
};
