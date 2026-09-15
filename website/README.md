# AI Pharmacy OS — Cloud Website & Portal

The unified cloud website and serverless backend for **AI Pharmacy OS**, deployed on Vercel at `https://ai-pharmacy-os.vercel.app`.

Contains both the public customer-facing web services and the remote licensing/update center in a single dedicated folder.

---

## Directory Structure

```
website/
├── api/
│   ├── _db.js                # Upstash Redis / Vercel KV cloud data store
│   ├── catalog.js            # Consolidated customer portal & store API (refills, bills, orders, stores)
│   ├── license/              # License validation, activation, creation, resets, deletion, editing
│   │   ├── activate.js
│   │   ├── create.js         # Auto or custom-keyed license generation
│   │   ├── delete.js         # Permanent deletion from Redis
│   │   ├── list.js
│   │   ├── renew.js
│   │   ├── reset.js
│   │   ├── toggle-pilot.js
│   │   ├── update.js         # Manual modification of license details / secret key
│   │   └── validate.js
│   ├── telemetry/            # Anonymous health & usage telemetry
│   └── updates/              # Remote app updates and version checks
├── public/
│   ├── catalog.html          # Universal Customer Web Store, Refill & Billing Portal (/shop)
│   └── index.html            # License Server management console (/license)
├── package.json              # Lightweight Vercel deployment package
└── vercel.json               # Clean rewrites, security headers, and edge cache policies
```

---

## Public URLs & Features

| URL | Purpose |
|-----|---------|
| `https://ai-pharmacy-os.vercel.app/shop` | **Customer Web Store & Patient Health Portal**: Medicine catalog, 1-click refill requests, prescription orders, customer invoices/bills, and store switching. |
| `https://ai-pharmacy-os.vercel.app/license` | **License & Software Management Console**: Activate licenses, view telemetry, and push application updates. |
| `https://ai-pharmacy-os.vercel.app/api/catalog` | Cloud catalog sync, customer auth, refill requests, order dispatch endpoints. |
| `https://ai-pharmacy-os.vercel.app/api/updates/check` | Desktop application auto-updater check. |

---

## Vercel Deployment Settings

1. **Root Directory**: `website`
2. **Framework Preset**: Other
3. **Environment Variables**:
   - `KV_REST_API_URL` (or Upstash Redis URL)
   - `KV_REST_API_TOKEN` (or Upstash Redis Token)
   - `ADMIN_SECRET` (Secure key for admin license generation and catalog pushing)

---

## Releasing a Desktop Update

Edit `website/api/updates/check.js` and bump `LATEST_VERSION` + `CHANGELOG`.
Push to GitHub → Vercel deploys immediately.
