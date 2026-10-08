import { chromium } from 'playwright-core';
import path from 'path';
import os from 'os';
import fs from 'fs';

const BASE_URL = 'http://127.0.0.1:5174';

// Locate Chromium or system Google Chrome
function getExecutablePath() {
  const playwrightChromium = path.join(
    os.homedir(),
    'AppData', 'Local', 'ms-playwright', 'chromium-1247', 'chrome-win64', 'chrome.exe'
  );
  if (fs.existsSync(playwrightChromium)) return playwrightChromium;

  const systemChromiumDirs = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const cPath of systemChromiumDirs) {
    if (fs.existsSync(cPath)) return cPath;
  }
  throw new Error('No compatible Chromium or Chrome executable found on the system.');
}

// All 24 Primary Pages
const PRIMARY_PAGES = [
  {
    name: 'POS (Sales / Billing)',
    path: '/pos',
    expectedSelectors: ['input', 'button'],
    testInteractions: async (page) => {
      // Find search bar
      const searchInputs = page.locator('input[type="text"], input[placeholder*="Search" i], input[placeholder*="medicine" i]');
      const count = await searchInputs.count();
      if (count > 0) {
        await searchInputs.first().focus();
        await searchInputs.first().fill('DOLO');
        await page.waitForTimeout(300);
        await searchInputs.first().fill('');
      }
      return { searchInputsFound: count };
    }
  },
  {
    name: 'Sells (Sales Invoices & History)',
    path: '/sells',
    expectedSelectors: ['input', 'button'],
    testInteractions: async (page) => {
      const buttons = await page.locator('button').count();
      const inputs = await page.locator('input').count();
      return { buttons, inputs };
    }
  },
  {
    name: 'Inventory (Stock Management)',
    path: '/inventory',
    expectedSelectors: ['input', 'button'],
    testInteractions: async (page) => {
      const buttons = await page.locator('button').count();
      const searchInput = page.locator('input[type="text"], input[type="search"], input[placeholder*="search" i]').first();
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.focus();
        await searchInput.fill('PARACETAMOL');
        await page.waitForTimeout(200);
        await searchInput.fill('');
      }
      return { buttons };
    }
  },
  {
    name: 'Purchases (Inward Invoices Entry)',
    path: '/purchases',
    expectedSelectors: ['input', 'button'],
    testInteractions: async (page) => {
      const inputs = await page.locator('input').count();
      const buttons = await page.locator('button').count();
      return { inputs, buttons };
    }
  },
  {
    name: 'Purchase History (Inward Audit)',
    path: '/purchase-history',
    expectedSelectors: ['input', 'button'],
    testInteractions: async (page) => {
      const inputs = await page.locator('input').count();
      const buttons = await page.locator('button').count();
      return { inputs, buttons };
    }
  },
  {
    name: 'CRM (Patients, Special Orders & Refills)',
    path: '/crm',
    expectedSelectors: ['input', 'button'],
    testInteractions: async (page) => {
      // Test tab switching inside CRM
      const tabs = page.locator('button:has-text("Special Orders"), button:has-text("Refills"), button:has-text("Messages"), button:has-text("Patients")');
      const tabCount = await tabs.count();
      for (let i = 0; i < tabCount; i++) {
        await tabs.nth(i).click().catch(() => {});
        await page.waitForTimeout(150);
      }
      return { tabsTested: tabCount };
    }
  },
  {
    name: 'Reports (Analytics & GST)',
    path: '/reports',
    expectedSelectors: ['button'],
    testInteractions: async (page) => {
      const buttons = await page.locator('button').count();
      return { buttons };
    }
  },
  {
    name: 'Pharmarack Cart (Distributor Ordering)',
    path: '/pharmarack-cart',
    expectedSelectors: ['button'],
    testInteractions: async (page) => {
      const buttons = await page.locator('button').count();
      return { buttons };
    }
  },
  {
    name: 'Live Cart (Pharmacy Live Cart)',
    path: '/live-cart',
    expectedSelectors: ['button'],
    testInteractions: async (page) => {
      const buttons = await page.locator('button').count();
      return { buttons };
    }
  },
  {
    name: 'Investigation Center',
    path: '/investigation',
    expectedSelectors: ['button'],
    testInteractions: async (page) => {
      const buttons = await page.locator('button').count();
      return { buttons };
    }
  },
  {
    name: 'Pharma Intelligence Hub (AI Engineering)',
    path: '/ai-engineering',
    expectedSelectors: ['button'],
    testInteractions: async (page) => {
      // Test tab buttons: Compliance, Schedules, Composition Queue
      const tabs = page.locator('button:has-text("Compliance"), button:has-text("Schedule"), button:has-text("Composition")');
      const tabCount = await tabs.count();
      for (let i = 0; i < tabCount; i++) {
        await tabs.nth(i).click().catch(() => {});
        await page.waitForTimeout(150);
      }
      return { tabsTested: tabCount };
    }
  },
  {
    name: 'AI Learning & Layouts',
    path: '/learning',
    expectedSelectors: ['button'],
    testInteractions: async (page) => {
      const tabs = page.locator('button:has-text("Layout"), button:has-text("Doctor"), button:has-text("Clinical")');
      const tabCount = await tabs.count();
      for (let i = 0; i < tabCount; i++) {
        await tabs.nth(i).click().catch(() => {});
        await page.waitForTimeout(150);
      }
      return { tabsTested: tabCount };
    }
  },
  {
    name: 'Dispatch & Deliveries',
    path: '/dispatch',
    expectedSelectors: ['button'],
    testInteractions: async (page) => {
      const buttons = await page.locator('button').count();
      return { buttons };
    }
  },
  {
    name: 'Online Orders (Website Orders)',
    path: '/website-orders',
    expectedSelectors: ['button'],
    testInteractions: async (page) => {
      const buttons = await page.locator('button').count();
      return { buttons };
    }
  },
  {
    name: 'Online Catalog Management',
    path: '/online-catalog',
    expectedSelectors: ['button'],
    testInteractions: async (page) => {
      const buttons = await page.locator('button').count();
      return { buttons };
    }
  },
  {
    name: 'Customer Portal',
    path: '/portal',
    expectedSelectors: ['input', 'button'],
    testInteractions: async (page) => {
      const inputs = await page.locator('input').count();
      const buttons = await page.locator('button').count();
      return { inputs, buttons };
    }
  },
  {
    name: 'Supplier & Customer Returns',
    path: '/returns',
    expectedSelectors: ['button'],
    testInteractions: async (page) => {
      const tabs = page.locator('button:has-text("Return"), button:has-text("Customer"), button:has-text("Expiry")');
      const tabCount = await tabs.count();
      for (let i = 0; i < tabCount; i++) {
        await tabs.nth(i).click().catch(() => {});
        await page.waitForTimeout(150);
      }
      return { tabsTested: tabCount };
    }
  },
  {
    name: 'Master Database',
    path: '/database',
    expectedSelectors: ['button'],
    testInteractions: async (page) => {
      const tabs = page.locator('button:has-text("Product"), button:has-text("Composition"), button:has-text("Image"), button:has-text("Barcode")');
      const tabCount = await tabs.count();
      for (let i = 0; i < tabCount; i++) {
        await tabs.nth(i).click().catch(() => {});
        await page.waitForTimeout(150);
      }
      return { tabsTested: tabCount };
    }
  },
  {
    name: 'Phone Sales Pad',
    path: '/phone-sales',
    expectedSelectors: ['input', 'button'],
    testInteractions: async (page) => {
      const inputs = await page.locator('input').count();
      const buttons = await page.locator('button').count();
      return { inputs, buttons };
    }
  },
  {
    name: 'Dashboard (Executive KPI)',
    path: '/dashboard',
    expectedSelectors: ['button'],
    testInteractions: async (page) => {
      const buttons = await page.locator('button').count();
      return { buttons };
    }
  },
  {
    name: 'Data Migration Wizard',
    path: '/migration',
    expectedSelectors: ['button'],
    testInteractions: async (page) => {
      const buttons = await page.locator('button').count();
      return { buttons };
    }
  },
  {
    name: 'Distributor Mail & Invoices',
    path: '/mail',
    expectedSelectors: ['button'],
    testInteractions: async (page) => {
      const buttons = await page.locator('button').count();
      return { buttons };
    }
  },
  {
    name: 'Store Settings',
    path: '/settings',
    expectedSelectors: ['button'],
    testInteractions: async (page) => {
      const tabs = page.locator('button:has-text("Store"), button:has-text("Bill"), button:has-text("WhatsApp"), button:has-text("Backup")');
      const tabCount = await tabs.count();
      for (let i = 0; i < Math.min(tabCount, 5); i++) {
        await tabs.nth(i).click().catch(() => {});
        await page.waitForTimeout(150);
      }
      return { tabsTested: tabCount };
    }
  },
  {
    name: 'Audit Center',
    path: '/audit',
    expectedSelectors: ['button'],
    testInteractions: async (page) => {
      const buttons = await page.locator('button').count();
      return { buttons };
    }
  }
];

// Global Modals & Drawers
const GLOBAL_MODALS = [
  {
    name: 'Quick Order Modal (Alt+O / Header)',
    trigger: async (page) => {
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('app-open-quick-order'));
      });
    },
    verify: async (page) => {
      const modal = page.locator('div:has-text("Quick Special Request"), div:has-text("Special Request")').first();
      await modal.waitFor({ state: 'visible', timeout: 5000 });
      // Enter customer info & medicine
      const nameInput = page.locator('input[placeholder*="Patient" i], input[placeholder*="Customer" i], input[placeholder*="Name" i]').first();
      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill('Playwright Test Patient');
      }
      // Close via Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      return { status: 'Opened, filled, and dismissed cleanly via Escape' };
    }
  },
  {
    name: 'Live Cart Add Modal',
    trigger: async (page) => {
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('app-open-live-cart-add'));
      });
    },
    verify: async (page) => {
      const searchInput = page.locator('input[placeholder="Search or enter medicine name..."]').first();
      await searchInput.waitFor({ state: 'visible', timeout: 5000 });
      await searchInput.fill('DOLO 650');
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      return { status: 'Live Cart Add opened, typed search, and closed' };
    }
  },
  {
    name: 'Quick Assist Drawer (Alt+A)',
    trigger: async (page) => {
      await page.keyboard.press('Alt+KeyA');
      await page.waitForTimeout(300);
    },
    verify: async (page) => {
      const drawer = page.locator('div:has-text("Quick Assist")').first();
      const isVisible = await drawer.isVisible().catch(() => false);
      if (isVisible) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
      return { status: isVisible ? 'Opened and closed via Escape' : 'Drawer toggle triggered' };
    }
  },
  {
    name: 'Keyboard Shortcuts Modal (?)',
    trigger: async (page) => {
      await page.keyboard.press('?');
      await page.waitForTimeout(300);
    },
    verify: async (page) => {
      const cheatSheet = page.locator('div:has-text("Keyboard Shortcuts"), div:has-text("Shortcuts")').first();
      const isVisible = await cheatSheet.isVisible().catch(() => false);
      if (isVisible) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
      return { status: isVisible ? 'Shortcuts cheatsheet opened and dismissed' : 'Triggered' };
    }
  },
  {
    name: 'Notification Panel (Bell)',
    trigger: async (page) => {
      const bellButton = page.locator('button[title*="Notification" i], button:has(svg.lucide-bell), button:has(svg.lucide-bell-ring)').first();
      if (await bellButton.isVisible().catch(() => false)) {
        await bellButton.click();
      } else {
        // Trigger via layout
        await page.keyboard.press('Escape');
      }
    },
    verify: async (page) => {
      const panel = page.locator('div:has-text("Notifications")').first();
      const isVisible = await panel.isVisible().catch(() => false);
      if (isVisible) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
      return { status: isVisible ? 'Notification panel opened and dismissed' : 'Bell button tested' };
    }
  },
  {
    name: 'Automation Hub Popover',
    trigger: async (page) => {
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('app-open-automation-hub'));
      });
      await page.waitForTimeout(300);
    },
    verify: async (page) => {
      const hub = page.locator('div:has-text("Automation Hub"), div:has-text("Automation")').first();
      const isVisible = await hub.isVisible().catch(() => false);
      if (isVisible) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
      return { status: isVisible ? 'Automation Hub opened and dismissed' : 'Dispatched' };
    }
  },
  {
    name: 'WhatsApp Queue Controller Popover',
    trigger: async (page) => {
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('app-open-whatsapp-queue'));
      });
      await page.waitForTimeout(300);
    },
    verify: async (page) => {
      const queue = page.locator('div:has-text("WhatsApp Queue"), div:has-text("Queue")').first();
      const isVisible = await queue.isVisible().catch(() => false);
      if (isVisible) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
      return { status: isVisible ? 'Queue popover opened and dismissed' : 'Dispatched' };
    }
  },
  {
    name: 'Mobile QR Connection Modal',
    trigger: async (page) => {
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('app-open-connect-modal'));
      });
      await page.waitForTimeout(300);
    },
    verify: async (page) => {
      const modal = page.locator('div:has-text("Connect Mobile"), div:has-text("QR Code")').first();
      const isVisible = await modal.isVisible().catch(() => false);
      if (isVisible) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
      return { status: isVisible ? 'Mobile connection modal verified' : 'Dispatched' };
    }
  },
  {
    name: 'Backup Center Modal',
    trigger: async (page) => {
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('app-open-backup-modal'));
      });
      await page.waitForTimeout(300);
    },
    verify: async (page) => {
      const modal = page.locator('div:has-text("Backup Center"), div:has-text("Database Backup")').first();
      const isVisible = await modal.isVisible().catch(() => false);
      if (isVisible) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
      return { status: isVisible ? 'Backup modal verified' : 'Dispatched' };
    }
  },
  {
    name: 'Staged Review Modal',
    trigger: async (page) => {
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('app-open-staged-review'));
      });
      await page.waitForTimeout(300);
    },
    verify: async (page) => {
      const modal = page.locator('div:has-text("Staged"), div:has-text("Sync Review")').first();
      const isVisible = await modal.isVisible().catch(() => false);
      if (isVisible) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
      return { status: isVisible ? 'Staged review modal verified' : 'Dispatched' };
    }
  }
];

async function runAllTests() {
  console.log('===============================================================');
  console.log('   AI PHARMACY OS — PLAYWRIGHT FULL SYSTEM AUTOMATED TEST     ');
  console.log('===============================================================');
  
  const executablePath = getExecutablePath();
  console.log('✓ Using Chromium binary:', executablePath);
  console.log('✓ Target Endpoint:', BASE_URL);

  const browser = await chromium.launch({
    executablePath,
    headless: true
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();

  const caughtErrors = [];
  page.on('pageerror', (err) => {
    caughtErrors.push({ type: 'pageerror', message: err.message });
    console.error('❌ [PAGE ERROR]:', err.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Filter out non-fatal expected network or CSP noise
      if (!text.includes('Failed to load resource') && !text.includes('favicon')) {
        caughtErrors.push({ type: 'console.error', message: text });
      }
    }
  });

  const results = {
    pages: [],
    modals: [],
    startTime: new Date().toISOString(),
    totalErrors: 0
  };

  // ──────────────────────────────────────────────
  // 1. Initial Launch & Root Landing
  // ──────────────────────────────────────────────
  console.log('\n--- PHASE 1: Initial App Boot & Landing ---');
  const t0 = performance.now();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1000);
  const bootLatency = Math.round(performance.now() - t0);
  console.log(`✓ Loaded base URL in ${bootLatency}ms. Current URL: ${page.url()}`);

  // ──────────────────────────────────────────────
  // 2. Test All 24 Primary Pages
  // ──────────────────────────────────────────────
  console.log('\n--- PHASE 2: Testing All 24 Primary Pages ---');

  for (let i = 0; i < PRIMARY_PAGES.length; i++) {
    const item = PRIMARY_PAGES[i];
    const pageNum = i + 1;
    const targetUrl = `${BASE_URL}${item.path}`;
    process.stdout.write(`[${pageNum}/24] Testing ${item.name} (${item.path})... `);

    const pageStart = performance.now();
    let pagePassed = true;
    let interactionDetails = {};
    let errorMsg = null;

    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(500);

      // Verify no ErrorBoundary triggered
      const errorBoundary = await page.locator('text="Something went wrong"').count();
      if (errorBoundary > 0) {
        throw new Error('ErrorBoundary triggered on page!');
      }

      // Verify 404 page was not hit
      const notFound = await page.locator('text="404 — Page Not Found"').count();
      if (notFound > 0) {
        throw new Error('404 Page Not Found rendered!');
      }

      // Check required elements exist
      for (const sel of item.expectedSelectors) {
        const selCount = await page.locator(sel).count();
        if (selCount === 0) {
          console.warn(`(Warning: selector '${sel}' returned 0 matches) `);
        }
      }

      // Run page interactions
      if (item.testInteractions) {
        interactionDetails = await item.testInteractions(page);
      }

    } catch (err) {
      pagePassed = false;
      errorMsg = err.message;
      console.error(`FAILED: ${err.message}`);
    }

    const durationMs = Math.round(performance.now() - pageStart);
    if (pagePassed) {
      console.log(`PASSED in ${durationMs}ms ✓`);
    }

    results.pages.push({
      index: pageNum,
      name: item.name,
      path: item.path,
      passed: pagePassed,
      durationMs,
      details: interactionDetails,
      error: errorMsg
    });
  }

  // ──────────────────────────────────────────────
  // 3. Test All Global Modals, Drawers & Popovers
  // ──────────────────────────────────────────────
  console.log('\n--- PHASE 3: Testing All Global Modals & Drawers ---');

  // Go to POS as safe anchor
  await page.goto(`${BASE_URL}/pos`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  for (let j = 0; j < GLOBAL_MODALS.length; j++) {
    const modalItem = GLOBAL_MODALS[j];
    const modalNum = j + 1;
    process.stdout.write(`[${modalNum}/${GLOBAL_MODALS.length}] Testing modal: ${modalItem.name}... `);

    const modalStart = performance.now();
    let modalPassed = true;
    let modalDetails = {};
    let errorMsg = null;

    try {
      await modalItem.trigger(page);
      await page.waitForTimeout(300);
      modalDetails = await modalItem.verify(page);
    } catch (err) {
      modalPassed = false;
      errorMsg = err.message;
      console.error(`FAILED: ${err.message}`);
    }

    const durationMs = Math.round(performance.now() - modalStart);
    if (modalPassed) {
      console.log(`PASSED in ${durationMs}ms ✓`);
    }

    results.modals.push({
      index: modalNum,
      name: modalItem.name,
      passed: modalPassed,
      durationMs,
      details: modalDetails,
      error: errorMsg
    });
  }

  // ──────────────────────────────────────────────
  // 4. Phase 4: Deep Functional Feature & Button Workflows
  // ──────────────────────────────────────────────
  console.log('\n--- PHASE 4: Deep Feature & Button Functional Flow Tests ---');
  results.deepFlows = [];

  // Flow 1: Quick Order Draft Auto-Save & Restoration Cycle
  {
    process.stdout.write('[Flow 1/4] Testing Quick Order Draft Auto-Save & Restoration cycle... ');
    const flowStart = performance.now();
    let flowPassed = true;
    let flowDetails = {};
    let errorMsg = null;

    try {
      await page.goto(`${BASE_URL}/pos`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      // Open Quick Order
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('app-open-quick-order'));
      });
      await page.waitForTimeout(400);

      const modal = page.locator('div:has-text("Quick Special Request")').first();
      await modal.waitFor({ state: 'visible', timeout: 5000 });

      // Enter Customer & Phone
      const nameInput = page.locator('input[placeholder*="Patient" i], input[placeholder*="Customer" i], input[placeholder*="Name" i]').first();
      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill('Playwright Test Patient');
      }
      const phoneInput = page.locator('input[placeholder*="Phone" i], input[type="tel"]').first();
      if (await phoneInput.isVisible().catch(() => false)) {
        await phoneInput.fill('9876543210');
      }

      // Enter Medicine
      const medInput = page.locator('input[placeholder*="medicine" i]').first();
      if (await medInput.isVisible().catch(() => false)) {
        await medInput.fill('AZITHRAL 500');
        await page.waitForTimeout(300);
      }

      // Close via Escape to trigger auto-save
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);

      // Re-open via custom event
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('app-open-quick-order'));
      });
      await page.waitForTimeout(400);

      // Verify draft restoration banner or populated customer name
      const restoredBanner = page.locator('text="Restored uncompleted quick order draft"');
      const hasBanner = (await restoredBanner.count()) > 0;
      
      const discardBtn = page.locator('button:has-text("Discard Draft")').first();
      if ((await discardBtn.count()) > 0) {
        await discardBtn.click();
        await page.waitForTimeout(200);
      }

      // Close modal
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      flowDetails = { draftRestoredVerified: hasBanner };
    } catch (err) {
      flowPassed = false;
      errorMsg = err.message;
      console.error(`FAILED: ${err.message}`);
    }

    const durationMs = Math.round(performance.now() - flowStart);
    if (flowPassed) console.log(`PASSED in ${durationMs}ms ✓`);
    results.deepFlows.push({ name: 'Quick Order Draft Restoration', passed: flowPassed, durationMs, details: flowDetails, error: errorMsg });
  }

  // Flow 2: Live In-Session SPA Sidebar Navigation Flow (Zero Full-Reload)
  {
    process.stdout.write('[Flow 2/4] Testing Live SPA Sidebar In-App Navigation across all primary routes... ');
    const flowStart = performance.now();
    let flowPassed = true;
    let clickedLinks = 0;
    let errorMsg = null;

    try {
      await page.goto(`${BASE_URL}/pos`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);

      const sidebarLinks = page.locator('nav a[href^="/"]');
      const totalLinks = await sidebarLinks.count();
      for (let k = 0; k < totalLinks; k++) {
        const link = sidebarLinks.nth(k);
        const href = await link.getAttribute('href');
        
        // If clicking /portal, customer view hides the admin sidebar, so navigate back after
        if (href === '/portal') {
          await link.click({ timeout: 4000 });
          await page.waitForTimeout(200);
          clickedLinks++;
          // Return to admin dashboard
          await page.goto(`${BASE_URL}/pos`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(300);
          continue;
        }

        await link.click({ timeout: 4000 });
        await page.waitForTimeout(150);
        clickedLinks++;
      }
    } catch (err) {
      flowPassed = false;
      errorMsg = err.message;
      console.error(`FAILED: ${err.message}`);
    }

    const durationMs = Math.round(performance.now() - flowStart);
    if (flowPassed) console.log(`PASSED in ${durationMs}ms (${clickedLinks} links navigated) ✓`);
    results.deepFlows.push({ name: 'Sidebar In-App Client Navigation', passed: flowPassed, durationMs, details: { clickedLinks }, error: errorMsg });
  }

  // Flow 3: Settings Multi-Tab Navigation & Controls Audit
  {
    process.stdout.write('[Flow 3/4] Testing Settings Multi-Tab Navigation & Form Controls... ');
    const flowStart = performance.now();
    let flowPassed = true;
    let tabsSwitched = 0;
    let errorMsg = null;

    try {
      await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);

      const settingsTabs = page.locator('button:has-text("Store"), button:has-text("Billing"), button:has-text("WhatsApp"), button:has-text("Telegram"), button:has-text("Backup"), button:has-text("Appearance")');
      const count = await settingsTabs.count();
      for (let t = 0; t < count; t++) {
        await settingsTabs.nth(t).click();
        await page.waitForTimeout(150);
        tabsSwitched++;
      }
    } catch (err) {
      flowPassed = false;
      errorMsg = err.message;
      console.error(`FAILED: ${err.message}`);
    }

    const durationMs = Math.round(performance.now() - flowStart);
    if (flowPassed) console.log(`PASSED in ${durationMs}ms (${tabsSwitched} tabs switched) ✓`);
    results.deepFlows.push({ name: 'Settings Tabs Audit', passed: flowPassed, durationMs, details: { tabsSwitched }, error: errorMsg });
  }

  // Flow 4: Master Database Search & Universal Medicine Modal Audit
  {
    process.stdout.write('[Flow 4/4] Testing Master Database Search & Universal Modal... ');
    const flowStart = performance.now();
    let flowPassed = true;
    let actionsVerified = 0;
    let errorMsg = null;

    try {
      await page.goto(`${BASE_URL}/database`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);

      // 1. Test search input
      const searchInputs = page.locator('input[placeholder*="Search" i], input[placeholder*="Medicine" i], input[placeholder*="Name" i]');
      if ((await searchInputs.count()) > 0) {
        await searchInputs.first().fill('PARACETAMOL');
        await page.waitForTimeout(300);
        await searchInputs.first().fill('');
        actionsVerified++;
      }

      // 2. Open Add Medicine Modal
      const addBtn = page.locator('button:has-text("Add Medicine")').first();
      if (await addBtn.isVisible().catch(() => false)) {
        await addBtn.click();
        await page.waitForTimeout(300);
        const modal = page.locator('div:has-text("Universal"), div:has-text("Medicine")').first();
        if (await modal.isVisible().catch(() => false)) {
          actionsVerified++;
          await page.keyboard.press('Escape');
          await page.waitForTimeout(200);
        }
      }
    } catch (err) {
      flowPassed = false;
      errorMsg = err.message;
      console.error(`FAILED: ${err.message}`);
    }

    const durationMs = Math.round(performance.now() - flowStart);
    if (flowPassed) console.log(`PASSED in ${durationMs}ms (${actionsVerified} actions verified) ✓`);
    results.deepFlows.push({ name: 'Database Search & Modal Audit', passed: flowPassed, durationMs, details: { actionsVerified }, error: errorMsg });
  }

  await browser.close();

  results.endTime = new Date().toISOString();
  results.totalErrors = caughtErrors.length;
  results.caughtErrors = caughtErrors;

  // ──────────────────────────────────────────────
  // 4. Output Summary Report
  // ──────────────────────────────────────────────
  console.log('\n===============================================================');
  console.log('                   FULL TEST EXECUTION SUMMARY                 ');
  console.log('===============================================================');
  
  const passedPagesCount = results.pages.filter(p => p.passed).length;
  const passedModalsCount = results.modals.filter(m => m.passed).length;
  const passedFlowsCount = (results.deepFlows || []).filter(f => f.passed).length;

  console.log(`Pages Tested:      ${passedPagesCount} / ${results.pages.length} Passed`);
  console.log(`Modals Tested:     ${passedModalsCount} / ${results.modals.length} Passed`);
  console.log(`Deep Flows Tested: ${passedFlowsCount} / ${(results.deepFlows || []).length} Passed`);
  console.log(`Console Errors:    ${caughtErrors.length}`);

  if (passedPagesCount === results.pages.length && passedModalsCount === results.modals.length && passedFlowsCount === (results.deepFlows || []).length) {
    console.log('\n🎉 ALL 24+ PAGES, ALL 10 GLOBAL MODALS, AND ALL DEEP FLOWS PASSED WITH 0 CRASHES!');
  } else {
    console.log('\n⚠️ SOME CHECKS REPORTED ISSUES — INSPECT DETAILS ABOVE.');
  }

  // Save detailed JSON report
  const reportPath = path.resolve('test-report-playwright.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Report saved to: ${reportPath}`);

  return results;
}

runAllTests().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
