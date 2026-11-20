"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { resolveModerationItem, ResolveState } from "@/lib/actions/moderation";

/** 通報・お問い合わせを、対応内容のメモを付けて「対応済み」にする。 */
export function ResolveForm({ kind, id, placeholder }: { kind: "report" | "inquiry"; id: string; placeholder: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: ResolveState, form: FormData) => {
    const result = await resolveModerationItem(prev, form);
    if (!result.error) router.refresh();
    return result;
  }, {});
  return <form action={action} className="space-y-2 border-t border-line pt-3">
    <input type="hidden" name="kind" value={kind} />
    <input type="hidden" name="id" value={id} />
    <label htmlFor={`note_${id}`} className="app-label">対応内容のメモ</label>
    <textarea id={`note_${id}`} name="note" required rows={2} maxLength={1000} placeholder={placeholder} className="app-input" />
    {state.error && <p role="alert" className="app-error">{state.error}</p>}
    <button disabled={pending} className="app-secondary w-full">{pending ? "保存中…" : "対応済みにする"}</button>
  </form>;
}
