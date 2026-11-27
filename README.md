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
| `HANDYPAY_API_KEY` | From merchant.handypay.me → API Keys |
| `HANDYPAY_WEBHOOK_SECRET` | From HandyPay portal → Webhooks |
| `SITE_OWNER_EMAIL` | **New.** The email address of the account that should see the Site Admin panel. Must match exactly (case-insensitive) the email used to sign up/sign in. |

## What's new in this release

### 1. Clearer Sign In / Create Account
The header now shows explicit **SIGN IN** and **CREATE MEMORIAL** buttons when logged out,
and **MY ACCOUNT** / **SIGN OUT** when logged in — both on desktop and the mobile menu.

### 2. Memorial colour themes
- When creating a memorial, the creator picks an accent colour from 8 swatches.
- The colour can be changed any time from the memorial's **Dashboard**.
- The colour is used on the memorial's header gradient, active tab, and its card
  on Home / Find a Memorial.
- Memorials with no colour chosen keep the original name-based gradient as before.

### 3. Site Owner Admin panel (`/site-admin`)
Visible only to the account whose email matches `SITE_OWNER_EMAIL`. From here the owner can:
- **Edit plan pricing** — name, price label, tagline, amount (in cents), and feature list
  for each of the 3 plans. Changes take effect immediately for every visitor, no redeploy.
- **Edit general settings** — site tagline, support email.
- **Review pending refund requests** — approve (best-effort calls HandyPay's refund API
  if `HANDYPAY_API_KEY` is set) or decline.
- **See recent signups** — email, plan, signup date.

A link to Site Admin appears in the header and mobile menu only for the owner account.

### 4. Refund requests (`/request-refund`)
Signed-in users can submit a refund request (plan + optional reason) from a link on the
Plans page. It lands in the Site Admin's pending-refunds queue for review — this is a
manual-approval workflow, not an automatic instant refund, which is the safer default for
a one-time-payment service with no formal returns law covering it.

## Rebuild CSS
`npx tailwindcss@3.4.17 -i tailwind-input.css -o styles.css --content index.html --minify`
