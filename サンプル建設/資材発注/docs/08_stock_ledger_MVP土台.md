# stock_ledger MVP 土台（実装メモ）

**ステータス**: 開発用・**仮実装**（手動入出庫 `/stock/move` は当面継続）／**出庫依頼との連携は確定済み**（`docs/09`）  
**更新日**: 2026-05-20

---

## 1. テーブル設計（`stock_ledger`）

| 列 | 型 | 説明 |
|----|-----|------|
| `id` | uuid PK | 履歴 ID |
| `product_id` | uuid FK → `products` | 商品 |
| `location` | text | `stock_items` と同じ拠点キー（既定 `center`） |
| `movement_type` | text | `in`（入庫） / `out`（出庫） |
| `quantity` | numeric(12,2) | **正の数**（種別で入出を表現） |
| `created_at` | timestamptz | 記録日時 |

**意図的に含めない列**（未確定・MVP外のため）: `reference_id`（依頼伝票）、`created_by`（認証）、引当フラグ、承認状態。

---

## 2. `stock_items` との関係

| テーブル | 役割 |
|----------|------|
| `stock_items` | **現在庫**（`product_id` + `location` ごとの `quantity`） |
| `stock_ledger` | **履歴**（入出庫の事実。追記のみ） |

**更新ルール（本土台）**

- 入出庫は DB 関数 `apply_stock_movement` で **1 トランザクション**にまとめる。
  1. `stock_items` を `FOR UPDATE` でロック
  2. 出庫時は `quantity` 不足なら **エラー**（マイナス防止）
  3. `stock_items.quantity` を加減算
  4. `stock_ledger` に 1 行 INSERT

- `/stock/new`・`/stock/[id]/edit` の**直接数量編集は暫定メンテのまま残す**が、ledger を経由しない。運用では `/stock/move`（入出庫）を正とする想定。

---

## 3. 仮実装として明記する未確定仕様

| 項目 | 本実装での仮置き | 根拠 |
|------|------------------|------|
| **在庫減算タイミング**（`docs/07` P0-1） | **確定済み**（`docs/09` §1 / §5）: 出庫依頼の `shipped` 化時に `ship_stock_request` RPC が `apply_stock_movement('out')` を呼ぶ。手動入出庫 `/stock/move` も継続利用可（IN / OUT どちらも ledger に追記）。 | 顧客ヒアリング回答（2026-05-20） |
| 拠点 | `location` 文字列。**MVP は `center` 固定**（`docs/09` §4）。現場残・貸出は未確定。 | 既存 `stock_items` と同型 |
| 入庫時の行なし | 入庫で `stock_items` が無ければ **0 から作成** | 移行前のデータ投入のため |

顧客回答後に、依頼連動・引当・減算タイミングを見直す。**→ 依頼連動・減算タイミングは `docs/09` で確定済み（2026-05-20）。引当（仮押さえ）は今回作らない方針で確定。**

---

## 4. migration

- `004_stock_ledger.sql` … テーブル、`apply_stock_movement`、GRANT、RLS（開発用 anon）
- `005_stock_requests.sql` … `stock_requests` テーブルと `ship_stock_request` RPC（内部で `apply_stock_movement('out')` を呼ぶ）。詳細は `docs/09`。

---

## 5. アプリファイル（実装済み）

| ファイル | 理由 |
|----------|------|
| `src/types/stock-ledger.ts` | ledger 型 |
| `src/lib/stock/apply-movement.ts` | RPC 呼び出し・エラーメッセージ |
| `src/app/stock/move/actions.ts` | Server Action |
| `src/components/stock/StockMovementForm.tsx` | 入出庫フォーム |
| `src/app/stock/move/page.tsx` | 入出庫 UI |
| `src/app/stock/ledger/page.tsx` | 履歴一覧（読取） |
| `src/app/stock/page.tsx` | 入出庫・履歴へのリンク |
| `src/components/stock/ProvisionalStockNotice.tsx` | 暫定メンテ注意（new/edit で再利用） |
