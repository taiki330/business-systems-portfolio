# 出庫依頼 MVP 仕様（決定事項）

**ステータス**: 確定（2026-05-20 ヒアリング反映）／**実装完了**（2026-05-20）
**スコープ**: P0 / 最小実装
**前提**: ヒアリング担当者からの確定回答に基づく
**実装場所**:
- DB: `資材管理実装/web/supabase/migrations/005_stock_requests.sql`
- Server Action: `資材管理実装/web/src/app/requests/actions.ts`
- 画面: `資材管理実装/web/src/app/requests/{page.tsx, new/page.tsx, [id]/page.tsx}`
- エラーマッピング: `資材管理実装/web/src/lib/stock/apply-movement.ts`

---

## 0. 関連ドキュメント

| 参照 | 用途 |
|------|------|
| `01_要件定義書_草案_キックオフ会議.md` | F-06 / F-07 / F-08 の上位要件 |
| `06_データフロー.md` | 依頼〜出庫の論理シーケンス |
| `07_実装前確認_stock_ledger_入出庫_出庫依頼.md` | 本仕様策定の質問リスト（P0-1〜P0-5 等） |
| `08_stock_ledger_MVP土台.md` | `stock_ledger` / `apply_stock_movement` の前提 |

---

## 1. 確定した業務フロー

```text
[職人] オーダー（依頼登録）
   │
   ▼
[本社/センター担当] 在庫確認
   │
   ▼
[本社/センター担当] 出せる → 出庫実行
                  または キャンセル
```

- **在庫減算は「実際に出庫したタイミング」のみ**。
- **requested / accepted では在庫を減らさない**（引当しない）。
- **shipped にする時のみ** `apply_stock_movement('out')` を実行。
- **在庫不足なら shipped にできない**（RPC が `insufficient_stock` で失敗）。
- **shipped 後の取消・戻し入庫は今回作らない**。

---

## 2. ステータス

| コード | 表示 | 意味 |
|--------|------|------|
| `requested` | 依頼中 | 職人がオーダーした直後 |
| `accepted`  | 受付済み | 本社/センターが受け付けた |
| `shipped`   | 出庫済み | 実際に出庫し、在庫減算済み（ledger に履歴あり） |
| `cancelled` | キャンセル | 依頼中／受付済みの時点で取消 |

### 2-1. 遷移

```text
requested ──> accepted ──> shipped (終端)
    │            │
    └────> cancelled (終端) <─┘
```

| from \ to | accepted | shipped | cancelled |
|-----------|:--------:|:-------:|:---------:|
| requested |   OK     | NG（受付経由のみ） | OK |
| accepted  |    -     | OK       | OK |
| shipped   |    -     |    -     | NG（今回作らない） |
| cancelled |    -     |    -     | - |

---

## 3. テーブル `stock_requests`

| 列 | 型 | 制約 / 既定 | 説明 |
|----|------|-------------|------|
| `id` | uuid | PK / `gen_random_uuid()` | |
| `site_id` | uuid | NOT NULL / FK→`sites` `ON DELETE RESTRICT` | 依頼元の現場 |
| `product_id` | uuid | NOT NULL / FK→`products` `ON DELETE RESTRICT` | 商品 |
| `quantity` | numeric(12,2) | NOT NULL / `> 0` | 依頼数量 |
| `status` | text | NOT NULL / 既定 `'requested'` / CHECK 制約 | `requested` / `accepted` / `shipped` / `cancelled` |
| `requested_by` | text | NULL 可 | 認証実装後に user_id へ移行する箱（**当面 NULL**） |
| `accepted_by`  | text | NULL 可 | 同上 |
| `shipped_by`   | text | NULL 可 | 同上 |
| `requested_at` | timestamptz | NOT NULL / 既定 `now()` | 依頼日時 |
| `accepted_at`  | timestamptz | NULL 可 | 受付日時 |
| `shipped_at`   | timestamptz | NULL 可 | 出庫日時 |
| `cancelled_at` | timestamptz | NULL 可 | キャンセル日時 |
| `note` | text | NULL 可 | 自由メモ |
| `created_at` | timestamptz | NOT NULL / `now()` | |
| `updated_at` | timestamptz | NOT NULL / `now()` / trigger 更新 | 既存 `set_updated_at` を再利用 |

### 3-1. 一意制約・索引

- **同一 `site_id` + `product_id` の未完了依頼は複数許容**（unique 制約を付けない）。
- 索引: `status` / `site_id` / `product_id` / `requested_at desc`。

### 3-2. 削除

- **物理削除は提供しない**。取消は `cancelled` ステータスで表現する。

---

## 4. 出庫元 location

- **`center` 固定**で扱う。
- `stock_requests` に `location` カラムは持たない。
- shipped 化時に内部で `apply_stock_movement(..., 'center', 'out', quantity)` を呼ぶ。
- 貸出在庫・リース・現完滅失等は **MVP 外のため取り込まない**（用語・概念は `docs/10` §2 / §7 を参照。データ構造は未確定）。

---

## 5. shipped 化の整合性ルール

- **1 トランザクションで実行**する DB 関数 `ship_stock_request(p_request_id, p_shipped_by)` を `005` で提供する。
- 関数内で:
  1. `stock_requests` を `FOR UPDATE` でロック
  2. `status = 'accepted'` でなければ例外 `invalid_status_transition`
  3. `apply_stock_movement(product_id, 'center', 'out', quantity)` を呼ぶ
     - 在庫不足は `insufficient_stock` で失敗 → ロールバック → status は `accepted` のまま
  4. `status = 'shipped'`、`shipped_at = now()`、`shipped_by = p_shipped_by` を更新

これにより **「ledger に履歴があるのに status が accepted のまま」または「status は shipped なのに在庫が減っていない」**という不整合は発生しない。

---

## 6. 操作（Server Action 実装）

| 操作 | 遷移 | 設定する列 | DB |
|------|------|-----------|-----|
| 新規依頼 | （新規）→ `requested` | `requested_at = now()` | INSERT |
| 受付 | `requested` → `accepted` | `accepted_at = now()`、`accepted_by`（当面 NULL） | UPDATE |
| 出庫 | `accepted` → `shipped` | `shipped_at`、`shipped_by`（当面 NULL） | RPC `ship_stock_request` |
| キャンセル | `requested` / `accepted` → `cancelled` | `cancelled_at = now()` | UPDATE（ステータス条件付き） |

- **shipped 後のキャンセル不可**。
- **cancelled からの復活不可**。

---

## 7. 画面（最小）

- **URL ルート**: `/requests`
- **一覧**: 初期表示は **`status = 'requested'` のみ**（本社/センターが先に処理すべき依頼）。`?status=` で他ステータスも表示可能。
- **新規** `/requests/new`: 現場・商品・数量・備考。
- **詳細** `/requests/[id]`: 情報表示と、現ステータスに応じた操作ボタン（受付 / 出庫 / キャンセル）。
- 編集・複製・複数明細・印刷・Excel 出力は **作らない**。

---

## 8. 権限・RLS

- 当面は既存 `002`〜`004` と同じ **開発用 anon 全許可**。
- 本格的な権限管理は後フェーズ（認証実装と同時に見直し）。

---

## 9. 「今回作らない」一覧（推測実装防止）

- 引当（受付時に在庫を仮押さえ）
- 複数明細・編集機能
- 通知（システム内・LINE）
- 業者と社内の権限分離
- `site_products` 連動（依頼時は全商品から選ぶ）
- 貸出在庫・リース・振り分け表
- shipped 後の取消・戻し入庫
- Excel エクスポート / 帳票

---

## 10. 改訂履歴

| 日付 | 内容 |
|------|------|
| 2026-05-20 | 初版（ヒアリング Q1〜Q7 回答を反映） |
| 2026-05-20 | 実装完了（`005_stock_requests.sql` + `createRequest` / `acceptRequest` / `cancelRequest` / `shipRequest`） |
