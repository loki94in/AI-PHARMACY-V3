// tests/pos-focus-and-enter.e2e.ts
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('POS Fast Cashier Workflow: Loose-First & Full-Pack Auto-Advance', { tags: ['pos', 'focus', 'e2e'] }, () => {
  test('Full Pack Only: auto-sets qty=1 and advances directly to next medicine search', async ({ app, browser, screen }) => {
    await app.open('/pos');
    await expect(browser).toHaveURL(/\/pos/);

    // 1. Wait for POS initial load and verify row 0 medicine search input is focused
    const medInput0 = screen.getByPlaceholder('Search medicine...');
    await expect(medInput0).toBeVisible({ timeout: 20000 });
    await expect(medInput0).toBeFocused();

    // 2. Search for AYUR (Full Pack Only item)
    await medInput0.fill('AYUR');

    const dropdownItem = browser.locator('div[role="button"][data-highlighted="true"]').first();
    await expect(dropdownItem).toBeVisible({ timeout: 8000 });

    // 3. Select AYUR via Enter
    await browser.keyboard.press('Enter');

    // 4. Dropdown closes completely
    await expect(browser.locator('.z-dropdown')).toHaveCount(0);

    // 5. Full pack: default qty=1, and focus advances DIRECTLY to row 1 medicine search!
    const qtyInput0 = browser.locator('#row-qty-input-0');
    await expect(qtyInput0).toHaveValue('1');

    const medInput1 = browser.locator('#row-med-input-1');
    await expect(medInput1).toBeVisible({ timeout: 5000 });
    await expect(medInput1).toBeFocused();

    // 6. Cashier immediately types second medicine without touching quantity!
    await medInput1.fill('ZANDU');
    const dropdownItem1 = browser.locator('div[role="button"][data-highlighted="true"]').first();
    await expect(dropdownItem1).toBeVisible({ timeout: 8000 });

    await browser.keyboard.press('Enter');

    // 7. Second medicine (also full pack) advances directly to row 2 medicine search!
    const medInput2 = browser.locator('#row-med-input-2');
    await expect(medInput2).toBeVisible({ timeout: 5000 });
    await expect(medInput2).toBeFocused();
  });

  test('Loose-Sale Allowed: routes focus directly to Loose Qty, Enter advances to next row', async ({ app, browser, screen }) => {
    await app.open('/pos');
    await expect(browser).toHaveURL(/\/pos/);

    const medInput0 = screen.getByPlaceholder('Search medicine...');
    await expect(medInput0).toBeVisible({ timeout: 20000 });
    await expect(medInput0).toBeFocused();

    // 1. Search for TORSID (allow_loose_sale: 1)
    await medInput0.fill('TORSID');

    const dropdownItem = browser.locator('div[role="button"][data-highlighted="true"]').first();
    await expect(dropdownItem).toBeVisible({ timeout: 8000 });

    // 2. Select TORSID via Enter
    await browser.keyboard.press('Enter');
    await expect(browser.locator('.z-dropdown')).toHaveCount(0);

    // 3. Loose-allowed item: Focus lands DIRECTLY on Loose Qty!
    const looseInput0 = browser.locator('#row-loose-input-0');
    await expect(looseInput0).toBeVisible({ timeout: 5000 });
    await expect(looseInput0).toBeFocused();

    // 4. Cashier types loose units number (e.g. 5)
    await looseInput0.fill('5');
    await expect(looseInput0).toHaveValue('5');

    // 5. Press Enter on Loose Qty -> advances directly to next medicine search!
    await browser.keyboard.press('Enter');

    const medInput1 = browser.locator('#row-med-input-1');
    await expect(medInput1).toBeVisible({ timeout: 5000 });
    await expect(medInput1).toBeFocused();

    // 6. Press Enter on the empty row -> immediately concludes bill into Bill Discount!
    await browser.keyboard.press('Enter');
    const billDiscountInput = browser.locator('#pos-bill-discount-input');
    await expect(billDiscountInput).toBeVisible({ timeout: 5000 });
    await expect(billDiscountInput).toBeFocused();
  });

  test('Empty Row: Enter or Tab transitions directly to Bill Checkout', async ({ app, browser, screen }) => {
    await app.open('/pos');
    await expect(browser).toHaveURL(/\/pos/);

    const medInput0 = screen.getByPlaceholder('Search medicine...');
    await expect(medInput0).toBeVisible({ timeout: 20000 });
    await expect(medInput0).toBeFocused();

    // Add 1 item
    await medInput0.fill('AYUR');
    const dropdownItem = browser.locator('div[role="button"][data-highlighted="true"]').first();
    await expect(dropdownItem).toBeVisible({ timeout: 8000 });
    await browser.keyboard.press('Enter');

    // Landed on empty row 1
    const medInput1 = browser.locator('#row-med-input-1');
    await expect(medInput1).toBeFocused();

    // Press Enter on empty trailing row -> advances to Bill Discount input!
    await browser.keyboard.press('Enter');

    const billDiscountInput = browser.locator('#pos-bill-discount-input');
    await expect(billDiscountInput).toBeVisible({ timeout: 5000 });
    await expect(billDiscountInput).toBeFocused();
  });

  test('Re-selecting medicine on existing row replaces only target row and follows smart routing', async ({ app, browser, screen }) => {
    await app.open('/pos');
    await expect(browser).toHaveURL(/\/pos/);

    // 1. Add Row 0: AYUR (Full pack)
    const initialInput = browser.locator('#row-med-input-0');
    await expect(initialInput).toBeVisible({ timeout: 20000 });
    await initialInput.fill('AYUR');
    const dropdown0 = browser.locator('div[role="button"][data-highlighted="true"]').first();
    await expect(dropdown0).toBeVisible({ timeout: 8000 });
    await browser.keyboard.press('Enter');
    await expect(browser.locator('.z-dropdown')).toHaveCount(0);

    // Focus advances to Row 1
    const medInput1 = browser.locator('#row-med-input-1');
    await expect(medInput1).toBeFocused();

    // 2. Add Row 1: ZANDU (Full pack)
    await medInput1.fill('ZANDU');
    const dropdown1 = browser.locator('div[role="button"][data-highlighted="true"]').first();
    await expect(dropdown1).toBeVisible({ timeout: 8000 });
    await browser.keyboard.press('Enter');
    await expect(browser.locator('.z-dropdown')).toHaveCount(0);

    // Focus advances to Row 2
    const medInput2 = browser.locator('#row-med-input-2');
    await expect(medInput2).toBeFocused();

    // 3. Re-select Row 0: Cashier focuses row 0 medicine input to change it to TORSID (loose allowed)
    const row0Input = browser.locator('#row-med-input-0');
    await row0Input.click();
    await expect(row0Input).toBeFocused();
    await row0Input.fill('TORSID');

    const dropdownReSelect = browser.locator('div[role="button"][data-highlighted="true"]').first();
    await expect(dropdownReSelect).toBeVisible({ timeout: 8000 });
    await browser.keyboard.press('Enter');
    await expect(browser.locator('.z-dropdown')).toHaveCount(0);

    // 4. Verify Row 1 (ZANDU) is completely intact and preserved!
    const row1Check = browser.locator('#row-med-input-1');
    await expect(row1Check).toHaveValue(/ZANDU/i);

    // 5. Verify Row 0 focus routes directly to Loose Qty because TORSID allows loose sale!
    const looseInput0 = browser.locator('#row-loose-input-0');
    await expect(looseInput0).toBeFocused();

    // 6. Enter loose qty = 4 and press Enter -> advances to row 1!
    await looseInput0.fill('4');
    await browser.keyboard.press('Enter');
    await expect(row1Check).toBeFocused();
  });

  test('Fluid backward and forward keyboard navigation allows editing prior quantities', async ({ app, browser, screen }) => {
    await app.open('/pos');
    await expect(browser).toHaveURL(/\/pos/);

    const initialInput = browser.locator('#row-med-input-0');
    await expect(initialInput).toBeVisible({ timeout: 20000 });

    // Add AYUR
    await initialInput.fill('AYUR');
    const dropdown = browser.locator('div[role="button"][data-highlighted="true"]').first();
    await expect(dropdown).toBeVisible({ timeout: 8000 });
    await browser.keyboard.press('Enter');
    await expect(browser.locator('.z-dropdown')).toHaveCount(0);

    // Lands on row 1
    const medInput1 = browser.locator('#row-med-input-1');
    await expect(medInput1).toBeFocused();

    // 1. Shift+Tab backward: retreats to Row 0 Qty input!
    await browser.keyboard.press('Shift+Tab');
    const qtyInput0 = browser.locator('#row-qty-input-0');
    await expect(qtyInput0).toBeFocused();

    // 2. Cashier edits quantity to 3
    await qtyInput0.fill('3');
    await expect(qtyInput0).toHaveValue('3');

    // 3. Shift+Tab backward again: retreats to Row 0 Medicine input (Change medicine)
    await browser.keyboard.press('Shift+Tab');
    const row0AfterRetreat = browser.locator('#row-med-input-0');
    await expect(row0AfterRetreat).toBeFocused();

    // 4. Tab forward: moves back to Row 0 Qty input
    await browser.keyboard.press('Tab');
    await expect(qtyInput0).toBeFocused();

    // 5. Enter on Full-pack Qty: advances forward to Row 1 Medicine input!
    await browser.keyboard.press('Enter');
    await expect(medInput1).toBeFocused();
  });

  test('Syrup bottle (ASCORIL LS + SYP): auto-sets qty=1 and advances directly to next medicine search', async ({ app, browser, screen }) => {
    await app.open('/pos');
    await expect(browser).toHaveURL(/\/pos/);

    const medInput0 = screen.getByPlaceholder('Search medicine...');
    await expect(medInput0).toBeVisible({ timeout: 20000 });
    await expect(medInput0).toBeFocused();

    // 1. Search specifically for ASCORIL LS + SYP
    await medInput0.fill('ASCORIL LS + SYP');

    const dropdownItem = browser.locator('div[role="button"][data-highlighted="true"]').first();
    await expect(dropdownItem).toBeVisible({ timeout: 8000 });

    // 2. Select via Enter
    await browser.keyboard.press('Enter');
    await expect(browser.locator('.z-dropdown')).toHaveCount(0);

    // 3. Verify Ascoril LS (syrup/liquid, not loose) defaults qty to 1
    const qtyInput0 = browser.locator('#row-qty-input-0');
    await expect(qtyInput0).toHaveValue('1');

    // 4. Verify focus automatically routed directly to Row 1 medicine search
    const medInput1 = browser.locator('#row-med-input-1');
    await expect(medInput1).toBeVisible({ timeout: 5000 });
    await expect(medInput1).toBeFocused();

    // 5. Press Enter on empty Row 1 -> concludes bill directly to bill discount input
    await browser.keyboard.press('Enter');
    const billDiscount = browser.locator('#pos-bill-discount-input');
    await expect(billDiscount).toBeVisible({ timeout: 5000 });
    await expect(billDiscount).toBeFocused();
  });
});
