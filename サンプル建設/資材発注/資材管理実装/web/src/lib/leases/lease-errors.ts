/**
 * リース関連 RPC が raise する例外コード → 利用者向け日本語メッセージ。
 *
 * 既存の mapMovementError（自社在庫）と同じ方針で、
 * RPC 側のエラーコードを 1 箇所でのみ日本語化する。
 */
const LEASE_ERROR_MESSAGES: Record<string, string> = {
  permission_denied: "この操作を行う権限がありません。",
  lease_batch_not_found: "借用が見つかりません。",
  lease_batch_item_not_found: "借用明細が見つかりません。",
  lease_batch_has_no_items: "明細が1件も登録されていません。先に明細を追加してください。",
  lease_batch_not_approved:
    "未承認の借用は受入できません。事務（admin）の承認後に受入してください。",
  lease_batch_already_received:
    "受入済みの借用はキャンセルできません。返却で処理してください。",
  invalid_status_transition: "現在の状態では実行できない操作です。",
  received_exceeds_borrowed: "受入数量の累計が借用数量を超えています。",
  returned_exceeds_received: "返却数量の累計が受入済み数量を超えています。",
  insufficient_lease_stock:
    "対象の保管場所にリース在庫が足りません。数量を確認してください。",
  lease_stock_item_not_found: "対象のリース在庫が見つかりません。",
  invalid_storage_location: "保管場所の指定が不正です。",
  quantity_must_be_positive: "数量は 0 より大きい数値を入力してください。",
  quantity_must_be_integer: "数量は整数で入力してください。",
  quantity_must_be_non_negative: "数量は 0 以上の数値を入力してください。",
  site_required: "現場を選択してください。",
  lease_company_not_found: "リース会社が見つかりません。",
  lease_company_inactive:
    "このリース会社は無効化されています。有効なリース会社を選択してください。",
  invalid_delivery_kind: "納品先の指定が不正です。",
  item_product_required: "明細の商品を選択してください。",
  duplicate_item:
    "同じ商品・同じ返却期限の明細が重複しています。行をまとめるか、返却期限を変えてください。",
  reason_required: "理由を入力してください。",
  receiving_already_closed: "この明細の受入は既に終了しています。",
  receiving_already_complete: "この明細は既に全量受入済みです。",
  operation_id_required: "画面の再読み込み後にもう一度お試しください。",
  operation_id_conflict:
    "別の操作と識別情報が重複しました。画面を再読み込みしてからやり直してください。",
};

export function mapLeaseError(message: string): string {
  for (const [code, text] of Object.entries(LEASE_ERROR_MESSAGES)) {
    if (message.includes(code)) return text;
  }
  return message;
}
