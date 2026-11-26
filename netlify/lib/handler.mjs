// Sweet Solace API — Netlify Function + Netlify Blobs
// Auth: email + scrypt-hashed password, signed HttpOnly cookies
// Email: Resend (welcome, password-reset, tribute notifications)
import crypto from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(crypto.scrypt);

const SEED = new Set(["bruce-warburton","richard-john-parrott","francis-zvomuya","nguby-naz-ngu","jinny-henson","margaret-ellis","theodore-p-hill","claire-bennett"]);
const CATS = new Set(["Family","Veteran","Community hero"]);
const MAXIMG = 400_000, DAY = 864e5, PAGE = 24;
const hex = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const rid = (n = 4) => crypto.randomBytes(n).toString("hex");

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m, s = 400) => new HttpError(s, m);

// ---- email via Resend ----
async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("RESEND_API_KEY not set — skipping email"); return; }
  const from = process.env.RESEND_FROM || "Sweet Solace <noreply@sweetsolace.com>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!r.ok) console.error("Resend error", r.status, await r.text().catch(() => ""));
}

const emailBase = (body) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{font-family:Inter,system-ui,sans-serif;background:#f0f9ff;margin:0;padding:32px 16px}
  .card{background:#fff;border-radius:16px;max-width:520px;margin:0 auto;padding:40px;box-shadow:0 2px 16px rgba(14,165,233,.1)}
  h1{color:#0c4a6e;font-size:22px;margin:0 0 16px} p{color:#334155;line-height:1.6;margin:8px 0}
  .btn{display:inline-block;background:#0ea5e9;color:#fff!important;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;margin:20px 0}
  .footer{text-align:center;color:#94a3b8;font-size:12px;margin-top:24px}
  .dove{font-size:36px;text-align:center;margin-bottom:16px}
</style></head><body><div class="card"><div class="dove">🕊️</div>${body}<div class="footer">Sweet Solace · Making memories last forever<br>If you didn't request this, you can safely ignore it.</div></div></body></html>`;

const welcomeEmail = (name, id, origin) => sendEmail({
  to: name,
  subject: "Your memorial is live on Sweet Solace",
  html: emailBase(`<h1>Your memorial is live 🕊️</h1>
    <p>Thank you for creating a memorial on Sweet Solace. It's already online and ready to share with family and friends.</p>
    <a class="btn" href="${origin}/${id}/about">View memorial</a>
    <p>You can manage your memorial — add photos, edit the story, moderate tributes — from your account page.</p>
    <a class="btn" href="${origin}/admin/${id}" style="background:#0c4a6e">Manage memorial</a>
    <p>Share the link with everyone who loved them.</p>`),
});

const tributeEmail = (ownerEmail, tributerName, memName, msg, memId, origin) => sendEmail({
  to: ownerEmail,
  subject: `${tributerName} left a tribute for ${memName}`,
  html: emailBase(`<h1>A new tribute was left</h1>
    <p><strong>${tributerName}</strong> wrote a tribute on the memorial for <strong>${memName}</strong>:</p>
    <blockquote style="border-left:4px solid #0ea5e9;padding-left:16px;color:#475569;font-style:italic;margin:16px 0">${msg.replace(/</g,"&lt;")}</blockquote>
    <a class="btn" href="${origin}/${memId}/tributes">View tributes</a>
    <p>You can manage or moderate tributes from the memorial's admin page.</p>`),
});

const resetEmail = (toEmail, token, origin) => sendEmail({
  to: toEmail,
  subject: "Reset your Sweet Solace password",
  html: emailBase(`<h1>Reset your password</h1>
    <p>We received a request to reset the password for your Sweet Solace account.</p>
    <a class="btn" href="${origin}/reset-password?token=${token}">Reset password</a>
    <p>This link expires in <strong>1 hour</strong>. If you didn't request this, you can safely ignore this email — your password won't change.</p>`),
});

export function createHandler(getStore) {
  const db = () => getStore({ name: "sweetsolace", consistency: "strong" });
  const im = () => getStore({ name: "sweetsolace-img", consistency: "strong" });

  const J = (o, status = 200, extra = {}) =>
    new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });

  // ---- sessions ----
  const secret = () => {
    const s = process.env.SESSION_SECRET;
    if (!s || s.length < 32) throw bad("Server is not configured (SESSION_SECRET missing).", 500);
    return s;
  };
  const mac = (b) => crypto.createHmac("sha256", secret()).update(b).digest("base64url");
  const sign = (p) => { const b = Buffer.from(JSON.stringify(p)).toString("base64url"); return b + "." + mac(b); };
  const verify = (t) => {
    if (!t) return null;
    const [b, sig] = t.split(".");
    if (!b || !sig) return null;
    const x = Buffer.from(mac(b)), y = Buffer.from(sig);
    if (x.length !== y.length || !crypto.timingSafeEqual(x, y)) return null;
    try { const p = JSON.parse(Buffer.from(b, "base64url").toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
  };
  const getUser = (req) => {
    const c = (req.headers.get("cookie") || "").split(";").map((s) => s.trim()).find((s) => s.startsWith("ss="));
    return c ? verify(c.slice(3)) : null;
  };
  const setCookie = (v, age) => ({ "Set-Cookie": `ss=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}` });

  // ---- rate limiting ----
  async function gate(key, max, win) {
    const k = "rl/" + hex(key), now = Date.now();
    const r = await db().get(k, { type: "json" });
    const cur = r && now - r.t < win ? r : { n: 0, t: now };
    if (cur.n >= max) throw bad("Too many attempts. Please try again later.", 429);
    cur.n++;
    await db().setJSON(k, cur);
    return k;
  }

  // ---- helpers ----
  const okId = (s) => /^[a-z0-9-]{1,90}$/.test(s || "");
  const getRec = async (id) => (okId(id) ? db().get("m/" + id, { type: "json" }) : null);
  const str = (v, max, min = 0) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (s.length < min || s.length > max) throw bad("Invalid text length.");
    return s;
  };
  const yr = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1000 || n > 2100) throw bad("Invalid year."); return n; };
  const pub = (r, me) => ({ id: r.id, name: r.name, b: r.b, d: r.d, cat: r.cat, story: r.story, pic: r.pv ? `/api/img/${r.id}/pic?v=${r.pv}` : "", mine: !!(me && r.owner === me.e), music: r.mine || (me && r.owner===me.e) ? (r.music||"") : (r.music||""), musicOn: !!r.musicOn, isPrivate: !!r.isPrivate, tributeMode: r.tributeMode||"open" });
  const owned = async (id, me) => {
    if (!me) throw bad("Please sign in.", 401);
    const r = await getRec(id);
    if (!r) throw bad("Not found.", 404);
    if (r.owner !== me.e) throw bad("You do not have access to this memorial.", 403);
    return r;
  };
  const saveRec = (r) => db().setJSON("m/" + r.id, r);
  const stats = async (id) => (await db().get("s/" + id, { type: "json" })) || { c: 0, v: 0 };
  async function tributes(id) {
    const { blobs } = await db().list({ prefix: `t/${id}/` });
    const all = await Promise.all(blobs.slice(0, 300).map((b) => db().get(b.key, { type: "json" }).then((t) => t && { k: b.key.split("/").pop(), n: t.n, m: t.m })));
    return all.filter(Boolean).sort((a, b) => parseInt(b.k) - parseInt(a.k)).slice(0, 200);
  }
  function decodeImg(durl) {
    const mt = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(durl || "");
    if (!mt) throw bad("Unsupported image.");
    const buf = Buffer.from(mt[2], "base64");
    if (buf.length > MAXIMG) throw bad("Image too large.", 413);
    const h = buf.subarray(0, 12), t = mt[1];
    const ok = (t === "jpeg" && h[0] === 0xff && h[1] === 0xd8) || (t === "png" && h.subarray(0, 4).toString("hex") === "89504e47") || (t === "webp" && h.subarray(0, 4).toString() === "RIFF" && h.subarray(8, 12).toString() === "WEBP");
    if (!ok) throw bad("Unsupported image.");
    return { ab: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), type: "image/" + t };
  }
  const putImg = (key, durl) => { const { ab, type } = decodeImg(durl); return im().set(key, ab, { metadata: { type } }); };

  async function removeMemorial(id) {
    const d = db(), i = im();
    await d.delete("m/" + id); await d.delete("s/" + id);
    for (const b of (await d.list({ prefix: `t/${id}/` })).blobs) await d.delete(b.key);
    for (const b of (await i.list({ prefix: id + "/" })).blobs) await i.delete(b.key);
  }

  // ---- sitemap ----
  async function buildSitemap(origin) {
    const { blobs } = await db().list({ prefix: "m/" });
    const ids = blobs.map((b) => b.key.slice(2));
    const staticPages = ["", "about", "memorial-websites", "plans", "find-memorial", "testimonials", "resources", "blog", "contact"];
    const urls = [
      ...staticPages.map((p) => `  <url><loc>${origin}/${p}</loc><changefreq>weekly</changefreq></url>`),
      ...ids.map((id) => `  <url><loc>${origin}/${id}/about</loc><changefreq>weekly</changefreq></url>`),
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
  }

  async function handle(req, context) {
    const url = new URL(req.url), method = req.method;
    const p = url.pathname.replace(/^\/(\.netlify\/functions\/api|api)/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const [a, b, c, d, e] = p;
    const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
    const origin = url.origin;

    if (method !== "GET" && method !== "HEAD") {
      const o = req.headers.get("origin");
      if (o && new URL(o).host !== url.host) throw bad("Cross-site request blocked.", 403);
    }
    const body = async () => {
      if (!(req.headers.get("content-type") || "").includes("application/json")) throw bad("Expected JSON.", 415);
      const t = await req.text();
      if (t.length > 1_500_000) throw bad("Request too large.", 413);
      try { return JSON.parse(t || "{}"); } catch { throw bad("Bad JSON."); }
    };
    const me = getUser(req);

    // ---- sitemap ----
    // ---- HandyPay checkout session ----
    if (a === "checkout" && method === "POST") {
      if (!me) throw bad("Please sign in.", 401);
      const j = await body();
      const PLANS = {
        lifetime: { amount_cents: 7900, currency: "USD", name: "Sweet Solace Lifetime Plan" },
        family:   { amount_cents: 12900, currency: "USD", name: "Sweet Solace Family Plan (5 memorials)" },
      };
      const plan = PLANS[j.plan];
      if (!plan) throw bad("Invalid plan.");
      const hpKey = process.env.HANDYPAY_API_KEY;
      if (!hpKey) throw bad("Payment is not yet configured. Please contact us at admin@kwickbiz.biz to upgrade.", 503);

      const successUrl = `${origin}/plans?upgraded=${encodeURIComponent(j.plan)}`;
      const cancelUrl  = `${origin}/plans`;
      const idempotencyKey = rid(16); // unique per attempt — prevents double-charges on retry

      // POST /api/v1/payment-sessions — correct base URL per HandyPay developer docs
      const r = await fetch("https://api.handypay.me/api/v1/payment-sessions", {
        method: "POST",
        headers: {
          "Authorization":   `Bearer ${hpKey}`,
          "Content-Type":    "application/json",
          "Accept":          "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          line_items: [{ amount: plan.amount_cents, currency: plan.currency, name: plan.name, quantity: 1 }],
          success_url:    successUrl,
          cancel_url:     cancelUrl,
          customer_email: me.e,
          metadata:       { plan: j.plan, email: me.e },
        }),
      });

      let data = {};
      const raw = await r.text();
      try { data = JSON.parse(raw); } catch (_) {}
      console.log("HandyPay response", r.status, raw.slice(0, 500));

      // Response envelope: { success: bool, data: { url, ... } }
      if (data?.success && data?.data?.url) return J({ url: data.data.url });
      // Some API versions return url at root on success
      if (r.ok && (data?.url || data?.checkout_url)) return J({ url: data.url || data.checkout_url });

      const errMsg = data?.error?.message || data?.message || `HTTP ${r.status}`;
      console.error("HandyPay error", r.status, errMsg);
      throw bad(`Payment session could not be created: ${errMsg}. Please try again or contact admin@kwickbiz.biz.`, 502);
    }

    if (a === "sitemap" && method === "GET") {
      const xml = await buildSitemap(origin.replace("/.netlify/functions", ""));
      return new Response(xml, { headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" } });
    }

    // ---- accounts ----
    if (a === "me" && method === "GET") return J({ email: me ? me.e : null });
    if (a === "logout" && method === "POST") return J({ ok: true }, 200, setCookie("", 0));

    if ((a === "signup" || a === "login") && method === "POST") {
      const j = await body();
      const email = str(j.email, 254, 3).toLowerCase();
      const pw = typeof j.password === "string" ? j.password : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("Please enter a valid email address.");
      const key = "u/" + hex(email);
      if (a === "signup") {
        if (pw.length < 8 || pw.length > 200) throw bad("Password must be 8–200 characters.");
        await gate("signup:" + ip, 10, 36e5);
        if (await db().get(key, { type: "json" })) throw bad("An account with that email already exists. Please sign in.", 409);
        const salt = rid(16), hash = (await scrypt(pw, salt, 64)).toString("hex");
        await db().setJSON(key, { email, salt, hash, created: Date.now() });
      } else {
        const gk = await gate("login:" + email, 9, 15 * 60e3);
        await gate("loginip:" + ip, 40, 15 * 60e3);
        const u = await db().get(key, { type: "json" });
        const hash = (await scrypt(pw.slice(0, 200), u ? u.salt : "x".repeat(32), 64)).toString("hex");
        if (!u || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(u.hash))) throw bad("Incorrect email or password.", 401);
        await db().delete(gk);
      }
      return J({ email }, 200, setCookie(sign({ e: email, exp: Date.now() + 30 * DAY }), 30 * 86400));
    }

    // ---- password reset ----
    if (a === "forgot" && method === "POST") {
      const j = await body();
      const email = str(j.email, 254, 3).toLowerCase();
      await gate("forgot:" + ip, 5, 36e5);
      // Always respond OK to avoid email enumeration
      const u = await db().get("u/" + hex(email), { type: "json" });
      if (u) {
        const token = rid(24);
        await db().setJSON("rst/" + hex(token), { email, exp: Date.now() + 36e5 });
        await resetEmail(email, token, origin);
      }
      return J({ ok: true });
    }
    if (a === "reset" && method === "POST") {
      const j = await body();
      const token = str(j.token, 200, 10);
      const pw = typeof j.password === "string" ? j.password : "";
      if (pw.length < 8 || pw.length > 200) throw bad("Password must be 8–200 characters.");
      const rk = "rst/" + hex(token);
      const rec = await db().get(rk, { type: "json" });
      if (!rec || rec.exp < Date.now()) throw bad("This reset link has expired. Please request a new one.", 410);
      await db().delete(rk);
      const key = "u/" + hex(rec.email);
      const u = await db().get(key, { type: "json" });
      if (!u) throw bad("Account not found.", 404);
      const salt = rid(16), hash = (await scrypt(pw, salt, 64)).toString("hex");
      await db().setJSON(key, { ...u, salt, hash });
      return J({ ok: true }, 200, setCookie(sign({ e: rec.email, exp: Date.now() + 30 * DAY }), 30 * 86400));
    }

    // ---- images ----
    if (a === "img" && method === "GET" && okId(b) && /^[a-z0-9]{1,20}$/.test(c || "")) {
      const r = await im().getWithMetadata(`${b}/${c}`, { type: "arrayBuffer" });
      if (!r) throw bad("Not found.", 404);
      return new Response(r.data, { headers: { "Content-Type": r.metadata?.type || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
    }

    // ---- HandyPay webhook ----
    if (a === "webhook" && method === "POST") {
      const raw = await req.text();
      const secret = process.env.HANDYPAY_WEBHOOK_SECRET;
      if (secret) {
        // Header: "X-HandyPay-Signature: sha256=<hex>" (from webhook.php source)
        let sig = req.headers.get("x-handypay-signature") || req.headers.get("handypay-signature") || "";
        if (sig.toLowerCase().startsWith("sha256=")) sig = sig.slice(7);
        const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
        const eBuf = Buffer.from(expected, "utf8"), sBuf = Buffer.from(sig.padEnd(expected.length), "utf8");
        if (eBuf.length !== sBuf.length || !crypto.timingSafeEqual(eBuf, sBuf)) {
          return new Response(JSON.stringify({ error: "invalid_signature" }), { status: 401 });
        }
      }
      let ev = {};
      try { ev = JSON.parse(raw); } catch (_) {}
      if (!ev.type) return new Response("ok", { status: 200 });

      // Event names from webhook.php: payment-session.completed, checkout.session.completed
      const paid = ["payment-session.completed", "checkout.session.completed",
                    "checkout.session.async_payment_succeeded", "payment_intent.succeeded"];
      if (paid.includes(ev.type)) {
        const d = ev.data || {};
        const email = (d.customer_email || d.metadata?.email || "").toLowerCase();
        const plan  = d.metadata?.plan || "lifetime";
        if (email) {
          const key = "u/" + hex(email);
          const u = await db().get(key, { type: "json" });
          if (u) { u.plan = plan; u.planDate = Date.now(); await db().setJSON(key, u); }
        }
      }
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    if (a !== "memorials") throw bad("Not found.", 404);

    // ---- list / create ----
    if (!b) {
      if (method === "GET") {
        const q = url.searchParams.get("q")?.toLowerCase() || "";
        const cat = url.searchParams.get("cat") || "";
        const cursor = url.searchParams.get("cursor") || "";
        const { blobs } = await db().list({ prefix: "m/" });
        // Fetch all keys to allow filtering, but limit fetch to recent PAGE*5 unless searching
        const keys = blobs.map((b) => b.key);
        const recs = (await Promise.all(keys.map((x) => db().get(x, { type: "json" })))).filter(Boolean)
          .sort((x, y) => y.created - x.created);
        const isOwnerEmail = me ? me.e : null;
        const filtered = recs.filter((r) =>
          (!r.isPrivate || r.owner === isOwnerEmail) &&
          (!q || r.name.toLowerCase().includes(q)) &&
          (!cat || r.cat === cat)
        );
        // Pagination: find cursor position, return PAGE items
        const start = cursor ? filtered.findIndex((r) => r.id === cursor) + 1 : 0;
        const page = filtered.slice(start, start + PAGE);
        const nextCursor = page.length === PAGE && start + PAGE < filtered.length ? page[page.length - 1].id : null;
        return J({ list: page.map((r) => { const { story, ...s } = pub(r, me); return s; }), nextCursor, total: filtered.length });
      }
      if (method === "POST") {
        if (!me) throw bad("Please sign in.", 401);
        await gate("create:" + ip, 10, DAY);
        const j = await body();
        const first = str(j.first_name, 60, 1), last = str(j.last_name, 60, 1);
        const bY = yr(j.b), dY = yr(j.d);
        if (bY > dY) throw bad("Year born must not be after year passed.");
        if (!CATS.has(j.cat)) throw bad("Invalid category.");
        const slug = (first + "-" + last).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "memorial";
        const id = slug + "-" + rid(2);
        const rec = { id, name: first + " " + last, b: bY, d: dY, cat: j.cat, story: str(j.story || "Remembered with love.", 5000, 1), owner: me.e, pv: 0, photos: [], events: [], created: Date.now() };
        if (j.pic) { await putImg(id + "/pic", j.pic); rec.pv = Date.now(); }
        await saveRec(rec);
        // Welcome email (non-blocking)
        welcomeEmail(me.e, id, origin).catch(() => {});
        return J({ id }, 201);
      }
      throw bad("Method not allowed.", 405);
    }

    // ---- one memorial ----
    if (!okId(b)) throw bad("Not found.", 404);
    const rec = await getRec(b);
    if (!rec && !SEED.has(b)) throw bad("Not found.", 404);

    if (!c) {
      if (method === "GET") {
        const st = await stats(b);
        if (url.searchParams.get("visit")) { st.v++; await db().setJSON("s/" + b, st); }
        const isMine = !!(me && rec && rec.owner === me.e);
        const tList = await tributes(b);
        // For non-owners, hide pending tributes
        const tFiltered = isMine ? tList : tList.filter(t => !t.pending);
        const photos = rec ? rec.photos.map(i => i.includes("|") ? i.split("|")[1] : `/api/img/${b}/${i}`) : [];
        return J({ m: rec ? pub(rec, me) : null, stats: { c: st.c, v: st.v, t: tFiltered, ev: rec ? rec.events : [], ph: photos, music: rec?.music||"", musicOn: !!rec?.musicOn, tributeMode: rec?.tributeMode||"open" } });
      }
      if (method === "PATCH") {
        const r = await owned(b, me), j = await body();
        const bY = yr(j.b), dY = yr(j.d);
        if (bY > dY) throw bad("Year born must not be after year passed.");
        if (!CATS.has(j.cat)) throw bad("Invalid category.");
        Object.assign(r, { name: str(j.name, 120, 1), b: bY, d: dY, cat: j.cat, story: str(j.story, 5000, 1) });
        await saveRec(r);
        return J({ ok: true });
      }
      if (method === "DELETE") { const r = await owned(b, me); await removeMemorial(r.id); return J({ ok: true }); }
      throw bad("Method not allowed.", 405);
    }

    if (c === "candle" && method === "POST") {
      await gate(`candle:${ip}:${b}`, 1, 36e5);
      const st = await stats(b); st.c++; await db().setJSON("s/" + b, st);
      return J({ c: st.c });
    }
    if (c === "tributes") {
      // Approve: POST /memorials/:id/tributes/:key/approve
      if (d && e === "approve" && method === "POST") {
        await owned(b, me);
        const tk = `t/${b}/${d}`;
        const tv = await db().get(tk, { type: "json" });
        if (!tv) throw bad("Tribute not found.", 404);
        tv.pending = false;
        await db().setJSON(tk, tv);
        return J({ ok: true });
      }
      if (method === "POST") {
        await gate("tribute:" + ip, 5, 10 * 60e3);
        const j = await body();
        const n = str(j.n, 60, 1), m = str(j.m, 1000, 1);
        const k = `${Date.now()}-${rid(3)}`;
        const mode = rec?.tributeMode || "open";
        if (mode === "closed") throw bad("Tributes are currently closed for this memorial.", 403);
        const pending = mode === "moderated";
        await db().setJSON(`t/${b}/${k}`, { n, m, pending });
        // Notify owner (non-blocking)
        if (rec) {
          const msg = pending
            ? `${n} submitted a tribute for your approval on the memorial for ${rec.name}.`
            : m;
          tributeEmail(rec.owner, n, rec.name, msg, b, origin).catch(() => {});
        }
        return J({ k, pending }, 201);
      }
      if (method === "DELETE" && d && /^[0-9]+-[a-f0-9]+$/.test(d)) { await owned(b, me); await db().delete(`t/${b}/${d}`); return J({ ok: true }); }
    }
    if (!rec) throw bad("Not found.", 404);
    if (c === "pic" && method === "PUT") {
      const r = await owned(b, me), j = await body();
      if (j.pic) { await putImg(b + "/pic", j.pic); r.pv = Date.now(); } else { await im().delete(b + "/pic"); r.pv = 0; }
      await saveRec(r); return J({ ok: true });
    }
    if (c === "photos") {
      const r = await owned(b, me);
      if (method === "POST") {
        if (r.photos.length >= 12) throw bad("Photo limit reached (12).");
        const j = await body(), pid = rid(5);
        await putImg(`${b}/${pid}`, j.photo);
        r.photos.unshift(pid); await saveRec(r); return J({ id: pid }, 201);
      }
      if (method === "DELETE" && /^[a-z0-9]{1,20}$/.test(d || "")) {
        r.photos = r.photos.filter((x) => x !== d); await im().delete(`${b}/${d}`); await saveRec(r); return J({ ok: true });
      }
    }
    if (c === "events") {
      const r = await owned(b, me);
      if (method === "POST") {
        if (r.events.length >= 100) throw bad("Timeline limit reached.");
        const j = await body();
        r.events.push({ k: `${Date.now()}-${rid(2)}`, y: yr(j.y), t: str(j.t, 100, 1), x: str(j.x || "", 500) });
        await saveRec(r); return J({ ok: true }, 201);
      }
      if (method === "DELETE" && d) { r.events = r.events.filter((e) => e.k !== d); await saveRec(r); return J({ ok: true }); }
    }

    // ---- dashboard settings (music, visibility, tribute mode) ----
    if (c === "settings" && method === "PATCH") {
      const r = await owned(b, me), j = await body();
      if ("music" in j) r.music = str(j.music || "", 500);
      if ("musicOn" in j) r.musicOn = !!j.musicOn;
      if ("isPrivate" in j) r.isPrivate = !!j.isPrivate;
      if ("tributeMode" in j) {
        if (!["open","moderated","closed"].includes(j.tributeMode)) throw bad("Invalid tribute mode.");
        r.tributeMode = j.tributeMode;
      }
      await saveRec(r); return J({ ok: true });
    }

    // ---- photo by URL ----
    if (c === "photos" && method === "POST") {
      // already handled above for file uploads; this branch handles URL-only posts
      const r = await owned(b, me);
      if (r.photos.length >= 12) throw bad("Photo limit reached (12).");
      const j = await body();
      if (j.url) {
        // Validate it looks like an image URL
        const u = str(j.url, 1000, 10);
        if (!/^https?:\/\/.+/i.test(u)) throw bad("Please enter a valid https:// URL.");
        const pid = "u-" + rid(5); // prefix 'u-' marks URL-based photos
        r.photos.unshift(pid + "|" + u); // store as "pid|url"
        await saveRec(r); return J({ id: pid }, 201);
      }
    }

    // ---- tribute approve ----
    if (c === "tributes" && d === "approve" && method === "POST") {
      // d is the tribute key when path is /tributes/:key/approve — but our router splits [a,b,c,d]
      // so for /memorials/:id/tributes/:key/approve the segments are [memorials, id, tributes, key]
      // and "approve" would be e — re-read from path
      const [,, , tkey, action] = p;
      await owned(b, me);
      if (!tkey) throw bad("Missing tribute key.");
      const tk = `t/${b}/${tkey}`;
      const t = await db().get(tk, { type: "json" });
      if (!t) throw bad("Tribute not found.", 404);
      t.pending = false;
      await db().setJSON(tk, t);
      return J({ ok: true });
    }

    throw bad("Not found.", 404);
  }

  return async (req, context) => {
    try { return await handle(req, context); }
    catch (e) {
      if (e instanceof HttpError) return J({ error: e.message }, e.status);
      console.error(e);
      return J({ error: "Server error." }, 500);
    }
  };
}
// ---- PATCH: extend handle() to cover new routes ----
// We monkey-patch by wrapping the exported factory.
import { createHandler as _orig } from "./handler.mjs";
