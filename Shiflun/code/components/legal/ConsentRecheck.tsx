"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useConsent } from "@/lib/hooks/use-consent";
import { useCurrentWorker } from "@/lib/hooks/use-current-worker";
import { useCurrentStore } from "@/lib/hooks/use-current-store";
import { CONSENT_VERSION } from "@/lib/legal/versions";
import { ParticipantRole } from "@/lib/types/database";

const WORKER_PATHS = ["/workers/shifts", "/workers/scouts", "/workers/mypage", "/workers/chat", "/workers/notifications", "/workers/earnings", "/workers/verify-identity"];
const STORE_PATHS = ["/managers", "/companies"];

function roleFor(pathname: string): ParticipantRole | null {
  if (WORKER_PATHS.some((p) => pathname.startsWith(p))) return "worker";
  if (STORE_PATHS.some((p) => pathname.startsWith(p))) return "store";
  return null;
}

/**
 * 登録済みのアカウントが現在の版の規約に同意していなければ、同意ページへ移動させる
 * （同意機能の導入前に登録したアカウントや、規約を改定したときの再同意）。
 * terms_version が undefined（migration 020 未適用のDBやモック）のときは何もしない。
 */
export function ConsentRecheck() {
  const pathname = usePathname();
  const role = roleFor(pathname);
  const { worker, ready: workerReady } = useCurrentWorker();
  const { store, ready: storeReady } = useCurrentStore();
  const { ready: consentReady, agreedAt } = useConsent();
  const router = useRouter();
  const account = role === "worker" ? worker : role === "store" ? store : null;
  const ready = consentReady && (role === "worker" ? workerReady : storeReady);
  // 同意ページで同意した直後は、取得済みのアカウント情報が古いままなので端末の記録を優先する。
  const needsConsent = ready && !!account && account.terms_version !== undefined && account.terms_version !== CONSENT_VERSION && !agreedAt;

  useEffect(() => {
    if (needsConsent && role) router.replace(`/agreement?role=${role}&next=${encodeURIComponent(pathname)}`);
  }, [needsConsent, role, pathname, router]);
  return null;
}
