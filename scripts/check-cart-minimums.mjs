/**
 * Fetches the raw Pharmarack cart API response and shows all distributors
 * with their MinAmountLimit, MinItemLimit, current total, and whether they
 * meet the minimum order requirement.
 */
import http from 'http';

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

const PORT = 5174;

// First get the processed cart (has all stores)
const cart = await get(`http://localhost:${PORT}/api/pharmarack/cart?fresh=true`);
console.log(`\n=== LIVE CART: ${cart.distributors?.length ?? 0} distributor(s) ===\n`);

// Then get the raw debug data (has MinAmountLimit per line item)
const raw = await get(`http://localhost:${PORT}/api/pharmarack/cart-raw-debug`);

// The raw debug only shows the FIRST store. We need to fetch the IList directly.
// Let's also hit the standard cart and cross-reference.
// Since MinAmountLimit is per line item per store, let's map it out from processed cart + raw.

// Build a map of storeId -> min limits from the firstStoreSample
const minMap = {};
if (raw.firstStoreSample) {
  // Get from first item in lineItems
  const firstItem = raw.firstStoreSample.lineItems?.[0];
  if (firstItem) {
    minMap[raw.firstStoreSample.StoreId] = {
      storeName: raw.firstStoreSample.StoreName,
      minAmountLimit: firstItem.MinAmountLimit ?? 0,
      minItemLimit: firstItem.MinItemLimit ?? 0,
      allowMOQ: firstItem.AllowMOQ ?? false,
      maxItemLimit: firstItem.MaxItemLimit ?? 0,
    };
  }
}

console.log('=== DISTRIBUTOR MINIMUM ORDER ANALYSIS ===\n');

let allMeet = true;
const belowMinList = [];

for (const dist of (cart.distributors ?? [])) {
  const storeId = dist.storeId;
  const lineTotal = dist.lineTotal ?? 0;
  const itemCount = dist.items?.length ?? 0;
  const minInfo = minMap[storeId];
  
  // MinAmountLimit is on each item - grab from the cart items if we have it
  // Since our processed cart doesn't carry it yet, check minMap or assume 0
  const minAmount = minInfo?.minAmountLimit ?? 0;
  const minItems = minInfo?.minItemLimit ?? 0;
  const meetsAmount = minAmount === 0 || lineTotal >= minAmount;
  const meetsItems = minItems === 0 || itemCount >= minItems;
  const isOk = meetsAmount && meetsItems;

  if (!isOk) {
    allMeet = false;
    belowMinList.push({
      storeName: dist.storeName,
      lineTotal,
      minAmount,
      shortfall: minAmount - lineTotal,
      itemCount,
      minItems,
    });
  }

  const status = minAmount === 0 ? '✅ No Min' : (isOk ? '✅ READY' : '🔴 BELOW MIN');
  console.log(`${status} | ${dist.storeName}`);
  console.log(`   Cart Total: ₹${lineTotal.toFixed(2)} | Items: ${itemCount}`);
  if (minAmount > 0) {
    console.log(`   Min Required: ₹${minAmount} | Shortfall: ₹${Math.max(0, minAmount - lineTotal).toFixed(2)}`);
  }
  if (minItems > 0) {
    console.log(`   Min Items: ${minItems} | Have: ${itemCount}`);
  }
  console.log(`   Products: ${dist.items?.map(i => i.productName).join(', ')}`);
  console.log('');
}

console.log('=== SUMMARY ===');
console.log(`Total Distributors: ${cart.distributors?.length ?? 0}`);
console.log(`Below Minimum: ${belowMinList.length}`);
if (belowMinList.length > 0) {
  console.log('\n🚫 WOULD BLOCK "Send All" — These need more items:');
  for (const b of belowMinList) {
    console.log(`  • ${b.storeName}: ₹${b.lineTotal.toFixed(2)} / ₹${b.minAmount} (needs ₹${b.shortfall.toFixed(2)} more)`);
  }
} else {
  console.log('✅ All distributors meet minimum — "Send All" would proceed!');
}

console.log('\n=== NOTE ===');
console.log('MinAmountLimit data is per line item in Pharmarack API.');
console.log('Currently only the first store is inspected via /cart-raw-debug.');
console.log('After IMPLEMENT, ALL stores will carry this data through the full pipeline.');
