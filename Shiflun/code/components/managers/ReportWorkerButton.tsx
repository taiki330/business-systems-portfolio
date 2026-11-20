"use client";

import { useActionState, useState } from "react";
import { reportWorker, ReportWorkerState } from "@/lib/actions/worker-flags";

const initialState: ReportWorkerState = {};

/** 自己申告で登録された人に見覚えがない場合、店長が通報するボタン＋簡易フォーム。 */
export function ReportWorkerButton({
  workerId,
  storeName,
}: {
  workerId: string;
  storeName: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(reportWorker, initialState);

  if (state.success) {
    return <p className="text-xs font-semibold text-brand-blue">通報しました</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-rose-500 hover:underline"
      >
        見覚えがない・通報
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-2 flex w-full flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3">
      <input type="hidden" name="worker_id" value={workerId} />
      <input type="hidden" name="store_name" value={storeName} />
      <input
        name="reporter_name"
        placeholder="あなたの名前（店長）"
        required
        className="rounded-lg border border-rose-200 px-3 py-2 text-xs focus:border-rose-500 focus:outline-none"
      />
      <textarea
        name="reason"
        placeholder="通報理由（例：自店で働いている人物に心当たりがない）"
        required
        rows={2}
        className="resize-none rounded-lg border border-rose-200 px-3 py-2 text-xs focus:border-rose-500 focus:outline-none"
      />
      {state.error && <p className="text-xs text-rose-600">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-lg bg-rose-600 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {pending ? "送信中…" : "通報を送信"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-ink-soft hover:bg-paper"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
