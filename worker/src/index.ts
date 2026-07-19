import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";

interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  FAMILY_INVITE_CODE: string;
  PIN_RECOVERY_CODE: string;
  SESSION_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}

const SITE_ORIGIN = "https://baefamily.github.io";
const FAMILY_ID = "our-family";
const MEMBERS = ["Jangwoo", "Sujin", "Ayoung", "Siwon"];
let presenceTableReady = false;
let pushTablesReady = false;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin");
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), origin);
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      let response: Response;
      if (path === "/api/auth/join" && request.method === "POST") response = await join(request, env);
      else if (path === "/api/auth/reset-pin" && request.method === "POST") response = await resetPin(request, env);
      else if (path === "/api/auth/me" && request.method === "GET") response = await me(request, env);
      else if (path === "/api/auth/logout" && request.method === "POST") response = json({ ok: true });
      else if (path === "/api/state" && request.method === "GET") response = await getState(request, env);
      else if (path === "/api/state" && request.method === "PUT") response = await putState(request, env);
      else if (path === "/api/presence" && (request.method === "GET" || request.method === "POST")) response = await presence(request, env);
      else if (path === "/api/media" && request.method === "POST") response = await uploadMedia(request, env);
      else if (path.startsWith("/api/media/") && request.method === "DELETE") response = await deleteMedia(request, path.slice(11), env);
      else if (path.startsWith("/api/media/") && request.method === "GET") return await getMedia(path.slice(11), env);
      else if (path === "/api/push" && request.method === "GET") response = await getPushStatus(request, env);
      else if (path === "/api/push" && request.method === "POST") response = await updatePush(request, env);
      else if (path === "/api/push" && request.method === "DELETE") response = await removePush(request, env);
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

async function resetPin(request: Request, env: Env) {
  const body = await request.json() as { familyCode?: string; recoveryCode?: string; memberName?: string; newPin?: string };
  const name = body.memberName ?? "";
  const newPin = body.newPin ?? "";
  if (!env.PIN_RECOVERY_CODE) return json({ error: "관리자 복구 설정이 아직 준비되지 않았습니다." }, 503);
  if (!safeEqual((body.familyCode ?? "").trim().toUpperCase(), env.FAMILY_INVITE_CODE.trim().toUpperCase())) return json({ error: "가족 코드가 맞지 않습니다." }, 401);
  if (!safeEqual((body.recoveryCode ?? "").trim(), env.PIN_RECOVERY_CODE.trim())) return json({ error: "관리자 복구 코드가 맞지 않습니다." }, 401);
  if (!MEMBERS.includes(name)) return json({ error: "가족 구성원을 다시 선택해주세요." }, 400);
  if (!/^\d{4}$/.test(newPin)) return json({ error: "새 PIN은 숫자 4자리로 입력해주세요." }, 400);
  const pinHash = await hash(`${name}:${newPin}:${env.SESSION_SECRET}`);
  await env.DB.prepare("INSERT INTO family_members (name, pin_hash, joined_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET pin_hash = excluded.pin_hash")
    .bind(name, pinHash, new Date().toISOString()).run();
  return json({ memberName: name, token: await issueToken(name, env.SESSION_SECRET), message: "PIN을 새로 설정했습니다." });
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
  const actor = await member(request, env);
  if (!actor) return json({ error: "로그인이 필요합니다." }, 401);
  const body = await request.json();
  const encoded = JSON.stringify(body);
  if (encoded.length > 800_000) return json({ error: "저장할 데이터가 너무 큽니다." }, 413);
  const updatedAt = new Date().toISOString();
  const previousRow = await env.DB.prepare("SELECT state_json FROM family_state WHERE family_id = ?").bind(FAMILY_ID).first<{ state_json: string }>();
  const previousState = previousRow ? safeJson(previousRow.state_json) : null;
  await env.DB.prepare("INSERT INTO family_state (family_id, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(family_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at").bind(FAMILY_ID, encoded, updatedAt).run();
  if (previousState) await notifyStateChanges(previousState, body, actor, env);
  return json({ ok: true, updatedAt });
}

type StoredState = {
  messages?: Array<{ id: string; sender: string; recipient?: string; text?: string; attachment?: { name?: string } }>;
  quests?: Array<{ id: string; title: string; creator: string; target?: string; taker?: string; status: string }>;
};

type PushEvent = { recipients: string[]; kind: "chat" | "quest"; title: string; body: string; url: string; tag: string };

async function notifyStateChanges(previous: StoredState, next: StoredState, actor: string, env: Env) {
  const events: PushEvent[] = [];
  const oldMessages = new Set((previous.messages ?? []).map((item) => item.id));
  for (const message of (next.messages ?? []).filter((item) => !oldMessages.has(item.id))) {
    const recipients = message.recipient ? [message.recipient] : MEMBERS.filter((name) => name !== message.sender);
    const preview = message.text?.trim() || (message.attachment?.name ? `첨부파일: ${message.attachment.name}` : "새 사진이나 파일을 보냈어요.");
    events.push({ recipients, kind: "chat", title: `${message.sender}님의 새 메시지`, body: preview.slice(0, 120), url: "/?open=chat", tag: `chat-${message.id}` });
  }

  const oldQuests = new Map((previous.quests ?? []).map((item) => [item.id, item]));
  for (const quest of next.quests ?? []) {
    const old = oldQuests.get(quest.id);
    if (!old) {
      const recipients = quest.target ? [quest.target] : MEMBERS.filter((name) => name !== quest.creator);
      events.push({ recipients, kind: "quest", title: quest.target ? "새 퀘스트가 도착했어요" : "새 가족 퀘스트가 생겼어요", body: `${quest.creator}님이 ‘${quest.title}’ 퀘스트를 등록했어요.`, url: "/?open=quests", tag: `quest-new-${quest.id}` });
      continue;
    }
    if (old.status === quest.status) continue;
    if (quest.status === "doing") {
      events.push({ recipients: [quest.creator], kind: "quest", title: "퀘스트 도전을 시작했어요", body: `${quest.taker ?? actor}님이 ‘${quest.title}’ 퀘스트를 맡았어요.`, url: "/?open=quests", tag: `quest-doing-${quest.id}` });
    } else if (quest.status === "review") {
      events.push({ recipients: [quest.creator], kind: "quest", title: "퀘스트 완료 확인 요청", body: `${quest.taker ?? actor}님이 ‘${quest.title}’ 퀘스트를 완료했어요. 확인해주세요.`, url: "/?open=quests", tag: `quest-review-${quest.id}` });
    } else if (quest.status === "done") {
      const recipient = quest.taker ?? quest.target;
      if (recipient) events.push({ recipients: [recipient], kind: "quest", title: "퀘스트가 승인됐어요 🎉", body: `‘${quest.title}’ 퀘스트가 완료 처리됐어요.`, url: "/?open=quests", tag: `quest-done-${quest.id}` });
    }
  }

  for (const event of events) {
    event.recipients = [...new Set(event.recipients.filter((name) => MEMBERS.includes(name) && name !== actor))];
    if (event.recipients.length) await deliverPush(event, env);
  }
}

async function getPushStatus(request: Request, env: Env) {
  const memberName = await member(request, env);
  if (!memberName) return json({ error: "로그인이 필요합니다." }, 401);
  await ensurePushTables(env);
  const counts = await notificationCounts(memberName, env);
  return json({ publicKey: env.VAPID_PUBLIC_KEY || "", ...counts });
}

async function updatePush(request: Request, env: Env) {
  const memberName = await member(request, env);
  if (!memberName) return json({ error: "로그인이 필요합니다." }, 401);
  await ensurePushTables(env);
  const body = await request.json() as { read?: "chat" | "quest"; subscription?: PushSubscription };
  if (body.read) {
    const column = body.read === "chat" ? "chat_unread" : "quest_unread";
    await env.DB.prepare(`UPDATE family_notification_status SET ${column} = 0 WHERE member_name = ?`).bind(memberName).run();
  }
  if (body.subscription) {
    const subscription = body.subscription;
    if (!subscription.endpoint || !subscription.keys?.auth || !subscription.keys?.p256dh) return json({ error: "올바르지 않은 알림 구독입니다." }, 400);
    await env.DB.prepare("INSERT INTO family_push_subscriptions (endpoint, member_name, subscription_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET member_name = excluded.member_name, subscription_json = excluded.subscription_json, updated_at = excluded.updated_at")
      .bind(subscription.endpoint, memberName, JSON.stringify(subscription), new Date().toISOString()).run();
  }
  return json({ ok: true, ...await notificationCounts(memberName, env) });
}

async function removePush(request: Request, env: Env) {
  const memberName = await member(request, env);
  if (!memberName) return json({ error: "로그인이 필요합니다." }, 401);
  await ensurePushTables(env);
  const body = await request.json() as { endpoint?: string };
  if (body.endpoint) await env.DB.prepare("DELETE FROM family_push_subscriptions WHERE endpoint = ? AND member_name = ?").bind(body.endpoint, memberName).run();
  return json({ ok: true });
}

async function ensurePushTables(env: Env) {
  if (pushTablesReady) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS family_push_subscriptions (endpoint TEXT PRIMARY KEY NOT NULL, member_name TEXT NOT NULL, subscription_json TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS family_push_member_idx ON family_push_subscriptions(member_name)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS family_notification_status (member_name TEXT PRIMARY KEY NOT NULL, chat_unread INTEGER NOT NULL DEFAULT 0, quest_unread INTEGER NOT NULL DEFAULT 0)"),
  ]);
  pushTablesReady = true;
}

async function notificationCounts(memberName: string, env: Env) {
  const row = await env.DB.prepare("SELECT chat_unread, quest_unread FROM family_notification_status WHERE member_name = ?").bind(memberName).first<{ chat_unread: number; quest_unread: number }>();
  return { chatUnread: row?.chat_unread ?? 0, questUnread: row?.quest_unread ?? 0 };
}

async function deliverPush(event: PushEvent, env: Env) {
  await ensurePushTables(env);
  for (const recipient of event.recipients) {
    const column = event.kind === "chat" ? "chat_unread" : "quest_unread";
    await env.DB.prepare(`INSERT INTO family_notification_status (member_name, ${column}) VALUES (?, 1) ON CONFLICT(member_name) DO UPDATE SET ${column} = ${column} + 1`).bind(recipient).run();
    const counts = await notificationCounts(recipient, env);
    const rows = await env.DB.prepare("SELECT endpoint, subscription_json FROM family_push_subscriptions WHERE member_name = ?").bind(recipient).all<{ endpoint: string; subscription_json: string }>();
    for (const row of rows.results) {
      try {
        const subscription = JSON.parse(row.subscription_json) as PushSubscription;
        const payload = await buildPushPayload({
          data: { title: event.title, body: event.body, url: event.url, tag: event.tag, badge: counts.chatUnread + counts.questUnread },
          options: { ttl: 86400, urgency: "high", topic: event.tag.slice(0, 32) },
        }, subscription, { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY });
        const response = await fetch(subscription.endpoint, payload);
        if (response.status === 404 || response.status === 410) await env.DB.prepare("DELETE FROM family_push_subscriptions WHERE endpoint = ?").bind(row.endpoint).run();
      } catch (error) {
        console.error("push delivery failed", recipient, row.endpoint, error);
      }
    }
  }
}

function safeJson(value: string): StoredState | null {
  try { return JSON.parse(value) as StoredState; } catch { return null; }
}

async function presence(request: Request, env: Env) {
  const memberName = await member(request, env);
  if (!memberName) return json({ error: "로그인이 필요합니다." }, 401);
  await ensurePresenceTable(env);
  if (request.method === "POST") {
    await env.DB.prepare("INSERT INTO family_presence (member_name, last_seen) VALUES (?, ?) ON CONFLICT(member_name) DO UPDATE SET last_seen = excluded.last_seen")
      .bind(memberName, new Date().toISOString()).run();
  }
  const rows = await env.DB.prepare("SELECT member_name, last_seen FROM family_presence ORDER BY member_name").all<{ member_name: string; last_seen: string }>();
  return json({ members: rows.results.map((row) => ({ memberName: row.member_name, lastSeen: row.last_seen })) });
}

async function ensurePresenceTable(env: Env) {
  if (presenceTableReady) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS family_presence (member_name TEXT PRIMARY KEY NOT NULL, last_seen TEXT NOT NULL)").run();
  presenceTableReady = true;
}

async function uploadMedia(request: Request, env: Env) {
  const uploadedBy = await member(request, env);
  if (!uploadedBy) return json({ error: "로그인이 필요합니다." }, 401);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "사진이나 파일을 선택해주세요." }, 400);
  if (file.size > 20 * 1024 * 1024) return json({ error: "파일이 너무 커요. 20MB 이하의 파일을 선택해주세요." }, 413);
  const key = crypto.randomUUID();
  const contentType = file.type || "application/octet-stream";
  const createdAt = new Date().toISOString();
  await env.MEDIA_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType, cacheControl: "no-store" },
    customMetadata: { uploadedBy, originalName: file.name, createdAt },
  });
  try {
    await env.DB.prepare("INSERT INTO family_media (media_key, content_type, media_data, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(key, contentType, new Uint8Array(0), uploadedBy, createdAt).run();
  } catch (error) {
    await env.MEDIA_BUCKET.delete(key);
    throw error;
  }
  const origin = new URL(request.url).origin;
  return json({ url: `${origin}/api/media/${key}`, name: file.name, type: contentType, size: file.size });
}

async function getMedia(key: string, env: Env) {
  const normalizedKey = decodeURIComponent(key).trim().replace(/^\/+/, "");
  const object = await env.MEDIA_BUCKET.get(normalizedKey);
  if (object) {
    const data = await object.arrayBuffer();
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-type", object.httpMetadata?.contentType || "application/octet-stream");
    headers.set("content-length", String(data.byteLength));
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "no-store");
    headers.set("x-media-source", "r2");
    return new Response(data, { headers });
  }
  const row = await env.DB.prepare("SELECT content_type, media_data FROM family_media WHERE media_key = ?").bind(key).first<{ content_type: string; media_data: ArrayBuffer }>();
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(row.media_data, { headers: { "content-type": row.content_type, "cache-control": "no-store", "x-media-source": "d1" } });
}

async function deleteMedia(request: Request, key: string, env: Env) {
  const memberName = await member(request, env);
  if (!memberName) return json({ error: "로그인이 필요합니다." }, 401);
  const normalizedKey = decodeURIComponent(key).trim().replace(/^\/+/, "");
  const row = await env.DB.prepare("SELECT uploaded_by FROM family_media WHERE media_key = ?")
    .bind(normalizedKey).first<{ uploaded_by: string }>();
  if (!row) return json({ error: "사진을 찾지 못했어요." }, 404);
  if (row.uploaded_by !== memberName) return json({ error: "사진을 등록한 사람만 삭제할 수 있어요." }, 403);
  await env.MEDIA_BUCKET.delete(normalizedKey);
  await env.DB.prepare("DELETE FROM family_media WHERE media_key = ?").bind(normalizedKey).run();
  return json({ ok: true });
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
