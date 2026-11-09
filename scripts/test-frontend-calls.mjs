import fs from 'fs';
import http from 'http';

// Real endpoints invoked directly by each frontend page:
const pageEndpoints = [
  // 1. Dashboard (/dashboard)
  { page: 'Dashboard', path: '/api/dashboard' },
  
  // 2. POS (/pos)
  { page: 'POS', path: '/api/sales/last-invoice' },
  { page: 'POS', path: '/api/sales/next-invoice' },
  { page: 'POS', path: '/api/sales/search-medicine?query=para' },
  { page: 'POS', path: '/api/sales/hold' },
  { page: 'POS', path: '/api/sales/today-medicines' },

  // 3. Inventory (/inventory)
  { page: 'Inventory', path: '/api/inventory?limit=50&offset=0' },
  { page: 'Inventory', path: '/api/inventory/low-stock' },
  { page: 'Inventory', path: '/api/inventory/precalculated-metrics' },

  // 4. Sells / Sales Invoices (/sells)
  { page: 'Sells', path: '/api/sales/list?limit=50&offset=0' },
  { page: 'Sells', path: '/api/sales/credit-dues' },
  { page: 'Sells', path: '/api/sales/reorder-suggestions' },

  // 5. Purchases Inward (/purchases)
  { page: 'Purchases', path: '/api/purchases?limit=20' },
  { page: 'Purchases', path: '/api/distributors' },

  // 6. CRM & Automation (/crm)
  { page: 'CRM', path: '/api/crm/patients?limit=50' },
  { page: 'CRM', path: '/api/automation/hub-summary' },
  { page: 'CRM', path: '/api/automation/notifications/daily-summary' },
  { page: 'CRM', path: '/api/refills' },
  { page: 'CRM', path: '/api/call-tasks' },

  // 7. Reports (/reports)
  { page: 'Reports', path: '/api/reports' },

  // 8. Settings & License (/settings)
  { page: 'Settings', path: '/api/settings' },
  { page: 'Settings', path: '/api/license/status' },
  { page: 'Settings', path: '/api/stores' },

  // 9. Dispatch & Delivery (/dispatch)
  { page: 'Dispatch', path: '/api/dispatch/orders' },
  { page: 'Dispatch', path: '/api/dispatch/delivery-boys' },

  // 10. Returns & Customer Returns (/returns)
  { page: 'Returns', path: '/api/returns' },
  { page: 'Returns', path: '/api/customer-returns/history' },

  // 11. Drug Master Database (/database)
  { page: 'Database', path: '/api/medicines?limit=50' },
  { page: 'Database', path: '/api/catalog/images/counts' },

  // 12. Investigation Hub (/investigation)
  { page: 'Investigation', path: '/api/investigation/timeline' },

  // 13. AI Engineering & System Status (/ai-engineering)
  { page: 'AI Engineering', path: '/api/system/services-status' },
  { page: 'AI Engineering', path: '/api/local-ai/status' },

  // 14. Learning (/learning)
  { page: 'Learning', path: '/api/learning/stats' },

  // 15. Audit Center (/audit)
  { page: 'Audit', path: '/api/audit/latest' },
  { page: 'Audit', path: '/api/audit/history' },

  // 16. Live Cart & Pharmarack (/live-cart, /pharmarack-cart)
  { page: 'Live Cart', path: '/api/pharmarack/cart' },
  { page: 'Live Cart', path: '/api/pharmarack/session-status' },

  // 17. Mail Sync (/mail)
  { page: 'Mail Sync', path: '/api/email/status' },

  // 18. Migration (/migration)
  { page: 'Migration', path: '/api/migration/status' },

  // 19. Phone Sales (/phone-sales)
  { page: 'Phone Sales', path: '/api/sales/staged' },

  // 20. Quick Assist & WhatsApp Queue
  { page: 'Quick Assist', path: '/api/automation/notifications?status=staged' },
  { page: 'Quick Assist', path: '/api/whatsapp/queue/status' }
];

async function probe() {
  console.log(`\n======================================================`);
  console.log(` AUDITING ALL FRONTEND PAGE API CALLS FOR LATENCY & ERRORS`);
  console.log(` Target Server: http://127.0.0.1:5175`);
  console.log(` Total Endpoints: ${pageEndpoints.length}`);
  console.log(`======================================================\n`);

  const results = [];

  for (const ep of pageEndpoints) {
    const t0 = performance.now();
    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.get({
          hostname: '127.0.0.1',
          port: 5175,
          path: ep.path,
          headers: {
            'x-store-id': '1',
            'Accept': 'application/json'
          }
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve({ statusCode: res.statusCode, body }));
        });
        req.on('error', reject);
        req.setTimeout(8000, () => req.destroy(new Error('Timeout (>8000ms)')));
      });

      const ms = Math.round(performance.now() - t0);
      const isSuccess = res.statusCode >= 200 && res.statusCode < 400;
      let jsonParsed = false;
      try {
        JSON.parse(res.body);
        jsonParsed = true;
      } catch (_) {}

      const icon = isSuccess ? '  ✓ ' : '  ✗ ';
      const latencyTier = ms < 50 ? '[ULTRA-FAST]' : ms < 200 ? '[FAST]' : ms < 1000 ? '[NORMAL]' : '[SLOW]';
      
      console.log(
        `${icon} ${ep.page.padEnd(16)} ${ep.path.padEnd(46)} -> HTTP ${res.statusCode} in ${ms}ms ${latencyTier}`
      );

      results.push({
        page: ep.page,
        path: ep.path,
        status: res.statusCode,
        ms,
        ok: isSuccess,
        json: jsonParsed
      });
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      console.log(`  ✗  ${ep.page.padEnd(16)} ${ep.path.padEnd(46)} -> FAILED in ${ms}ms: ${err.message}`);
      results.push({
        page: ep.page,
        path: ep.path,
        status: 0,
        ms,
        ok: false,
        json: false,
        error: err.message
      });
    }
  }

  console.log(`\n======================================================`);
  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  const avgLatency = Math.round(results.filter(r => r.ok).reduce((sum, r) => sum + r.ms, 0) / (passed || 1));
  const ultraFast = results.filter(r => r.ok && r.ms < 50).length;

  console.log(` TOTAL ENDPOINTS TESTED : ${results.length}`);
  console.log(` PASSED (HTTP 200/2xx)  : ${passed}`);
  console.log(` FAILED (Non-2xx / Err) : ${failed}`);
  console.log(` AVERAGE LATENCY        : ${avgLatency}ms`);
  console.log(` ULTRA-FAST (< 50ms)    : ${ultraFast} of ${passed}`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    console.log(`Failed Endpoints Detail:`);
    results.filter(r => !r.ok).forEach(r => console.log(` - ${r.page}: ${r.path} -> HTTP ${r.status}`));
    process.exit(1);
  } else {
    console.log(`ALL FRONTEND PAGE API CALLS RESPONDED WITH HTTP 200 AND ZERO ERRORS!`);
    process.exit(0);
  }
}

probe().catch(err => {
  console.error('Fatal probe error:', err);
  process.exit(1);
});
