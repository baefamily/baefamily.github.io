interface Env {
  DB: D1Database;
  FAMILY_INVITE_CODE: string;
  SESSION_SECRET: string;
}

const SITE_ORIGIN = "https://baefamily.github.io";
const FAMILY_ID = "our-family";
const MEMBERS = ["Jangwoo", "Sujin", "Ayoung", "Siwon"];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin");
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), origin);
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      let response: Response;
      if (path === "/api/auth/join" && request.method === "POST") response = await join(request, env);
      else if (path === "/api/auth/me" && request.method === "GET") response = await me(request, env);
      else if (path === "/api/auth/logout" && request.method === "POST") response = json({ ok: true });
      else if (path === "/api/state" && request.method === "GET") response = await getState(request, env);
      else if (path === "/api/state" && request.method === "PUT") response = await putState(request, env);
      else if (path === "/api/media" && request.method === "POST") response = await uploadMedia(request, env);
      else if (path.startsWith("/api/media/") && request.method === "GET") response = await getMedia(path.slice(11), env);
      else if (path === "/api/push" && request.method === "GET") response = json({ publicKey: "", chatUnread: 0, questUnread: 0 });
      else if (path === "/api/push") response = json({ ok: true, chatUnread: 0, questUnread: 0 });
      else response = json({ error: "Not found" }, 404);
      return cors(response, origin);
    } catch (error) {
      return cors(json({ error: error instanceof Error ? error.message : "서버 오류가 발생했습니다." }, 500), origin);
    }
  },
};

async function join(request: Request, env: Env) {
  const body = await request.json() as { familyCode?: string; memberName?: string; pin?: string };
  const name = body.memberName ?? "";
  const pin = body.pin ?? "";
  if (!safeEqual((body.familyCode ?? "").trim().toUpperCase(), env.FAMILY_INVITE_CODE.trim().toUpperCase())) return json({ error: "가족 코드가 맞지 않습니다." }, 401);
  if (!MEMBERS.includes(name)) return json({ error: "가족 구성원을 다시 선택해주세요." }, 400);
  if (!/^\d{4}$/.test(pin)) return json({ error: "PIN은 숫자 4자리로 입력해주세요." }, 400);
  const pinHash = await hash(`${name}:${pin}:${env.SESSION_SECRET}`);
  const existing = await env.DB.prepare("SELECT pin_hash FROM family_members WHERE name = ?").bind(name).first<{ pin_hash: string }>();
  if (existing && !safeEqual(existing.pin_hash, pinHash)) return json({ error: "PIN이 맞지 않습니다." }, 400);
  if (!existing) await env.DB.prepare("INSERT INTO family_members (name, pin_hash, joined_at) VALUES (?, ?, ?)").bind(name, pinHash, new Date().toISOString()).run();
  return json({ memberName: name, token: await issueToken(name, env.SESSION_SECRET) });
}

async function me(request: Request, env: Env) {
  const memberName = await member(request, env);
  return memberName ? json({ authenticated: true, memberName }) : json({ authenticated: false }, 401);
}

async function getState(request: Request, env: Env) {
  if (!await member(request, env)) return json({ error: "로그인이 필요합니다." }, 401);
  const row = await env.DB.prepare("SELECT state_json, updated_at FROM family_state WHERE family_id = ?").bind(FAMILY_ID).first<{ state_json: string; updated_at: string }>();
  return row ? json({ state: JSON.parse(row.state_json), updatedAt: row.updated_at }) : json({ state: null });
}

async function putState(request: Request, env: Env) {
  if (!await member(request, env)) return json({ error: "로그인이 필요합니다." }, 401);
  const body = await request.json();
  const encoded = JSON.stringify(body);
  if (encoded.length > 800_000) return json({ error: "저장할 데이터가 너무 큽니다." }, 413);
  const updatedAt = new Date().toISOString();
  await env.DB.prepare("INSERT INTO family_state (family_id, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(family_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at").bind(FAMILY_ID, encoded, updatedAt).run();
  return json({ ok: true, updatedAt });
}

async function uploadMedia(request: Request, env: Env) {
  const uploadedBy = await member(request, env);
  if (!uploadedBy) return json({ error: "로그인이 필요합니다." }, 401);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "사진이나 파일을 선택해주세요." }, 400);
  if (file.size > 1_500_000) return json({ error: "무료 저장공간에서는 1.5MB 이하 파일만 올릴 수 있어요." }, 413);
  const key = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO family_media (media_key, content_type, media_data, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?)").bind(key, file.type || "application/octet-stream", await file.arrayBuffer(), uploadedBy, new Date().toISOString()).run();
  const origin = new URL(request.url).origin;
  return json({ url: `${origin}/api/media/${key}`, name: file.name, type: file.type, size: file.size });
}

async function getMedia(key: string, env: Env) {
  const row = await env.DB.prepare("SELECT content_type, media_data FROM family_media WHERE media_key = ?").bind(key).first<{ content_type: string; media_data: ArrayBuffer }>();
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(row.media_data, { headers: { "content-type": row.content_type, "cache-control": "public, max-age=31536000, immutable" } });
}

async function member(request: Request, env: Env) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(await hmac(payload, env.SESSION_SECRET), signature)) return null;
  try {
    const parsed = JSON.parse(decode(payload)) as { memberName: string; expiresAt: number };
    return parsed.expiresAt > Date.now() / 1000 && MEMBERS.includes(parsed.memberName) ? parsed.memberName : null;
  } catch { return null; }
}

async function issueToken(memberName: string, secret: string) {
  const payload = encode(JSON.stringify({ memberName, expiresAt: Math.floor(Date.now() / 1000) + 31536000 }));
  return `${payload}.${await hmac(payload, secret)}`;
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToUrl(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

async function hash(value: string) { return bytesToUrl(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }
function encode(value: string) { return bytesToUrl(new TextEncoder().encode(value)); }
function decode(value: string) { return new TextDecoder().decode(urlToBytes(value)); }
function bytesToUrl(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function urlToBytes(value: string) { const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")); return Uint8Array.from(raw, c => c.charCodeAt(0)); }
function safeEqual(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function json(body: unknown, status = 200) { return Response.json(body, { status }); }
function cors(response: Response, origin: string | null) { const headers = new Headers(response.headers); if (origin === SITE_ORIGIN || origin?.startsWith("http://localhost:")) { headers.set("access-control-allow-origin", origin); headers.set("vary", "Origin"); } headers.set("access-control-allow-headers", "authorization, content-type"); headers.set("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS"); return new Response(response.body, { status: response.status, headers }); }
