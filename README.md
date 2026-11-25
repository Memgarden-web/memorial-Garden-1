# Sweet Solace — Netlify deploy

## Deploy
Push to GitHub/GitLab → Netlify → Import from Git. Build command: (empty). Publish dir: `.`
Or via CLI: `npm install && npx netlify-cli deploy --prod`

## Required environment variables (Netlify → Site config → Environment variables)
| Variable | Description |
|---|---|
| `SESSION_SECRET` | Random ≥32 chars — `openssl rand -base64 48` |
| `RESEND_API_KEY` | From resend.com/api-keys |
| `RESEND_FROM` | Verified sender e.g. `Sweet Solace <admin@kwickbiz.biz>` |
| `HANDYPAY_API_KEY` | From your HandyPay merchant portal (merchant.handypay.me) |
| `HANDYPAY_WEBHOOK_SECRET` | Signing secret from HandyPay portal webhook settings |

## HandyPay setup
1. Log in to merchant.handypay.me → API Keys → copy your live key → set as `HANDYPAY_API_KEY`
2. In the HandyPay portal → Webhooks → add your site URL:
   `https://your-site.netlify.app/api/webhook`
   (also works at `/webhook/handypay`)
3. Copy the webhook signing secret → set as `HANDYPAY_WEBHOOK_SECRET`
4. Set `HANDYPAY_API_KEY` and redeploy — the Upgrade buttons on /plans will go live.
   Until then, clicking Upgrade shows a friendly "contact us" message instead of breaking.

## Emails (all now use admin@kwickbiz.biz)
- Welcome email on memorial creation
- Tribute notifications to memorial owner
- Password reset link (expires 1 hour)

## Photo lightbox
Gallery photos on every memorial page zoom to full-screen when clicked.
Arrow keys ← → and Escape also navigate/close the lightbox.

## Rebuild CSS
`npx tailwindcss@3.4.17 -i tailwind-input.css -o styles.css --content index.html --minify`
