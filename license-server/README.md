# AI Pharmacy — License Server

Deployed on Vercel as a subfolder of the main AI-PHARMACY-V3 repo.

## Setup on Vercel

1. Import GitHub repo `AI-PHARMACY-V3` on Vercel
2. Set **Root Directory** = `license-server`
3. Add these **Environment Variables** in Vercel dashboard:
   - `ADMIN_SECRET` = (any strong secret you choose, e.g. a random UUID)
   - `KV_REST_API_URL` = (auto-filled after you add Vercel KV storage)
   - `KV_REST_API_TOKEN` = (auto-filled after you add Vercel KV storage)
4. In Vercel dashboard → Storage → Create KV Store → Link to this project

That's it. Vercel KV fills the env vars automatically.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/license/create` | `x-admin-secret` header | Create a new license |
| POST | `/api/license/activate` | none | Activate license on a PC |
| GET | `/api/license/validate` | none | Validate license on boot |
| POST | `/api/license/reset` | `x-admin-secret` header | Reset machine binding |
| GET | `/api/license/list` | `x-admin-secret` header | List all licenses |
| GET | `/api/updates/check` | none | Check for app update |

## Creating a License (Admin)

```bash
node scripts/createLicense.mjs --pharmacy "Ravi Medicals" --notes "Main counter"
```

Output:
```
✅ License Created
   Pharmacy : Ravi Medicals
   License ID: PHARM-A3B2
   License Key: X7KP-9QRT-M2LN-4WVZ
   
   ⚠️  Store the License Key safely — shown ONCE only.
```

## Releasing a New Update

Edit `license-server/api/updates/check.js` and bump `LATEST_VERSION` + `CHANGELOG`.
Push to GitHub → Vercel auto-deploys in ~30 seconds.
