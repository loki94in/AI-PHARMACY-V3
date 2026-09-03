import express, { Request, Response, NextFunction } from 'express';
import { customerAuthService } from '../../services/auth/customerAuthService.js';
import { customerService } from '../../services/customer/customerService.js';
import { catalogService } from '../../services/catalog/catalogService.js';
import { sendSuccess, sendError } from '../../middleware/apiResponse.js';

const router = express.Router();

export interface CustomerAuthRequest extends Request {
  customer?: {
    customerId: number;
    phone: string;
  };
}

/**
 * Authentication middleware for customer portal routes
 */
export async function requireCustomerAuth(req: CustomerAuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (req.query.token as string);

  if (!token) {
    return sendError(res, 'UNAUTHORIZED', 'Authentication token required', 401);
  }

  const session = await customerAuthService.verifySession(token);
  if (!session) {
    return sendError(res, 'INVALID_TOKEN', 'Session expired or invalid token', 401);
  }

  req.customer = session;
  next();
}

// ─── Customer Auth Endpoints ──────────────────────────────────────────────────

router.post('/auth/request-otp', async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    const result = await customerAuthService.requestOtp(phone);
    return sendSuccess(res, result);
  } catch (err: any) {
    return sendError(res, 'OTP_REQUEST_FAILED', err.message || 'Failed to send OTP', 400);
  }
});

router.post('/auth/verify-otp', async (req: Request, res: Response) => {
  try {
    const { phone, otp } = req.body;
    const clientIp = req.ip;
    const userAgent = req.headers['user-agent'];
    const result = await customerAuthService.verifyOtp(phone, otp, { ip: clientIp, userAgent });
    return sendSuccess(res, result);
  } catch (err: any) {
    return sendError(res, 'OTP_VERIFICATION_FAILED', err.message || 'Failed to verify OTP', 400);
  }
});

router.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { loginId, pin } = req.body;
    const clientIp = req.ip;
    const userAgent = req.headers['user-agent'];
    const result = await customerAuthService.loginWithPin(loginId, pin, { ip: clientIp, userAgent });
    return sendSuccess(res, result);
  } catch (err: any) {
    return sendError(res, 'LOGIN_FAILED', err.message || 'Invalid login credentials', 401);
  }
});

router.post('/auth/heartbeat', requireCustomerAuth, async (req: CustomerAuthRequest, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (req.query.token as string);
    if (!token) return sendError(res, 'UNAUTHORIZED', 'Session token missing', 401);

    const result = await customerAuthService.recordHeartbeat(token);
    return sendSuccess(res, result);
  } catch (err: any) {
    return sendError(res, 'HEARTBEAT_FAILED', err.message || 'Failed to update heartbeat', 500);
  }
});

router.post('/auth/logout', requireCustomerAuth, async (req: CustomerAuthRequest, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (req.query.token as string);
    if (!token) return sendError(res, 'UNAUTHORIZED', 'Session token missing', 401);

    const result = await customerAuthService.logoutSession(token);
    return sendSuccess(res, { ...result, message: 'Logged out successfully' });
  } catch (err: any) {
    return sendError(res, 'LOGOUT_FAILED', err.message || 'Failed to logout session', 500);
  }
});

// ─── Customer Portal Data Endpoints ──────────────────────────────────────────

router.get('/dashboard', requireCustomerAuth, async (req: CustomerAuthRequest, res: Response) => {
  try {
    const customerId = req.customer!.customerId;
    const summary = await customerService.getDashboardSummary(customerId);
    return sendSuccess(res, summary);
  } catch (err: any) {
    return sendError(res, 'DASHBOARD_ERROR', err.message || 'Failed to load dashboard', 500);
  }
});

router.get('/catalog', async (req: Request, res: Response) => {
  try {
    const { search, category, inStockOnly, limit, offset, storeId } = req.query;
    const result = await catalogService.getCatalog({
      search: search as string,
      category: category as string,
      channel: 'portal',
      inStockOnly: inStockOnly === 'true',
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
      storeId: storeId ? parseInt(storeId as string, 10) : 1
    });
    return sendSuccess(res, result);
  } catch (err: any) {
    return sendError(res, 'CATALOG_ERROR', err.message || 'Failed to load catalog', 500);
  }
});

router.get('/catalog/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const storeId = req.query.storeId ? parseInt(req.query.storeId as string, 10) : 1;
    const product = await catalogService.getProductById(id, storeId);
    if (!product) {
      return sendError(res, 'PRODUCT_NOT_FOUND', 'Product not found', 404);
    }
    return sendSuccess(res, product);
  } catch (err: any) {
    return sendError(res, 'PRODUCT_ERROR', err.message || 'Failed to load product', 500);
  }
});

router.get('/bills', requireCustomerAuth, async (req: CustomerAuthRequest, res: Response) => {
  try {
    const customerId = req.customer!.customerId;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const bills = await customerService.getCustomerBills(customerId, limit, offset);
    return sendSuccess(res, { bills });
  } catch (err: any) {
    return sendError(res, 'BILLS_ERROR', err.message || 'Failed to load bills', 500);
  }
});

router.get('/bills/:id', requireCustomerAuth, async (req: CustomerAuthRequest, res: Response) => {
  try {
    const customerId = req.customer!.customerId;
    const billId = parseInt(String(req.params.id), 10);
    const details = await customerService.getBillDetails(customerId, billId);
    if (!details) {
      return sendError(res, 'BILL_NOT_FOUND', 'Invoice not found', 404);
    }
    return sendSuccess(res, details);
  } catch (err: any) {
    return sendError(res, 'BILL_DETAILS_ERROR', err.message || 'Failed to load bill details', 500);
  }
});

router.get('/bills/:id/reorder', requireCustomerAuth, async (req: CustomerAuthRequest, res: Response) => {
  try {
    const customerId = req.customer!.customerId;
    const billId = parseInt(String(req.params.id), 10);
    const items = await customerService.getReorderMedicinesFromBill(customerId, billId);
    return sendSuccess(res, { items });
  } catch (err: any) {
    return sendError(res, 'REORDER_ERROR', err.message || 'Failed to load reorder items', 500);
  }
});

export default router;
