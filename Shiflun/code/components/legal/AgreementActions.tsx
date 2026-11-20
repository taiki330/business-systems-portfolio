"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { recordConsent } from "@/lib/actions/consent";
import { useConsent } from "@/lib/hooks/use-consent";
import { useWorkerId } from "@/lib/hooks/use-worker-id";
import { useStoreId } from "@/lib/hooks/use-stored-id";
import { ParticipantRole } from "@/lib/types/database";
import { safeNext } from "@/lib/utils/safe-next";

/** 同意ページの末尾に置く「同意する」ボタン。文書を最後まで表示した先にだけ置く。 */
export function AgreementActions() {
  const params = useSearchParams();
  const role: ParticipantRole = params.get("role") === "store" ? "store" : "worker";
  const next = safeNext(params.get("next"));
  const { agree } = useConsent();
  const { workerId, ready: workerReady } = useWorkerId();
  const { storeId, ready: storeReady } = useStoreId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accountId = role === "worker" ? workerId : storeId;

  async function onAgree() {
    setPending(true);
    setError(null);
    let consent;
    try { consent = agree(); } catch {
      setPending(false);
      setError("端末への保存に失敗しました。ブラウザのストレージ設定を確認して、もう一度お試しください。");
      return;
    }
    // 登録済みのアカウントなら、その場で同意を記録する（新規登録の場合は登録時に記録する）。
    if (accountId) {
      const result = await recordConsent({ role, id: accountId }, consent.version, consent.agreedAt);
      if (result.error) { setPending(false); setError(result.error); return; }
    }
    router.replace(next);
  }

  return <div className="app-card space-y-4">
    <p className="text-sm leading-relaxed text-ink-soft">
      「同意する」を押すと、上記の利用規約およびプライバシーポリシーの内容に同意したものとして、同意した日時と文書の版を記録します。
    </p>
    {error && <p role="alert" className="app-error">{error}</p>}
    <button type="button" onClick={onAgree} disabled={pending || !workerReady || !storeReady} className="app-primary w-full">
      {pending ? "記録中…" : "利用規約とプライバシーポリシーに同意する"}
    </button>
    <p className="text-center text-xs leading-relaxed text-ink-soft">
      同意いただけない場合は、シフルンをご利用いただけません。<Link href="/" className="font-semibold text-ink-soft underline underline-offset-2">トップへ戻る</Link>
    </p>
  </div>;
}
