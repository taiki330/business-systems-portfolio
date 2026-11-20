/** 読み込み中の表示。小さな回転する輪と、ひとこと。 */
export function LoadingMascot({ label = "読み込み中…" }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-3 py-12">
      <span aria-hidden="true" className="size-7 animate-spin rounded-full border-[3px] border-line border-t-brand-blue motion-reduce:animate-none" />
      <p className="text-sm text-ink-soft">{label}</p>
    </div>
  );
}
