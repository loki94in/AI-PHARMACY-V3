import { eventService } from './eventService.js';
import { activityTracker } from '../utils/activityTracker.js';

export interface CartReservationItem {
  inventoryId: number;
  quantity: number;
  medicineName?: string;
}

export interface ActiveReservation {
  terminalId: string;
  terminalName: string;
  inventoryId: number;
  quantity: number;
  medicineName?: string;
  updatedAt: number;
  expiresAt: number;
}

const RESERVATION_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

class CartReservationService {
  // Map<inventoryId, Map<terminalId, ActiveReservation>>
  private reservations: Map<number, Map<string, ActiveReservation>> = new Map();
  // Map<terminalId, Set<inventoryId>> for fast cleanup per terminal
  private terminalItems: Map<string, Set<number>> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  private ensureTimer(): void {
    if (this.cleanupTimer || this.terminalItems.size === 0) return;
    this.cleanupTimer = setInterval(() => {
      // P3 Gated Workers: Skip heavy sweeps if shop is idle and no reservations exist
      if (activityTracker.isIdle() && this.terminalItems.size === 0) {
        if (this.cleanupTimer) {
          clearInterval(this.cleanupTimer);
          this.cleanupTimer = null;
        }
        return;
      }
      this.cleanupExpired();
      if (this.terminalItems.size === 0 && this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
    }, 30000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Update active cart reservations for a specific terminal
   */
  public setTerminalReservations(
    terminalId: string,
    terminalName: string,
    items: CartReservationItem[]
  ): void {
    if (!terminalId) return;

    const now = Date.now();
    const expiresAt = now + RESERVATION_TTL_MS;

    // 1. Clear previous items for this terminal
    this.clearTerminalInternal(terminalId);

    // 2. Set new items
    if (Array.isArray(items) && items.length > 0) {
      const activeIds = new Set<number>();
      for (const item of items) {
        const invId = Number(item.inventoryId);
        const qty = Number(item.quantity) || 0;
        if (!invId || qty <= 0) continue;

        if (!this.reservations.has(invId)) {
          this.reservations.set(invId, new Map());
        }

        const invMap = this.reservations.get(invId)!;
        invMap.set(terminalId, {
          terminalId,
          terminalName: terminalName || 'Counter',
          inventoryId: invId,
          quantity: qty,
          medicineName: item.medicineName,
          updatedAt: now,
          expiresAt,
        });

        activeIds.add(invId);
      }

      if (activeIds.size > 0) {
        this.terminalItems.set(terminalId, activeIds);
        this.ensureTimer();
      }
    }

    this.notifyChanged();
  }

  /**
   * Release all reservations held by a terminal (e.g. sale completed or cart cleared)
   */
  public releaseTerminal(terminalId: string): void {
    if (!terminalId) return;
    const removed = this.clearTerminalInternal(terminalId);
    if (removed) {
      this.notifyChanged();
    }
  }

  /**
   * Internal removal without SSE notification
   */
  private clearTerminalInternal(terminalId: string): boolean {
    const existingIds = this.terminalItems.get(terminalId);
    if (!existingIds || existingIds.size === 0) {
      this.terminalItems.delete(terminalId);
      return false;
    }

    for (const invId of existingIds) {
      const invMap = this.reservations.get(invId);
      if (invMap) {
        invMap.delete(terminalId);
        if (invMap.size === 0) {
          this.reservations.delete(invId);
        }
      }
    }

    this.terminalItems.delete(terminalId);
    return true;
  }

  /**
   * Get all active reservations grouped by inventory ID
   */
  public getAllReservations(): Record<number, ActiveReservation[]> {
    const now = Date.now();
    const result: Record<number, ActiveReservation[]> = {};

    for (const [invId, invMap] of this.reservations.entries()) {
      const activeList: ActiveReservation[] = [];
      for (const res of invMap.values()) {
        if (res.expiresAt > now) {
          activeList.push(res);
        }
      }
      if (activeList.length > 0) {
        result[invId] = activeList;
      }
    }

    return result;
  }

  /**
   * Check if a specific inventory item is reserved by other terminals
   */
  public getReservationsByOthers(
    inventoryId: number,
    currentTerminalId: string
  ): ActiveReservation[] {
    const invMap = this.reservations.get(inventoryId);
    if (!invMap) return [];

    const now = Date.now();
    const result: ActiveReservation[] = [];

    for (const [tId, res] of invMap.entries()) {
      if (tId !== currentTerminalId && res.expiresAt > now) {
        result.push(res);
      }
    }

    return result;
  }

  /**
   * Purge expired reservations
   */
  public cleanupExpired(): void {
    const now = Date.now();
    let changed = false;

    for (const [invId, invMap] of this.reservations.entries()) {
      for (const [tId, res] of invMap.entries()) {
        if (res.expiresAt <= now) {
          invMap.delete(tId);
          changed = true;
          const tSet = this.terminalItems.get(tId);
          if (tSet) {
            tSet.delete(invId);
            if (tSet.size === 0) this.terminalItems.delete(tId);
          }
        }
      }
      if (invMap.size === 0) {
        this.reservations.delete(invId);
      }
    }

    if (changed) {
      this.notifyChanged();
    }
  }

  private notifyChanged(): void {
    try {
      eventService.broadcast('cart_reservations_changed', {
        timestamp: Date.now(),
        count: this.reservations.size,
      });
    } catch (_) {}
  }
}

export const cartReservationService = new CartReservationService();
