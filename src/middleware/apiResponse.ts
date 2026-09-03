import { Request, Response, NextFunction } from 'express';

export interface ApiResponseSuccess<T = any> {
  success: true;
  data: T;
  meta?: Record<string, any>;
}

export interface ApiResponseError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

export type ApiResponse<T = any> = ApiResponseSuccess<T> | ApiResponseError;

/**
 * Standard successful response sender
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: Record<string, any>
): Response {
  const body: ApiResponseSuccess<T> = {
    success: true,
    data,
    ...(meta ? { meta } : {})
  };
  return res.status(statusCode).json(body);
}

/**
 * Standard error response sender
 */
export function sendError(
  res: Response,
  code: string,
  message: string,
  statusCode = 400,
  details?: any
): Response {
  const body: ApiResponseError = {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  };
  return res.status(statusCode).json(body);
}

/**
 * Centralized API error middleware for uncaught route exceptions
 */
export function apiErrorMiddleware(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): Response | void {
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.status || err.statusCode || 500;
  const code = err.code || 'INTERNAL_SERVER_ERROR';
  const message = err.message || 'An unexpected error occurred';

  console.error(`[ApiError] ${req.method} ${req.originalUrl}:`, err);

  return sendError(res, code, message, statusCode, process.env.NODE_ENV !== 'production' ? err.stack : undefined);
}
