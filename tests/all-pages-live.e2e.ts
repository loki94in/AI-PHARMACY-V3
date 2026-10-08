// tests/all-pages-live.e2e.ts
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

const primaryPages = [
  { route: '/pos', name: 'Point of Sale' },
  { route: '/sells', name: 'Sales & Invoices' },
  { route: '/inventory', name: 'Inventory & Stock' },
  { route: '/purchases', name: 'Purchases Inward' },
  { route: '/purchase-history', name: 'Purchase History' },
  { route: '/crm', name: 'CRM & WhatsApp' },
  { route: '/reports', name: 'Reports & Analytics' },
  { route: '/pharmarack-cart', name: 'Pharmarack Cart' },
  { route: '/live-cart', name: 'Live Cart' },
  { route: '/investigation', name: 'Investigation Hub' },
  { route: '/ai-engineering', name: 'AI Engineering' },
  { route: '/learning', name: 'AI Learning & Layouts' },
  { route: '/dispatch', name: 'Dispatch & Delivery' },
  { route: '/website-orders', name: 'Website Orders' },
  { route: '/online-catalog', name: 'Online Catalog' },
  { route: '/portal', name: 'Customer Web Portal' },
  { route: '/returns', name: 'Returns & Expiry' },
  { route: '/database', name: 'Drug Master Database' },
  { route: '/phone-sales', name: 'Phone Sales' },
  { route: '/dashboard', name: 'Executive Dashboard' },
  { route: '/migration', name: 'Data Migration' },
  { route: '/mail', name: 'Distributor Mail Sync' },
  { route: '/settings', name: 'Store Settings' },
  { route: '/audit', name: 'Audit Center' },
];

describe('All 24 Primary App Pages Live Walkthrough', { tags: ['pages', 'walkthrough'] }, () => {
  for (const page of primaryPages) {
    test(`visits ${page.name} (${page.route}) cleanly`, async ({ app, browser, screen }) => {
      await app.open(page.route);
      await expect(browser).toHaveURL(new RegExp(page.route));

      // Assert page body is mounted and healthy
      await expect(screen.getByRole('main').or(screen.locator('#root'))).toBeVisible();

      // Assert no React crash / ErrorBoundary overlay is active
      const errorBoundaryText = screen.getByText('Something went wrong').or(screen.getByText('Application Error'));
      await expect(errorBoundaryText).toHaveCount(0);
    });
  }
});
