import fs from 'fs';
import path from 'path';
import { getPuppeteer } from '../utils/lazyPuppeteer.js';
import { dbManager } from '../database/connection.js';
import { getAppDataDir } from '../config/index.js';
import {
  findChromePath,
  copyProfileFolder,
  getCommonHeadlessChromiumArgs,
  killOrphanChromeProcesses,
  cleanTempProfileFolders,
  cleanProfileLockFiles,
  trackHeadless,
  untrackHeadless,
  isShutdownInProgress
} from '../utils/chromeBrowser.js';
import { syncPharmarackOrders } from './pharmarackOrderSyncService.js';

export interface CheckoutResultItem {
  storeId?: number;
  storeName: string;
  orderNo?: string;
  status: 'placed' | 'failed' | 'skipped';
  error?: string;
}

export interface CheckoutExecutionResult {
  ok: boolean;
  placedCount: number;
  failedCount: number;
  orders: CheckoutResultItem[];
  error?: string;
}

// Single-flight checkout mutex
let checkoutPromise: Promise<CheckoutExecutionResult> | null = null;

export class PharmarackCheckoutService {
  private static instance: PharmarackCheckoutService;

  private constructor() {}

  public static getInstance(): PharmarackCheckoutService {
    if (!PharmarackCheckoutService.instance) {
      PharmarackCheckoutService.instance = new PharmarackCheckoutService();
    }
    return PharmarackCheckoutService.instance;
  }

  /**
   * Places official orders on https://retailers.pharmarack.com/cart using the authenticated session profile.
   * Single-flight execution prevents concurrent browser instances.
   */
  public async executeCartCheckout(targetStoreNames?: string[]): Promise<CheckoutExecutionResult> {
    if (checkoutPromise) {
      console.log('[PharmarackCheckout] Checkout already in flight. Awaiting existing run...');
      return checkoutPromise;
    }

    checkoutPromise = this.runCheckoutInternal(targetStoreNames).finally(() => {
      checkoutPromise = null;
    });

    return checkoutPromise;
  }

  private async runCheckoutInternal(targetStoreNames?: string[]): Promise<CheckoutExecutionResult> {
    if (isShutdownInProgress()) {
      return { ok: false, placedCount: 0, failedCount: 0, orders: [], error: 'Application shutdown in progress' };
    }

    const chromePath = findChromePath();
    if (!chromePath) {
      return { ok: false, placedCount: 0, failedCount: 0, orders: [], error: 'Google Chrome was not found on your system.' };
    }

    const mainProfilePath = path.resolve(getAppDataDir(), 'data', 'pharmarack_profile');
    if (!fs.existsSync(mainProfilePath)) {
      return { ok: false, placedCount: 0, failedCount: 0, orders: [], error: 'No active Pharmarack profile found. Please log in first.' };
    }

    let browser: any = null;
    let headlessTrackId: string | null = null;
    let tempProfilePathToDelete = '';
    const puppeteer = await getPuppeteer();
    const results: CheckoutResultItem[] = [];

    try {
      console.log('[PharmarackCheckout] Preparing Chrome profile for automated cart checkout...');
      await killOrphanChromeProcesses('pharmarack_profile');
      cleanTempProfileFolders();

      try {
        cleanProfileLockFiles(mainProfilePath);
        browser = await puppeteer.launch({
          executablePath: chromePath,
          headless: true,
          userDataDir: mainProfilePath,
          args: getCommonHeadlessChromiumArgs([
            '--no-zygote',
            '--js-flags=--max-old-space-size=256',
            '--window-position=-10000,-10000'
          ])
        });
        headlessTrackId = trackHeadless(browser, 'pharmarack_checkout_main');
      } catch (launchErr: any) {
        if (isShutdownInProgress()) {
          return { ok: false, placedCount: 0, failedCount: 0, orders: [], error: 'Application shutting down' };
        }
        console.log('[PharmarackCheckout] Main profile locked, falling back to temp profile copy...', launchErr.message);
        const randomSuffix = Math.floor(Math.random() * 1000000);
        const tempProfilePath = path.resolve(getAppDataDir(), 'data', `pharmarack_profile_checkout_${Date.now()}_${randomSuffix}`);
        await copyProfileFolder(mainProfilePath, tempProfilePath, '[PharmarackCheckout]');
        cleanProfileLockFiles(tempProfilePath);

        browser = await puppeteer.launch({
          executablePath: chromePath,
          headless: true,
          userDataDir: tempProfilePath,
          args: getCommonHeadlessChromiumArgs([
            '--no-zygote',
            '--js-flags=--max-old-space-size=256',
            '--window-position=-10000,-10000'
          ])
        });
        headlessTrackId = trackHeadless(browser, 'pharmarack_checkout_temp');
        tempProfilePathToDelete = tempProfilePath;
      }

      const [page] = await browser.pages();
      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(15000);

      // Captured order IDs from network API responses during checkout
      const networkOrderNos = new Set<string>();

      page.on('response', async (response: any) => {
        try {
          const url = response.url();
          if (url.includes('/order') || url.includes('/cart') || url.includes('Order') || url.includes('checkout') || url.includes('Checkout') || url.includes('retailer')) {
            const status = response.status();
            if (status >= 200 && status < 300) {
              const text = await response.text().catch(() => '');
              if (text) {
                const matches = text.match(/"(?:OrderNo|orderNo|OrderId|orderId|po_number|poNumber|OrderNumber)"\s*:\s*"?([A-Za-z0-9_-]+)"?/gi);
                if (matches) {
                  for (const m of matches) {
                    const cleanNo = m.replace(/"(?:OrderNo|orderNo|OrderId|orderId|po_number|poNumber|OrderNumber)"\s*:\s*"?/i, '').replace(/"?$/, '').trim();
                    if (cleanNo && cleanNo !== '0' && cleanNo.toLowerCase() !== 'null' && cleanNo.length >= 3) {
                      networkOrderNos.add(cleanNo);
                      console.log('[PharmarackCheckout] Captured official Order ID from network response:', cleanNo);
                    }
                  }
                }
              }
            }
          }
        } catch (_) {}
      });

      console.log('[PharmarackCheckout] Navigating to https://retailers.pharmarack.com/cart ...');
      await page.goto('https://retailers.pharmarack.com/cart', { waitUntil: 'domcontentloaded', timeout: 35000 });

      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/auth') || currentUrl.includes('/signin')) {
        console.warn('[PharmarackCheckout] Session expired: Redirected to login page.');
        const db = await dbManager.getConnection();
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_status', 'expired')").catch(() => {});
        return {
          ok: false,
          placedCount: 0,
          failedCount: 0,
          orders: [],
          error: 'Pharmarack session expired. Please re-authenticate via Settings > External Integrations.'
        };
      }

      // Wait 10-12s buffer for dynamic Angular SPA to finish loading GetUserCartDetails & rendering cards
      console.log('[PharmarackCheckout] Waiting 10-12s for Pharmarack cart page SPA hydration and network calls...');
      const hydrationStart = Date.now();
      while (Date.now() - hydrationStart < 12000) {
        const isReady = await page.evaluate(() => {
          const hasCards = document.querySelectorAll(
            '.distributor-card, .supplier-card, .store-card, .card, [class*="distributor"], [class*="supplier"], [class*="store"], .cart-item-group, .accordion-item, .panel, tbody tr'
          ).length > 0;
          const hasButtons = Array.from(document.querySelectorAll('button, [role="button"], a[role="button"]')).some(b => {
            const txt = (b.textContent || '').trim().toLowerCase();
            return txt.includes('place order') || txt.includes('confirm order') || txt.includes('checkout') || txt.includes('order now');
          });
          const isEmpty = (document.body.innerText || '').toLowerCase().includes('cart is empty');
          return (hasCards && hasButtons) || isEmpty;
        }).catch(() => false);

        if (isReady && (Date.now() - hydrationStart >= 8000)) {
          // If elements are rendered and at least 8s have elapsed, proceed
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
      }

      // Attempt to identify distributor cards and trigger official "Place Order" actions
      const checkoutExecution = await page.evaluate(async (targetNames: string[] | null) => {
        const logs: string[] = [];
        const placedStores: string[] = [];
        const failedStores: { name: string; error: string }[] = [];

        const normalizeStr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
        const matchesTargetStore = (candidateName: string, targets: string[]): boolean => {
          const normCand = normalizeStr(candidateName);
          const stopWords = new Set(['pvt', 'ltd', 'pharmaceuticals', 'distributors', 'agencies', 'enterprise', 'pharma', 'medical', 'distributor', 'agency']);
          const candTokens = normCand.split(' ').filter(w => w.length > 2 && !stopWords.has(w));

          return targets.some(t => {
            const normT = normalizeStr(t);
            if (normCand.includes(normT) || normT.includes(normCand)) return true;
            const tTokens = normT.split(' ').filter(w => w.length > 2 && !stopWords.has(w));
            if (candTokens.length > 0 && tTokens.length > 0) {
              return candTokens.some(ct => tTokens.includes(ct));
            }
            return false;
          });
        };

        // 1. Sync distributor checkboxes on https://retailers.pharmarack.com/cart if targetNames provided
        if (targetNames && targetNames.length > 0) {
          try {
            const potentialSections = Array.from(document.querySelectorAll(
              '.distributor-card, .supplier-card, .store-card, .card, [class*="distributor"], [class*="supplier"], [class*="store"], .cart-item-group, .accordion-item, .panel'
            )) as HTMLElement[];

            for (const section of potentialSections) {
              const headerEl = section.querySelector('h1, h2, h3, h4, h5, .store-name, .distributor-name, [class*="store"], [class*="distributor"], [class*="supplier-name"]');
              if (!headerEl || !headerEl.textContent) continue;
              const cardName = headerEl.textContent.trim();
              if (cardName.length < 3 || cardName.toLowerCase().includes('cart') || cardName.toLowerCase().includes('total')) continue;

              const shouldBeSelected = matchesTargetStore(cardName, targetNames);

              // Locate checkbox associated with this distributor section
              const chk = section.querySelector('input[type="checkbox"], [role="checkbox"], .ant-checkbox-input, .mat-checkbox-input') as HTMLInputElement | null;
              if (chk) {
                const isChecked = chk.checked || chk.getAttribute('aria-checked') === 'true' || chk.closest('.ant-checkbox-checked') !== null || chk.closest('.mat-checkbox-checked') !== null;
                if (shouldBeSelected && !isChecked) {
                  chk.scrollIntoView({ behavior: 'instant', block: 'center' });
                  chk.click();
                  logs.push(`Checked distributor checkbox on Pharmarack: ${cardName}`);
                  await new Promise(r => setTimeout(r, 400));
                } else if (!shouldBeSelected && isChecked) {
                  chk.scrollIntoView({ behavior: 'instant', block: 'center' });
                  chk.click();
                  logs.push(`Unchecked distributor checkbox on Pharmarack: ${cardName}`);
                  await new Promise(r => setTimeout(r, 400));
                }
              }
            }
          } catch (syncErr: any) {
            logs.push(`Distributor checkbox sync warning: ${syncErr?.message || syncErr}`);
          }
        }

        // Search for all buttons on the cart page that indicate checkout/order placement
        const allButtons = Array.from(document.querySelectorAll(
          'button, [role="button"], a[role="button"], input[type="button"], input[type="submit"], .btn, .ant-btn, .mat-button, .mat-raised-button, [class*="checkout"], [class*="place-order"]'
        )) as HTMLElement[];

        const placeOrderButtons = allButtons.filter(b => {
          const txt = (b.innerText || b.textContent || (b as HTMLInputElement).value || '').trim().toLowerCase();
          const isActionText = (
            txt.includes('place order') ||
            txt.includes('confirm order') ||
            txt.includes('checkout') ||
            txt.includes('order now') ||
            txt.includes('review & place') ||
            txt.includes('proceed to buy')
          );
          if (!isActionText) return false;
          try {
            const style = window.getComputedStyle(b);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          } catch (_) {
            return true;
          }
        });

        logs.push(`Found ${placeOrderButtons.length} potential place order button(s) on cart page.`);

        if (placeOrderButtons.length === 0) {
          // Check if cart is already empty or no items
          const bodyText = (document.body.innerText || '').toLowerCase();
          if (bodyText.includes('cart is empty') || bodyText.includes('no item') || bodyText.includes('no product')) {
            return { emptyCart: true, logs, placedStores, failedStores };
          }
          return { noButtons: true, logs, placedStores, failedStores };
        }

        for (const btn of placeOrderButtons) {
          try {
            // Find parent store name if possible
            let storeName = 'Distributor';
            let container: HTMLElement | null = btn;
            for (let i = 0; i < 7; i++) {
              if (!container) break;
              const headerEl = container.querySelector('h1, h2, h3, h4, h5, .store-name, .distributor-name, [class*="store"], [class*="distributor"]');
              if (headerEl && headerEl.textContent) {
                const cand = headerEl.textContent.trim();
                if (cand.length > 2 && !cand.toLowerCase().includes('cart') && !cand.toLowerCase().includes('order') && !cand.toLowerCase().includes('checkout')) {
                  storeName = cand;
                  break;
                }
              }
              container = container.parentElement;
            }

            // If target store names filter provided, check match
            if (targetNames && targetNames.length > 0) {
              const isMatch = matchesTargetStore(storeName, targetNames);
              // If it's a store-specific button and doesn't match target, skip it
              if (storeName !== 'Distributor' && !isMatch) {
                logs.push(`Skipped non-target store Place Order button: ${storeName}`);
                continue;
              }
            }

            // Click the Place Order button
            btn.scrollIntoView({ behavior: 'instant', block: 'center' });
            if ((btn as any).disabled) {
              (btn as any).disabled = false;
            }
            btn.click();
            logs.push(`Clicked Place Order for store: ${storeName}`);

            // Brief delay to allow confirmation dialog to appear if any
            for (let waitStep = 0; waitStep < 6; waitStep++) {
              await new Promise(r => setTimeout(r, 600));
              const modalButtons = Array.from(document.querySelectorAll(
                '.modal button, [role="dialog"] button, .swal2-confirm, .ant-modal-footer button, .confirm-btn, [class*="modal"] button, [class*="dialog"] button'
              )) as HTMLElement[];
              let confirmed = false;
              for (const mBtn of modalButtons) {
                const mText = (mBtn.innerText || mBtn.textContent || '').trim().toLowerCase();
                if (mText.includes('confirm') || mText.includes('yes') || mText.includes('proceed') || mText.includes('place order') || mText.includes('ok')) {
                  mBtn.click();
                  logs.push(`Confirmed modal dialog for: ${storeName} (button: ${mText})`);
                  confirmed = true;
                  break;
                }
              }
              if (confirmed) break;
            }

            placedStores.push(storeName);
            await new Promise(r => setTimeout(r, 2000));
          } catch (btnErr: any) {
            failedStores.push({ name: 'Unknown Store', error: btnErr.message || 'Button click failed' });
          }
        }

        return { success: true, logs, placedStores, failedStores };
      }, targetStoreNames || null);

      console.log('[PharmarackCheckout] DOM Execution summary:', checkoutExecution);

      // Wait 10-12s buffer for network API calls to settle and capture official Order IDs
      console.log('[PharmarackCheckout] Waiting 10-12s buffer for Pharmarack server to commit orders and emit Order IDs in network stream...');
      await new Promise(r => setTimeout(r, 11000));

      // Trigger order sync immediately to pull official Order IDs from Pharmarack backend
      console.log('[PharmarackCheckout] Triggering immediate Pharmarack order sync to fetch official Order IDs...');
      let syncRes = null;
      try {
        syncRes = await syncPharmarackOrders();
        console.log('[PharmarackCheckout] Order sync complete:', syncRes);
      } catch (sErr: any) {
        console.warn('[PharmarackCheckout] Order sync error post-checkout:', sErr.message);
      }

      // Map placed stores to results
      const placedNames = checkoutExecution.placedStores || [];
      const capturedOrders = Array.from(networkOrderNos);

      if (placedNames.length > 0) {
        placedNames.forEach((sName: string, idx: number) => {
          results.push({
            storeName: sName,
            orderNo: capturedOrders[idx] || undefined,
            status: 'placed'
          });
        });
      } else if (capturedOrders.length > 0) {
        capturedOrders.forEach((ordNo: string) => {
          results.push({
            storeName: 'Pharmarack Distributor',
            orderNo: ordNo,
            status: 'placed'
          });
        });
      }

      if (checkoutExecution.failedStores) {
        checkoutExecution.failedStores.forEach((f: any) => {
          results.push({
            storeName: f.name,
            status: 'failed',
            error: f.error
          });
        });
      }

      const placedCount = results.filter(r => r.status === 'placed').length;
      const failedCount = results.filter(r => r.status === 'failed').length;

      return {
        ok: placedCount > 0 || (checkoutExecution.placedStores && checkoutExecution.placedStores.length > 0),
        placedCount,
        failedCount,
        orders: results
      };
    } catch (err: any) {
      console.error('[PharmarackCheckout] Execution error:', err);
      return {
        ok: false,
        placedCount: 0,
        failedCount: 0,
        orders: results,
        error: err.message || 'Automated checkout failed'
      };
    } finally {
      if (headlessTrackId) {
        untrackHeadless(headlessTrackId);
      }
      if (browser) {
        try {
          await browser.close();
        } catch (_) {}
      }
      if (tempProfilePathToDelete) {
        try {
          await copyProfileFolder(tempProfilePathToDelete, mainProfilePath, '[PharmarackCheckout]');
          fs.rmSync(tempProfilePathToDelete, { recursive: true, force: true });
        } catch (_) {}
      }
    }
  }

  /**
   * Spawns an authenticated Chrome browser window directly to https://retailers.pharmarack.com/cart
   * for 1-click human-in-the-loop manual review or verification.
   */
  public async openAuthenticatedCartWindow(): Promise<{ ok: boolean; message: string }> {
    if (isShutdownInProgress()) {
      return { ok: false, message: 'Application shutdown in progress' };
    }
    const chromePath = findChromePath();
    if (!chromePath) {
      return { ok: false, message: 'Google Chrome was not found on your system.' };
    }

    const mainProfilePath = path.resolve(getAppDataDir(), 'data', 'pharmarack_profile');
    try {
      await killOrphanChromeProcesses('pharmarack_profile');
      if (!fs.existsSync(mainProfilePath)) fs.mkdirSync(mainProfilePath, { recursive: true });
      cleanProfileLockFiles(mainProfilePath);

      const { spawn: spawnProc } = await import('child_process');
      const chromeProc = spawnProc(chromePath, [
        `--user-data-dir=${mainProfilePath}`,
        '--start-maximized',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-sync',
        'https://retailers.pharmarack.com/cart'
      ], { detached: false, stdio: 'ignore', windowsHide: false });

      trackHeadless(chromeProc, 'pharmarack_cart_window');
      return { ok: true, message: 'Opening official Pharmarack cart window...' };
    } catch (err: any) {
      console.error('[PharmarackCheckout] Failed to open cart window:', err);
      return { ok: false, message: err.message || 'Failed to open Chrome window' };
    }
  }
}

export const pharmarackCheckoutService = PharmarackCheckoutService.getInstance();
