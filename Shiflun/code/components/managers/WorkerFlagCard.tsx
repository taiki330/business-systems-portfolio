"use client";

import { useActionState } from "react";
import { resolveWorkerFlag, ResolveWorkerFlagState } from "@/lib/actions/worker-flags";
import { WorkerFlag } from "@/lib/types/database";

const initialState: ResolveWorkerFlagState = {};

type FlagWithWorker = WorkerFlag & {
  workers: { id: string; name: string; current_store: string } | null;
};

export function WorkerFlagCard({ flag }: { flag: FlagWithWorker }) {
  const [state, formAction, pending] = useActionState(resolveWorkerFlag, initialState);

  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
      <p className="text-sm font-bold text-ink">
        {flag.workers?.name ?? "（削除済みのワーカー）"}
        <span className="ml-2 text-xs font-normal text-ink-soft">{flag.store_name}</span>
      </p>
      <p className="mt-1 text-xs text-ink-soft">通報者: {flag.reporter_name}</p>
      <p className="mt-2 rounded-lg bg-white px-3 py-2 text-xs text-ink-soft">{flag.reason}</p>
      <p className="mt-2 text-[10px] text-ink-soft">
        {new Date(flag.created_at).toLocaleDateString("ja-JP")} 通報
      </p>

      {state.error && <p className="mt-2 text-xs text-rose-600">{state.error}</p>}

      <div className="mt-3 flex gap-2">
        <form action={formAction} className="flex-1">
          <input type="hidden" name="flag_id" value={flag.id} />
          <input type="hidden" name="resolution" value="resolved" />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-rose-600 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            対応済みにする（不正の疑いあり）
          </button>
        </form>
        <form action={formAction} className="flex-1">
          <input type="hidden" name="flag_id" value={flag.id} />
          <input type="hidden" name="resolution" value="dismissed" />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl border border-line bg-white py-2 text-xs font-semibold text-ink-soft hover:bg-paper disabled:opacity-50"
          >
            問題なし（取り下げ）
          </button>
        </form>
      </div>
    </div>
  );
}
