// プッシュ通知用の JWT（supabase/functions/send-push/tokens.ts）が、Google・Apple の求める形で署名されているかを確かめる。
// テスト用の鍵をその場で作り、Node.js の crypto で署名を検証する（外部には接続しない）。
// 実行：node tests/push-tokens.mjs（Node.js 23.6 以降。TypeScript をそのまま読み込む）
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { apnsJwt, googleAssertion } from "../supabase/functions/send-push/tokens.ts";

const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
let checks = 0;
const pass = (label) => console.log(`PASS ${++checks}: ${label}`);

// Google（RS256）
{
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const jwt = await googleAssertion({ client_email: "push@example.iam.gserviceaccount.com", private_key: pem }, 1_700_000_000);
  const [h, p, s] = jwt.split(".");
  assert.deepEqual(decode(h), { alg: "RS256", typ: "JWT" }); pass("Google JWT header");
  const payload = decode(p);
  assert.equal(payload.scope, "https://www.googleapis.com/auth/firebase.messaging");
  assert.equal(payload.aud, "https://oauth2.googleapis.com/token");
  assert.equal(payload.exp - payload.iat, 3600); pass("Google JWT claims");
  assert.ok(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url"))); pass("Google JWT signature verifies");
  // サービスアカウントの JSON を環境変数に入れると改行が \n の2文字になることがある。
  const escaped = pem.replace(/\n/g, "\\n");
  const jwt2 = await googleAssertion({ client_email: "x@example.com", private_key: escaped }, 1_700_000_000);
  const [h2, p2, s2] = jwt2.split(".");
  assert.ok(createVerify("RSA-SHA256").update(`${h2}.${p2}`).verify(publicKey, Buffer.from(s2, "base64url"))); pass("escaped newlines in the key are accepted");
}

// Apple（ES256）
{
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const p8 = privateKey.export({ type: "pkcs8", format: "pem" });
  const jwt = await apnsJwt(p8, "ABC123DEFG", "TEAM123456", 1_700_000_000);
  const [h, p, s] = jwt.split(".");
  assert.deepEqual(decode(h), { alg: "ES256", kid: "ABC123DEFG" }); pass("APNs JWT header");
  assert.deepEqual(decode(p), { iss: "TEAM123456", iat: 1_700_000_000 }); pass("APNs JWT claims");
  const signature = Buffer.from(s, "base64url");
  assert.equal(signature.length, 64); pass("APNs signature is raw r||s (64 bytes) as JWT requires");
  assert.ok(createVerify("SHA256").update(`${h}.${p}`).verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, signature)); pass("APNs JWT signature verifies");
}

console.log(`Push token checks passed: ${checks}`);
