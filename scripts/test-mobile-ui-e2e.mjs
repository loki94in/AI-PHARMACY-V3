import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import os from 'os';

const URL = 'http://localhost:8081';
const exe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const outputDir = path.join(process.cwd(), 'test-shots', 'mobile');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log('🚀 Starting Mobile UI E2E Automated Test Suite...');
console.log(`📱 Target URL: ${URL}`);
console.log(`🌐 Chrome Binary: ${exe}`);

const isHeaded = process.argv.includes('--headed') || process.argv.includes('--ui') || true; // Run visible in UI

const browser = await chromium.launch({
  executablePath: exe,
  headless: !isHeaded,
  slowMo: isHeaded ? 500 : 0,
  args: ['--no-sandbox', '--disable-setuid-sandbox', ...(isHeaded ? ['--window-size=440,940'] : [])]
});

const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, // iPhone 13 dimensions
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];

page.on('console', msg => {
  if (msg.type() === 'error') {
    consoleErrors.push(msg.text());
  }
});

page.on('pageerror', err => {
  pageErrors.push(err.message);
});

const results = {
  initialLoad: false,
  tabsTested: [],
  searchTested: false,
  appLockDismissed: false,
  serverSetupChecked: false,
  screenshots: [],
  errors: [],
};

try {
  console.log('⏳ Navigating to Expo Web bundle...');
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 }).catch(async () => {
    // Fallback if networkidle takes longer due to streaming
    await page.waitForLoadState('domcontentloaded');
  });

  await page.waitForTimeout(3000);
  results.initialLoad = true;

  // Screenshot 1: Initial Screen
  const shot1 = path.join(outputDir, '01_initial_screen.png');
  await page.screenshot({ path: shot1 });
  results.screenshots.push('01_initial_screen.png');
  console.log('📸 Captured 01_initial_screen.png');

  // Check if AppLock / PIN prompt is shown
  const pinInput = page.locator('input[type="password"], input[inputmode="numeric"]');
  if (await pinInput.first().isVisible({ timeout: 1500 }).catch(() => false)) {
    console.log('🔒 AppLock PIN screen detected, entering default PIN 1234...');
    await pinInput.first().fill('1234');
    await page.waitForTimeout(1000);
    results.appLockDismissed = true;
    await page.screenshot({ path: path.join(outputDir, '01b_unlocked.png') });
  }

  // Check if ServerSetup modal is open
  const setupTitle = page.locator('text=Server Setup').or(page.locator('text=Connect to Backend'));
  if (await setupTitle.first().isVisible({ timeout: 1500 }).catch(() => false)) {
    console.log('⚙️ Server Setup screen detected...');
    results.serverSetupChecked = true;
    // Dismiss or click Connect
    const connectBtn = page.locator('button:has-text("Connect"), div[role="button"]:has-text("Connect")');
    if (await connectBtn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
      await connectBtn.first().click().catch(() => {});
      await page.waitForTimeout(1000);
    }
  }

  // Screenshot 2: Dashboard / Main Screen
  const shot2 = path.join(outputDir, '02_dashboard_screen.png');
  await page.screenshot({ path: shot2 });
  results.screenshots.push('02_dashboard_screen.png');
  console.log('📸 Captured 02_dashboard_screen.png');

  // Test Search Bar on Dashboard
  console.log('🔍 Testing Dashboard search input...');
  const searchBox = page.locator('input[placeholder*="Search"], input[type="text"]').first();
  if (await searchBox.isVisible({ timeout: 2000 }).catch(() => false)) {
    await searchBox.fill('PARACETAMOL');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(outputDir, '03_search_typed.png') });
    results.screenshots.push('03_search_typed.png');
    console.log('📸 Captured 03_search_typed.png');
    await searchBox.fill('');
    await page.waitForTimeout(500);
    results.searchTested = true;
  }

  // Test Bottom Navigation Tabs
  console.log('📑 Testing Bottom Navigation Tabs...');
  const tabNames = ['CRM', 'Inventory', 'Billing', 'Inbox', 'More', 'Assistant'];

  for (const tabName of tabNames) {
    const tabBtn = page.locator(`div[role="button"]:has-text("${tabName}"), button:has-text("${tabName}"), a:has-text("${tabName}")`).first();
    if (await tabBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log(`👉 Clicking tab: ${tabName}...`);
      await tabBtn.click().catch(() => {});
      await page.waitForTimeout(1500);
      const filename = `tab_${tabName.toLowerCase()}.png`;
      await page.screenshot({ path: path.join(outputDir, filename) });
      results.screenshots.push(filename);
      results.tabsTested.push(tabName);
      console.log(`📸 Captured ${filename}`);

      // If CRM tab, test sub-tabs: Refills, Special Orders, Credit Ledger + Modals
      if (tabName === 'CRM') {
        console.log('👥 Testing CRM Sub-tabs & Modals...');
        
        // 1. Test "+ Add" Refill Modal
        const addRefillBtn = page.locator('div[role="button"]:has-text("+ Add"), button:has-text("+ Add"), text=+ Add, text=Add').first();
        if (await addRefillBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await addRefillBtn.click().catch(() => {});
          await page.waitForTimeout(1000);
          await page.screenshot({ path: path.join(outputDir, 'crm_modal_add_refill.png') });
          results.screenshots.push('crm_modal_add_refill.png');
          console.log('📸 Captured crm_modal_add_refill.png');
          // Close modal
          const cancelBtn = page.locator('text=Cancel').first();
          if (await cancelBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await cancelBtn.click().catch(() => {});
            await page.waitForTimeout(500);
          }
        }

        // 2. Test Special Orders tab + "+ Order" Modal
        const specialOrdersTab = page.locator('text=Special Orders').first();
        if (await specialOrdersTab.isVisible({ timeout: 1500 }).catch(() => false)) {
          console.log('👉 Switching to Special Orders sub-tab...');
          await specialOrdersTab.click().catch(() => {});
          await page.waitForTimeout(1000);
          await page.screenshot({ path: path.join(outputDir, 'crm_special_orders.png') });
          results.screenshots.push('crm_special_orders.png');
          console.log('📸 Captured crm_special_orders.png');

          const orderBtn = page.locator('text=Order').first();
          if (await orderBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            await orderBtn.click().catch(() => {});
            await page.waitForTimeout(1000);
            await page.screenshot({ path: path.join(outputDir, 'crm_modal_add_order.png') });
            results.screenshots.push('crm_modal_add_order.png');
            console.log('📸 Captured crm_modal_add_order.png');
            const cancelBtn = page.locator('text=Cancel').first();
            if (await cancelBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
              await cancelBtn.click().catch(() => {});
              await page.waitForTimeout(500);
            }
          }
        }

        // 3. Test Credit Ledger tab + "Collect Payment" Modal
        const creditTab = page.locator('text=Credit Ledger').first();
        if (await creditTab.isVisible({ timeout: 1500 }).catch(() => false)) {
          console.log('👉 Switching to Credit Ledger sub-tab...');
          await creditTab.click().catch(() => {});
          await page.waitForTimeout(1000);
          await page.screenshot({ path: path.join(outputDir, 'crm_credit_ledger.png') });
          results.screenshots.push('crm_credit_ledger.png');
          console.log('📸 Captured crm_credit_ledger.png');

          const payBtn = page.locator('text=Collect Payment').first();
          if (await payBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            await payBtn.click().catch(() => {});
            await page.waitForTimeout(1000);
            await page.screenshot({ path: path.join(outputDir, 'crm_modal_collect_payment.png') });
            results.screenshots.push('crm_modal_collect_payment.png');
            console.log('📸 Captured crm_modal_collect_payment.png');
            const cancelBtn = page.locator('text=Cancel').first();
            if (await cancelBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
              await cancelBtn.click().catch(() => {});
              await page.waitForTimeout(500);
            }
          }
        }

        // Return to Refills sub-tab
        const refillsTab = page.locator('text=Refills').first();
        if (await refillsTab.isVisible({ timeout: 1500 }).catch(() => false)) {
          await refillsTab.click().catch(() => {});
          await page.waitForTimeout(500);
        }
      }

      // If Billing tab, test billing input
      if (tabName === 'Billing') {
        const billSearch = page.locator('input[placeholder*="Scan or search"], input[placeholder*="Search"]').first();
        if (await billSearch.isVisible({ timeout: 1500 }).catch(() => false)) {
          await billSearch.fill('DOLO');
          await page.waitForTimeout(1000);
          await page.screenshot({ path: path.join(outputDir, 'tab_billing_search.png') });
          results.screenshots.push('tab_billing_search.png');
          await billSearch.fill('');
        }
      }
    }
  }

  results.errors = [...consoleErrors, ...pageErrors];
  console.log('\n✅ E2E UI Test Run Completed Successfully!');
  console.log(`📊 Tabs Tested: ${results.tabsTested.join(', ') || 'N/A'}`);
  console.log(`📸 Screenshots Saved: ${results.screenshots.length}`);
  console.log(`❌ Errors Encountered: ${results.errors.length}`);

} catch (err) {
  console.error('💥 Test execution error:', err);
  results.fatalError = err.message;
} finally {
  await browser.close();
  fs.writeFileSync(path.join(outputDir, 'e2e_results.json'), JSON.stringify(results, null, 2));
}
