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
| `SITE_OWNER_EMAIL` | The email address of the account that should see the Site Admin panel. Must match exactly (case-insensitive) the email used to sign up/sign in. Also used as the default recipient for contact form submissions. |

## Optional environment variables
| Variable | Description |
|---|---|
| `CONTACT_TO_EMAIL` | Email address that receives Contact Us form submissions. If not set, falls back to `SITE_OWNER_EMAIL`, then to `admin@kwickbiz.biz`. Useful if you want contact messages to go to a different inbox (e.g. `support@kwickbiz.biz`) than the site owner. |

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

### 3. Site Owner Admin panel (`/site-admin`) — STANDALONE
The Site Admin portal is now a **standalone** page with a clean, minimal layout — no main
site header, navigation, or footer. It is reachable **only** via its direct URL
(`/site-admin`) — the link has been removed from the main site header and mobile menu to
keep the access path clean and unambiguous.

What the Site Admin page shows:
- **If you are signed-out** → a clean sign-in form (the public site is hidden behind it).
- **If you are signed-in but NOT the site owner** → a "Not authorised" page with a sign-out button.
- **If you are signed-in as the site owner** (email matches `SITE_OWNER_EMAIL`) → the full
  Site Owner Dashboard:
  - **Edit plan pricing** — name, price label, tagline, amount (in cents), and feature list
    for each of the 3 plans. Changes take effect immediately for every visitor, no redeploy.
  - **Edit general settings** — site tagline, support email.
  - **Review pending refund requests** — approve (best-effort calls HandyPay's refund API
    if `HANDYPAY_API_KEY` is set) or decline.
  - **See recent signups** — email, plan, signup date.

The regular per-memorial Admin panel (`/admin/:id`) and Creator Dashboard
(`/dashboard/:id`) remain unchanged.

### 4. Background music on memorial pages — FIXED
- The music bar no longer hides behind the portrait — it now sits cleanly below the
  portrait / name / actions row.
- The Play / Pause button reflects the **actual** audio state (was previously hard-coded
  to "Pause" whenever the dashboard Autoplay toggle was on, even when the browser had
  blocked autoplay).
- Browsers' autoplay policy is respected: if `musicOn` is enabled in the dashboard, the
  page tries to start playback on load; if the browser blocks it, the button falls back
  to "Play music" so the visitor can start it with a click.
- The dashboard help text now warns that **only direct audio-file URLs (`.mp3` / `.ogg`)
  work** — web pages like SoundCloud, Mixcloud, or `archive.org/details/...` cannot be
  played by the `<audio>` element and should not be used.

### 5. Private memorials — now actually private
Setting a memorial to **Private** in the Dashboard now genuinely hides it:
- Anonymous visitors and signed-in non-owners receive a **404 / "Not found"** response
  when they hit the direct URL — they cannot view the page, light candles, or post tributes.
- The memorial is excluded from the public Find a Memorial listing (this was already the case).
- Only the signed-in owner can view, edit, or interact with their own private memorials.

If you previously relied on the old behaviour ("the direct link still works for anyone
who has it"), you will now need to share login credentials or keep the memorial public.

### 6. Refund requests (`/request-refund`)
Signed-in users can submit a refund request (plan + optional reason) from a link on the
Plans page. It lands in the Site Admin's pending-refunds queue for review — this is a
manual-approval workflow, not an automatic instant refund, which is the safer default for
a one-time-payment service with no formal returns law covering it.

## Rebuild CSS
`npx tailwindcss@3.4.17 -i tailwind-input.css -o styles.css --content index.html --minify`
