// tests/pos-focus-and-enter.e2e.ts
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('POS Medicine Selection Focus & Enter Hopping Flow', { tags: ['pos', 'focus', 'e2e'] }, () => {
  test('verifies same-medicine focus retention, no dropdown re-drop, and smart enter hopping (full pack only)', async ({ app, browser, screen }) => {
    await app.open('/pos');
    await expect(browser).toHaveURL(/\/pos/);

    // 1. Wait for POS initial load to complete and locate row 0's medicine input
    const medInput0 = screen.getByPlaceholder('Search medicine...');
    await expect(medInput0).toBeVisible({ timeout: 20000 });
    await expect(medInput0).toBeFocused();

    // 2. Type an in-stock medicine search term in row 0
    await medInput0.fill('AYUR');

    // 3. Wait for dropdown suggestions to appear
    const dropdownItem = browser.locator('div[role="button"][data-highlighted="true"]').first();
    await expect(dropdownItem).toBeVisible({ timeout: 8000 });

    // 4. Select the highlighted medicine via Enter key
    await browser.keyboard.press('Enter');

    // 5. Verify the dropdown closes completely and does not re-drop
    await expect(browser.locator('.z-dropdown')).toHaveCount(0);

    // 6. Verify focus lands directly on Row 0's Quantity input (Strip Qty)
    const qtyInput0 = browser.locator('#row-qty-input-0');
    await expect(qtyInput0).toBeVisible({ timeout: 5000 });
    await expect(qtyInput0).toBeFocused();

    // 7. Test Smart Enter Hopping on Row 0 Quantity:
    // AYUR is Full Pack Only -> Enter hops directly past disabled loose to next empty medicine row
    await browser.keyboard.press('Enter');

    // 8. Focus must now be on the next empty medicine row (row 1)
    const medInput1 = browser.locator('#row-med-input-1');
    await expect(medInput1).toBeVisible({ timeout: 5000 });
    await expect(medInput1).toBeFocused();

    // 9. Add a second medicine in Row 1 to verify NO focus hijacking to Row 0
    await medInput1.fill('ZANDU');
    const dropdownItem1 = browser.locator('div[role="button"][data-highlighted="true"]').first();
    await expect(dropdownItem1).toBeVisible({ timeout: 8000 });

    await browser.keyboard.press('Enter');

    // 10. CRITICAL CHECK: Focus must land on Row 1's Qty, NOT hijacked to Row 0!
    const qtyInput1 = browser.locator('#row-qty-input-1');
    await expect(qtyInput1).toBeVisible({ timeout: 5000 });
    await expect(qtyInput1).toBeFocused();
    await expect(qtyInput0).not.toBeFocused();
  });

  test('verifies enter hopping through loose quantity when loose sale is allowed', async ({ app, browser, screen }) => {
    await app.open('/pos');
    await expect(browser).toHaveURL(/\/pos/);

    const medInput0 = screen.getByPlaceholder('Search medicine...');
    await expect(medInput0).toBeVisible({ timeout: 20000 });
    await expect(medInput0).toBeFocused();

    // Search for TORSID (allow_loose_sale: 1, pack_size: 10)
    await medInput0.fill('TORSID');

    const dropdownItem = browser.locator('div[role="button"][data-highlighted="true"]').first();
    await expect(dropdownItem).toBeVisible({ timeout: 8000 });

    await browser.keyboard.press('Enter');
    await expect(browser.locator('.z-dropdown')).toHaveCount(0);

    // 1. First lands on Strip Qty
    const qtyInput0 = browser.locator('#row-qty-input-0');
    await expect(qtyInput0).toBeVisible({ timeout: 5000 });
    await expect(qtyInput0).toBeFocused();

    // 2. Press Enter -> since loose sale is allowed, focus hops to Loose Qty
    await browser.keyboard.press('Enter');
    const looseInput0 = browser.locator('#row-loose-input-0');
    await expect(looseInput0).toBeVisible({ timeout: 5000 });
    await expect(looseInput0).toBeFocused();

    // 3. Press Enter on Loose Qty -> hops to the next empty row's medicine input
    await browser.keyboard.press('Enter');
    const medInput1 = browser.locator('#row-med-input-1');
    await expect(medInput1).toBeVisible({ timeout: 5000 });
    await expect(medInput1).toBeFocused();
  });
});
