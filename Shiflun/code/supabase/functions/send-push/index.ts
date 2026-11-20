// Shiflun: アプリ内のお知らせ（app_notifications）が作られたら、受け取る人のスマホへプッシュ通知を送る。
//
// 呼び出し元：Supabase の Database Webhook（app_notifications の INSERT）。設定は docs/mobile-release.md。
// 送り先：push_tokens（migration 025）。Android は Firebase Cloud Messaging、iOS は Apple（APNs）へ直接送る。
//
// 必要な Secrets（Supabase Dashboard → Edge Functions → Secrets）：
//   SHIFLUN_WEBHOOK_SECRET  Webhook のヘッダー x-shiflun-webhook-secret と同じ値（推測されにくい長い文字列）
//   FCM_SERVICE_ACCOUNT     Firebase のサービスアカウントの JSON（Android 用。無ければ Android には送らない）
//   APNS_KEY_P8 / APNS_KEY_ID / APNS_TEAM_ID / APNS_BUNDLE_ID   Apple の通知用の鍵（iOS 用。無ければ iOS には送らない）
//   APNS_PRODUCTION         "true" で本番（App Store・TestFlight）、それ以外は開発用（Xcode から入れたアプリ）
// SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で用意する（この関数の中だけで使う）。
import { apnsJwt, googleAssertion } from "./tokens.ts";

type Notification = {
  id: string;
  kind: "scout_received" | "scout_accepted" | "scout_rejected" | "message" | "staff_message";
  recipient_worker_id: string | null;
  recipient_store_id: string | null;
  scout_id: string | null;
  staff_worker_id: string | null;
  title: string;
  body: string;
};
type PushToken = { token: string; platform: "ios" | "android" };
type SendResult = "sent" | "invalid" | "failed" | "skipped";

const env = (name: string) => Deno.env.get(name) ?? "";

/** 通知を押したときに開く画面（components/notifications/NotificationsClient.tsx と同じ行き先）。 */
function linkFor(n: Notification): string {
  const worker = Boolean(n.recipient_worker_id);
  const base = worker ? "/workers" : "/managers";
  if (n.kind === "staff_message") return worker ? "/workers/chat/staff" : `/managers/chat/staff/${n.staff_worker_id}`;
  if ((n.kind === "message" || n.kind === "scout_accepted") && n.scout_id) return `${base}/chat/${n.scout_id}`;
  if (n.kind === "scout_received" && worker && n.scout_id) return `/workers/scouts/${n.scout_id}`;
  return `${base}/scouts`;
}

/** service role で Supabase の REST API を読む・消す。 */
async function rest(path: string, init: RequestInit = {}) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, ...init.headers } });
}

async function recipientUserId(n: Notification): Promise<string | null> {
  const path = n.recipient_worker_id
    ? `workers?id=eq.${encodeURIComponent(n.recipient_worker_id)}&select=user_id`
    : `stores?id=eq.${encodeURIComponent(n.recipient_store_id ?? "")}&select=user_id:owner_user_id`;
  const response = await rest(path);
  if (!response.ok) return null;
  const rows = await response.json() as { user_id: string | null }[];
  return rows[0]?.user_id ?? null;
}

// --- Android（Firebase Cloud Messaging） --------------------------------------
let googleToken: { value: string; expires: number } | null = null;

async function googleAccessToken(account: { client_email: string; private_key: string; token_uri?: string }): Promise<string | null> {
  if (googleToken && googleToken.expires > Date.now() + 60_000) return googleToken.value;
  const response = await fetch(account.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await googleAssertion(account) }),
  });
  if (!response.ok) { console.error("FCM token error", response.status, await response.text()); return null; }
  const data = await response.json() as { access_token: string; expires_in: number };
  googleToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return googleToken.value;
}

async function sendAndroid(token: string, n: Notification, link: string): Promise<SendResult> {
  const raw = env("FCM_SERVICE_ACCOUNT");
  if (!raw) return "skipped";
  const account = JSON.parse(raw) as { project_id: string; client_email: string; private_key: string; token_uri?: string };
  const accessToken = await googleAccessToken(account);
  if (!accessToken) return "failed";
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: {
      token,
      notification: { title: n.title, body: n.body },
      data: { link, notification_id: n.id },
      android: { priority: "high", notification: { channel_id: "default" } },
    } }),
  });
  if (response.ok) return "sent";
  const text = await response.text();
  // アプリを消した端末など、もう届かない宛先。
  if (response.status === 404 || /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT.*token/i.test(text)) return "invalid";
  console.error("FCM send error", response.status, text);
  return "failed";
}

// --- iOS（Apple Push Notification service） -----------------------------------
let apnsToken: { value: string; created: number } | null = null;

async function sendIos(token: string, n: Notification, link: string): Promise<SendResult> {
  const [p8, keyId, teamId, bundleId] = ["APNS_KEY_P8", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_BUNDLE_ID"].map(env);
  if (!p8 || !keyId || !teamId || !bundleId) return "skipped";
  // Apple の決まり：同じ JWT は1時間以内しか使えない（作り直しすぎも不可）。50分ごとに作り直す。
  if (!apnsToken || Date.now() - apnsToken.created > 50 * 60_000) apnsToken = { value: await apnsJwt(p8, keyId, teamId), created: Date.now() };
  const host = env("APNS_PRODUCTION") === "true" ? "api.push.apple.com" : "api.sandbox.push.apple.com";
  const response = await fetch(`https://${host}/3/device/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { authorization: `bearer ${apnsToken.value}`, "apns-topic": bundleId, "apns-push-type": "alert", "apns-priority": "10" },
    body: JSON.stringify({ aps: { alert: { title: n.title, body: n.body }, sound: "default" }, link, notification_id: n.id }),
  });
  if (response.ok) return "sent";
  const text = await response.text();
  if (response.status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(text)) return "invalid";
  console.error("APNs send error", response.status, text);
  return "failed";
}

/** 長さに関係なく同じ時間で比べる（秘密の値を推測されないように）。 */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (request) => {
  const secret = env("SHIFLUN_WEBHOOK_SECRET");
  if (request.method !== "POST" || !secret || !sameSecret(request.headers.get("x-shiflun-webhook-secret") ?? "", secret)) {
    return new Response("forbidden", { status: 403 });
  }
  const payload = await request.json().catch(() => null) as { type?: string; table?: string; record?: Notification } | null;
  const n = payload?.record;
  if (payload?.type !== "INSERT" || payload.table !== "app_notifications" || !n?.id) return Response.json({ skipped: "not a new notification" });

  const userId = await recipientUserId(n);
  if (!userId) return Response.json({ skipped: "no recipient login" });
  const tokensResponse = await rest(`push_tokens?user_id=eq.${encodeURIComponent(userId)}&select=token,platform`);
  if (!tokensResponse.ok) return new Response("token lookup failed", { status: 500 });
  const tokens = await tokensResponse.json() as PushToken[];

  const link = linkFor(n);
  const results = await Promise.all(tokens.map(async ({ token, platform }) => {
    const result = await (platform === "ios" ? sendIos(token, n, link) : sendAndroid(token, n, link)).catch((error) => { console.error(error); return "failed" as const; });
    if (result === "invalid") await rest(`push_tokens?token=eq.${encodeURIComponent(token)}`, { method: "DELETE" });
    return result;
  }));
  return Response.json({ devices: tokens.length, sent: results.filter((r) => r === "sent").length, removed: results.filter((r) => r === "invalid").length });
});
