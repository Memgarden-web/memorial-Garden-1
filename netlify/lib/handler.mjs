// Sweet Solace API — Netlify Function (v2) + Netlify Blobs.
// Accounts: email + password (scrypt) with signed, HttpOnly session cookies.
import crypto from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(crypto.scrypt);

const SEED = new Set(["bruce-warburton","richard-john-parrott","francis-zvomuya","nguby-naz-ngu","jinny-henson","margaret-ellis","theodore-p-hill","claire-bennett"]);
const CATS = new Set(["Family", "Veteran", "Community hero"]);
const MAXIMG = 400_000, DAY = 864e5;
const hex = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const rid = (n = 4) => crypto.randomBytes(n).toString("hex");

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m, s = 400) => new HttpError(s, m);

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

  // ---- rate limiting (per key, counted per attempt) ----
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
  const pub = (r, me) => ({ id: r.id, name: r.name, b: r.b, d: r.d, cat: r.cat, story: r.story, pic: r.pv ? `/api/img/${r.id}/pic?v=${r.pv}` : "", mine: !!(me && r.owner === me.e) });
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

  async function handle(req, context) {
    const url = new URL(req.url), method = req.method;
    const p = url.pathname.replace(/^\/(\.netlify\/functions\/api|api)/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const [a, b, c, d] = p;
    const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";

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
        const gk = await gate("login:" + email, 8, 15 * 60e3);
        await gate("loginip:" + ip, 40, 15 * 60e3);
        const u = await db().get(key, { type: "json" });
        const hash = (await scrypt(pw.slice(0, 200), u ? u.salt : "x".repeat(32), 64)).toString("hex");
        if (!u || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(u.hash))) throw bad("Incorrect email or password.", 401);
        await db().delete(gk);
      }
      return J({ email }, 200, setCookie(sign({ e: email, exp: Date.now() + 30 * DAY }), 30 * 86400));
    }

    // ---- images ----
    if (a === "img" && method === "GET" && okId(b) && /^[a-z0-9]{1,20}$/.test(c || "")) {
      const r = await im().getWithMetadata(`${b}/${c}`, { type: "arrayBuffer" });
      if (!r) throw bad("Not found.", 404);
      return new Response(r.data, { headers: { "Content-Type": r.metadata?.type || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
    }

    if (a !== "memorials") throw bad("Not found.", 404);

    // ---- list / create ----
    if (!b) {
      if (method === "GET") {
        const { blobs } = await db().list({ prefix: "m/" });
        const recs = (await Promise.all(blobs.slice(0, 300).map((x) => db().get(x.key, { type: "json" })))).filter(Boolean).sort((x, y) => y.created - x.created);
        return J({ list: recs.map((r) => { const { story, ...s } = pub(r, me); return s; }) });
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
        return J({ m: rec ? pub(rec, me) : null, stats: { c: st.c, v: st.v, t: await tributes(b), ev: rec ? rec.events : [], ph: rec ? rec.photos.map((i) => `/api/img/${b}/${i}`) : [] } });
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
      if (method === "POST") {
        await gate("tribute:" + ip, 5, 10 * 60e3);
        const j = await body();
        const k = `${Date.now()}-${rid(3)}`;
        await db().setJSON(`t/${b}/${k}`, { n: str(j.n, 60, 1), m: str(j.m, 1000, 1) });
        return J({ k }, 201);
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
