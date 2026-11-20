"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { liftSuspension, SuspensionState } from "@/lib/actions/moderation";

/** 利用停止の解除。理由を残して解除する。 */
export function LiftSuspensionForm({ id }: { id: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: SuspensionState, form: FormData) => {
    const result = await liftSuspension(prev, form);
    if (result.success) router.refresh();
    return result;
  }, {} as SuspensionState);
  return <form action={action} className="space-y-2 border-t border-line pt-3">
    <input type="hidden" name="id" value={id} />
    <label htmlFor={`lift_${id}`} className="app-label">解除の理由</label>
    <textarea id={`lift_${id}`} name="note" required rows={2} maxLength={1000} className="app-input" placeholder="例：本人から謝罪があり、再発しないことを確認した" />
    {state.error && <p role="alert" className="app-error">{state.error}</p>}
    <button disabled={pending} className="app-secondary w-full">{pending ? "解除中…" : "利用停止を解除する"}</button>
  </form>;
}
