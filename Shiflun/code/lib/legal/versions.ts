// 表示中の規約・ポリシーと、同意記録に保存するバージョン。
// 文書を改定したら file と version を更新する（同意記録で「どの版に同意したか」を区別するため）。
export const LEGAL_DOCUMENTS = {
  terms: { file: "利用規約（ワーカー・店舗共通）V4.md", version: "terms-v4", draft: false },
  privacy: { file: "プライバシーポリシー V1ドラフト.md", version: "privacy-v1-draft", draft: true },
} as const;

export type LegalDocumentKey = keyof typeof LEGAL_DOCUMENTS;

/** 同意記録に保存する値（例: "terms-v4+privacy-v1-draft"）。 */
export const CONSENT_VERSION = `${LEGAL_DOCUMENTS.terms.version}+${LEGAL_DOCUMENTS.privacy.version}`;

/** 同意ページで「同意する」を押してから、登録を送信するまでの有効期限。過ぎたら同意ページからやり直す。 */
export const CONSENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * 同意ページで記録した版と日時が、現在の版かつ有効期限内かを確かめる。
 * 有効なら同意日時（ISO文字列）、無効なら null を返す。クライアント・サーバーの両方で使う。
 */
export function validConsentTime(version: unknown, agreedAt: unknown, now = Date.now()): string | null {
  if (version !== CONSENT_VERSION || typeof agreedAt !== "string") return null;
  const time = Date.parse(agreedAt);
  // 端末の時計のずれを5分まで許容する。
  if (!Number.isFinite(time) || time > now + 5 * 60 * 1000 || now - time > CONSENT_MAX_AGE_MS) return null;
  return new Date(time).toISOString();
}
