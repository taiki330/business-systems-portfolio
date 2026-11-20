// プッシュ通知の送信に使う署名付きトークン（JWT）を作る。外部ライブラリを使わず Web Crypto だけで作るので、
// Supabase Edge Functions（Deno）でも Node.js でも同じように動く（tests/push-tokens.mjs で検証している）。

const encoder = new TextEncoder();

export function base64url(input: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** "-----BEGIN PRIVATE KEY-----" 形式（PKCS#8）の鍵を、Web Crypto が読める形に。 */
function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/\\n/g, "\n").replace(/-----(BEGIN|END) [A-Z ]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, key: CryptoKey, algorithm: AlgorithmIdentifier | EcdsaParams): Promise<string> {
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  // ECDSA の署名は Web Crypto が r||s（JWT と同じ形）で返すので、そのまま使える。
  const signature = await crypto.subtle.sign(algorithm, key, encoder.encode(input));
  return `${input}.${base64url(signature)}`;
}

/** Google（Firebase Cloud Messaging）のアクセストークンを取るための JWT。サービスアカウントの鍵で署名する（RS256）。 */
export async function googleAssertion(serviceAccount: { client_email: string; private_key: string; token_uri?: string }, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(serviceAccount.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  return signJwt(
    { alg: "RS256", typ: "JWT" },
    { iss: serviceAccount.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 },
    key,
    { name: "RSASSA-PKCS1-v1_5" },
  );
}

/** Apple（APNs）への送信に使う JWT。Apple Developer で作る .p8 の鍵で署名する（ES256）。 */
export async function apnsJwt(p8: string, keyId: string, teamId: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(p8), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return signJwt({ alg: "ES256", kid: keyId }, { iss: teamId, iat: now }, key, { name: "ECDSA", hash: "SHA-256" });
}
