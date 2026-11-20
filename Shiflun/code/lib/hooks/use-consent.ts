"use client";

import { useStoredId } from "@/lib/hooks/use-stored-id";
import { CONSENT_VERSION, validConsentTime } from "@/lib/legal/versions";

type StoredConsent = { version: string; agreedAt: string };

function parse(raw: string | null): StoredConsent | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return typeof value?.version === "string" && typeof value?.agreedAt === "string" ? value : null;
  } catch { return null; }
}

/**
 * 同意ページ（/agreement）で「同意する」を押した記録。登録フォームは、これが有効なときだけ表示する。
 * agreedAt は有効期限内かつ現在の版のときだけ値が入る。
 */
export function useConsent() {
  const { id: raw, ready, setId, clearId } = useStoredId("shiflun_consent");
  const stored = parse(raw);
  const agreedAt = stored ? validConsentTime(stored.version, stored.agreedAt) : null;
  function agree() {
    const value = { version: CONSENT_VERSION, agreedAt: new Date().toISOString() };
    setId(JSON.stringify(value));
    return value;
  }
  return { ready, agreedAt, version: CONSENT_VERSION, agree, clear: clearId };
}
