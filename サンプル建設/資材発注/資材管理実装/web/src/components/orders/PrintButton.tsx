"use client";

/** ブラウザの印刷ダイアログを開く。帳票データの更新は行わない。 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
    >
      印刷する
    </button>
  );
}
