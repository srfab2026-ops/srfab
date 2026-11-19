import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const E = process.env;
export const config = { path: "/api/*" };

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

/* ---------- login token (signed, 30 days) ---------- */
function sign() {
  const p = Buffer.from(JSON.stringify({ exp: Date.now() + 30 * 864e5 })).toString("base64url");
  const m = crypto.createHmac("sha256", E.SESSION_SECRET).update(p).digest("base64url");
  return p + "." + m;
}
function tokenOk(req) {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!t || !E.SESSION_SECRET) return false;
  const [p, m] = t.split(".");
  if (!p || !m) return false;
  const x = crypto.createHmac("sha256", E.SESSION_SECRET).update(p).digest("base64url");
  if (x.length !== m.length || !crypto.timingSafeEqual(Buffer.from(x), Buffer.from(m))) return false;
  try { return JSON.parse(Buffer.from(p, "base64url").toString()).exp > Date.now(); } catch { return false; }
}

/* ---------- lock after 5 wrong passwords (60 s) ---------- */
async function locked() {
  const l = (await getStore("meta").get("lock", { type: "json" })) || { f: 0, u: 0 };
  return l.u > Date.now();
}
async function noteTry(ok) {
  const st = getStore("meta");
  let l = (await st.get("lock", { type: "json" })) || { f: 0, u: 0 };
  if (ok) l = { f: 0, u: 0 };
  else { l.f++; if (l.f >= 5) { l.u = Date.now() + 60000; l.f = 0; } }
  await st.setJSON("lock", l);
}
const passOk = (p) => !!E.SHOP_PASSWORD && safeEq(p || "", E.SHOP_PASSWORD);

/* ---------- bills: one blob per month ---------- */
const monthKey = (t) => "m-" + new Date(t).toISOString().slice(0, 7);
async function mutateMonth(key, fn) {
  const st = getStore("bills");
  for (let i = 0; i < 5; i++) {
    const cur = await st.getWithMetadata(key, { type: "json" });
    const data = (cur && cur.data) || {};
    fn(data);
    const r = await st.setJSON(key, data, cur && cur.etag ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    if (r && r.modified === false) continue;
    return;
  }
  throw new Error("busy");
}
const str = (v, n) => String(v == null ? "" : v).slice(0, n);
function cleanBill(b) {
  const t = Number(b && b.t), total = Number(b && b.total);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(total) || total <= 0) return null;
  const o = {
    t, m: b.m === "UPI" ? "UPI" : "Cash", total, sub: Number(b.sub) || total, d: Number(b.d) || 0,
    c: str(b.c, 80), w: str(b.w, 20),
    items: (Array.isArray(b.items) ? b.items : []).slice(0, 200).map((x) => ({
      n: str(x.n, 80), l: Number(x.l) || 0, r: Number(x.r) || 0, a: Number(x.a) || 0,
    })),
  };
  if (Number(b.no) > 0) o.no = Math.floor(Number(b.no));
  if (b.x) { o.x = 1; if (b.xt) o.xt = Number(b.xt) || 0; }
  return o;
}
function cleanConfig(c) {
  c = c || {};
  return {
    shop: str(c.shop, 80), upi: str(c.upi, 80), gst: str(c.gst, 20), addr: str(c.addr, 200),
    phone: str(c.phone, 20), link: str(c.link, 300),
    cloths: (Array.isArray(c.cloths) ? c.cloths : []).slice(0, 300)
      .map((x) => ({ n: str(x.n, 60), p: Number(x.p) || 0 })).filter((x) => x.n && x.p > 0),
  };
}

/* ---------- PhonePe ---------- */
const PP = () =>
  E.PHONEPE_ENV === "production"
    ? { auth: "https://api.phonepe.com/apis/identity-manager/v1/oauth/token", pg: "https://api.phonepe.com/apis/pg" }
    : { auth: "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token", pg: "https://api-preprod.phonepe.com/apis/pg-sandbox" };
let tokCache = { v: "", exp: 0 };
async function ppAuth() {
  if (tokCache.v && tokCache.exp > Date.now() + 60000) return tokCache.v;
  const r = await fetch(PP().auth, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: E.PHONEPE_CLIENT_ID || "",
      client_version: E.PHONEPE_CLIENT_VERSION || "1",
      client_secret: E.PHONEPE_CLIENT_SECRET || "",
      grant_type: "client_credentials",
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("PhonePe login failed – check Client ID, version and secret");
  const ex = Number(j.expires_at) || 0;
  tokCache = { v: "O-Bearer " + j.access_token, exp: ex ? (ex < 1e12 ? ex * 1000 : ex) : Date.now() + 600000 };
  return tokCache.v;
}
const ID_RE = /^SRF[0-9A-Za-z]{10,40}$/;

async function payCreate(req, body) {
  const amt = Number(body.amount);
  if (!Number.isFinite(amt) || amt < 1 || amt > 500000) return json({ error: "Bad amount" }, 400);
  const id = "SRF" + Date.now() + crypto.randomBytes(3).toString("hex");
  const origin = new URL(req.url).origin;
  const r = await fetch(PP().pg + "/checkout/v2/pay", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await ppAuth() },
    body: JSON.stringify({
      merchantOrderId: id,
      amount: Math.round(amt * 100),
      expireAfter: 600,
      paymentFlow: { type: "PG_CHECKOUT", message: "SR FAB bill", merchantUrls: { redirectUrl: origin + "/thanks.html" } },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.redirectUrl) return json({ error: j.message || j.code || "PhonePe could not create the payment" }, 502);
  await getStore("pay").setJSON(id, { state: "PENDING", amount: Math.round(amt * 100), orderId: j.orderId || "", created: Date.now() });
  return json({ merchantOrderId: id, redirectUrl: j.redirectUrl });
}
async function payStatus(id) {
  if (!ID_RE.test(id)) return json({ error: "Bad id" }, 400);
  const st = getStore("pay");
  const rec = await st.get(id, { type: "json" });
  if (!rec) return json({ error: "Unknown payment" }, 404);
  if (rec.state === "COMPLETED" || rec.state === "FAILED") return json({ state: rec.state });
  try {
    const r = await fetch(PP().pg + "/checkout/v2/order/" + id + "/status", { headers: { authorization: await ppAuth() } });
    const j = await r.json().catch(() => ({}));
    if (r.ok && (j.state === "COMPLETED" || j.state === "FAILED")) {
      if (j.state === "COMPLETED" && j.amount && Number(j.amount) !== rec.amount) return json({ state: "PENDING" });
      rec.state = j.state;
      await st.setJSON(id, rec);
    }
  } catch { /* keep waiting */ }
  return json({ state: rec.state });
}
async function webhook(req) {
  const want = crypto.createHash("sha256").update((E.PHONEPE_WEBHOOK_USER || "") + ":" + (E.PHONEPE_WEBHOOK_PASS || "")).digest("hex");
  const got = (req.headers.get("authorization") || "").trim().split(/\s+/).pop().toLowerCase();
  if (!E.PHONEPE_WEBHOOK_USER || !safeEq(got, want)) return json({ error: "unauthorized" }, 401);
  let b = {}; try { b = await req.json(); } catch { /* ignore */ }
  const p = b.payload || {}, id = p.merchantOrderId || p.originalMerchantOrderId || "";
  if (ID_RE.test(id)) {
    const st = getStore("pay");
    const rec = await st.get(id, { type: "json" });
    if (rec) {
      if (/completed/i.test(b.event || "") && p.state === "COMPLETED" && (!p.amount || Number(p.amount) === rec.amount)) rec.state = "COMPLETED";
      else if (/failed/i.test(b.event || "") && rec.state !== "COMPLETED") rec.state = "FAILED";
      await st.setJSON(id, rec);
    }
  }
  return json({ ok: true });
}

/* ---------- router ---------- */
export default async (req) => {
  const path = new URL(req.url).pathname.replace(/^\/api\/?/, "");
  const method = req.method;
  try {
    if (path === "phonepe/webhook" && method === "POST") return await webhook(req);

    if (path === "login" && method === "POST") {
      if (!E.SESSION_SECRET || !E.SHOP_PASSWORD || !E.SHOP_MOBILE) return json({ error: "Server not set up" }, 500);
      if (await locked()) return json({ error: "locked" }, 429);
      const b = await req.json().catch(() => ({}));
      const mob = String(b.mobile || "").replace(/\D/g, "").slice(-10);
      const ok = safeEq(mob, String(E.SHOP_MOBILE).replace(/\D/g, "").slice(-10)) && passOk(b.password);
      await noteTry(ok);
      return ok ? json({ token: sign() }) : json({ error: "bad login" }, 401);
    }

    if (!tokenOk(req)) return json({ error: "login required" }, 401);

    if (path === "verify" && method === "POST") {
      if (await locked()) return json({ error: "locked" }, 429);
      const b = await req.json().catch(() => ({}));
      const ok = passOk(b.password);
      await noteTry(ok);
      return ok ? json({ ok: true }) : json({ error: "wrong password" }, 403);
    }

    if (path === "data" && method === "GET") {
      const config = await getStore("meta").get("config", { type: "json" });
      const bs = getStore("bills");
      const { blobs } = await bs.list({ prefix: "m-" });
      const months = await Promise.all(blobs.map((x) => bs.get(x.key, { type: "json" })));
      const bills = [];
      months.forEach((m) => m && Object.keys(m).forEach((k) => bills.push(m[k])));
      return json({ config: config || null, bills });
    }
    if (path === "config" && method === "PUT") {
      await getStore("meta").setJSON("config", cleanConfig(await req.json().catch(() => ({}))));
      return json({ ok: true });
    }
    if (path === "bill" && method === "PUT") {
      const b = cleanBill(await req.json().catch(() => ({})));
      if (!b) return json({ error: "bad bill" }, 400);
      await mutateMonth(monthKey(b.t), (d) => { d[b.t] = b; });
      return json({ ok: true });
    }
    if (path === "bill/delete" && method === "POST") {
      const ids = ((await req.json().catch(() => ({}))).ids || []).map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 500);
      const by = {};
      ids.forEach((t) => (by[monthKey(t)] = (by[monthKey(t)] || []).concat(t)));
      for (const k of Object.keys(by)) await mutateMonth(k, (d) => by[k].forEach((t) => delete d[t]));
      return json({ ok: true });
    }
    if (path === "pay/create" && method === "POST") return await payCreate(req, await req.json().catch(() => ({})));
    if (path.startsWith("pay/status/") && method === "GET") return await payStatus(decodeURIComponent(path.slice(11)));

    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: "Server error: " + (e && e.message ? e.message : "unknown") }, 500);
  }
};
