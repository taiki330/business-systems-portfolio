export function ProvisionalStockNotice() {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span className="font-medium">仮実装:</span>{" "}
      この操作は ledger を経由せず <code className="text-xs">stock_items</code>{" "}
      を直接更新します。入出庫は{" "}
      <a href="/stock/move" className="underline">
        入出庫登録
      </a>
      を使ってください（在庫減算タイミングは顧客確認前の仮置きです）。
    </p>
  );
}
