"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { purgeDeletedIdentityDocuments, PurgeState } from "@/lib/actions/moderation";

/** 退会したワーカーの身分証画像が残っているときに出す。押すと Storage から削除する。 */
export function IdentityPurgeBanner({ count }: { count: number }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (): Promise<PurgeState> => {
    const result = await purgeDeletedIdentityDocuments();
    router.refresh();
    return result;
  }, {});
  if (count === 0 && state.purged === undefined && !state.error) return null;
  return <section className="rounded-xl border border-brand-yellow bg-brand-yellow-light p-4">
    {count > 0 && <>
      <h2 className="text-sm font-bold text-brand-yellow-dark">退会した人の身分証画像が {count} 人分残っています</h2>
      <p className="mt-1 text-sm leading-relaxed text-brand-yellow-dark">退会後は画像を残さない約束です。下のボタンで削除してください。</p>
      <form action={action} className="mt-3"><button disabled={pending} className="app-secondary w-full border-brand-yellow">{pending ? "削除中…" : "身分証画像を削除する"}</button></form>
    </>}
    {state.error && <p role="alert" className="app-error mt-3">{state.error}</p>}
    {state.purged !== undefined && !state.error && <p role="status" className="text-sm font-semibold text-brand-yellow-dark">{state.purged} 人分の身分証画像を削除しました。</p>}
  </section>;
}
