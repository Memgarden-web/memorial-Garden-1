# Sweet Solace — Netlify deploy (with shared data)

Memorials, tributes, candles, photos, visit counts and accounts are now stored on the server
(Netlify Functions + Netlify Blobs). Sign-in is email + password.

## Deploy (functions need a real Netlify build — dragging a folder into Netlify Drop is NOT enough)
**Option A – Git:** push this folder to GitHub/GitLab, then Netlify → Add new site → Import from Git.
Leave the build command empty; publish directory is `.` (already set in `netlify.toml`).

**Option B – CLI:**
```
npm install
npx netlify-cli login
npx netlify-cli init            # or: netlify link
npx netlify-cli deploy --prod
```

## Required setting
Site configuration → Environment variables → add **SESSION_SECRET** = a long random string
(at least 32 characters, e.g. output of `openssl rand -base64 48`). Keep it secret; changing it
signs everyone out. Redeploy after adding it.

## Optional
- Forms: the Contact page posts to Netlify Forms (`contact`). Add email notifications under Forms.
- Custom domain: Site configuration → Domain management.
- If you edit classes in `index.html`, rebuild CSS:
  `npx tailwindcss@3.4.17 -i tailwind-input.css -o styles.css --content index.html --minify`

## How it is protected
- Passwords are hashed with scrypt (per-user salt); never stored or returned in clear text.
- Sessions are signed, HttpOnly, Secure, SameSite=Lax cookies (30 days).
- Login lockout: 8 attempts per email / 40 per IP per 15 minutes. Rate limits also apply to
  sign-ups, memorial creation, tributes (5 per 10 min) and candles (1 per hour per memorial).
- Every change to a memorial (edit, photos, timeline, portrait, delete, moderate tributes)
  is checked on the server against the signed-in owner. Owner emails are never sent to visitors.
- Uploaded images are verified (type + file signature, 400 KB max) and served with a locked-down CSP.

## Known limits (fine for launch, revisit at scale)
- No password reset yet (needs an email service such as Resend/Postmark). Until then, reset manually.
- Visit and candle counters are simple counters; two simultaneous updates can occasionally lose one.
- The memorial list loads up to 300 newest memorials and searches in the browser.
- The 8 sample memorials stay read-only demos; tributes and candles on them are shared.
