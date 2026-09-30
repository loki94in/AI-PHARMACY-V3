import type { Request, Response, NextFunction } from 'express';
import { dbManager, requestTxStorage, type RequestTxContext } from '../database/connection.js';

/**
 * Safety net for a route that answers without COMMIT/ROLLBACK after BEGIN (an early
 * `return res.status(...)`). The shared connection would stay inside that transaction; other
 * requests' writes would join it and the 60 s watchdog would later roll ALL of them back,
 * so a bill the user deleted came back and saved work vanished. As soon as this request's
 * response is done, any transaction it opened before answering is rolled back and the lock
 * is freed. Routes must still ROLLBACK themselves; this only limits the damage.
 */
export function requestTransactionGuard(req: Request, res: Response, next: NextFunction) {
  const ctx: RequestTxContext = { responded: false };
  const originalEnd = res.end;
  res.end = function (this: Response, ...args: any[]) {
    ctx.responded = true;
    return (originalEnd as any).apply(this, args);
  } as Response['end'];
  const settle = () => {
    dbManager.closeOrphanTransaction(ctx, `${req.method} ${req.originalUrl}`).catch(() => {});
  };
  res.once('finish', settle);
  res.once('close', settle);
  requestTxStorage.run(ctx, () => next());
}
