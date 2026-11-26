# Sweet Solace — Netlify deploy

## Deploy
Push to GitHub/GitLab → Netlify → Import from Git. Build command: (empty). Publish dir: `.`
Or: `npm install && npx netlify-cli deploy --prod`

## Required environment variables (Netlify → Site config → Environment variables)
| Variable | Description |
|---|---|
| `SESSION_SECRET` | Random ≥32 chars — `openssl rand -base64 48` |
| `RESEND_API_KEY` | From resend.com/api-keys |
| `RESEND_FROM` | Verified sender e.g. `Sweet Solace <admin@kwickbiz.biz>` |
| `HANDYPAY_API_KEY` | From merchant.handypay.me → API Keys → Live key |
| `HANDYPAY_WEBHOOK_SECRET` | From HandyPay portal → Webhooks (see setup below) |

## HandyPay setup
1. Log in to merchant.handypay.me → **API Keys** → copy your **live** key → set as `HANDYPAY_API_KEY`
2. Go to **Webhooks** → Add endpoint:
   `https://your-site.netlify.app/api/webhook`
3. Copy the signing secret shown → set as `HANDYPAY_WEBHOOK_SECRET`
4. Redeploy the site — the Upgrade buttons on /plans will go live immediately.

## How the checkout flow works
- Clicking Upgrade (Lifetime $79 / Family $129) calls `POST /api/checkout`
- The server creates a HandyPay payment session via `POST https://api.handypay.me/v1/payment-sessions`
- The visitor is redirected to HandyPay's hosted Stripe Checkout page
- After payment, HandyPay sends a `payment-session.completed` webhook to your site
- The webhook records the plan upgrade on the user's account

## Rebuild CSS
`npx tailwindcss@3.4.17 -i tailwind-input.css -o styles.css --content index.html --minify`
