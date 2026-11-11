# center 向けマニュアル作成時の気づき・要確認事項

作成対象: `docs/manual/center/center.md`
調査範囲: `資材管理実装/web/e2e-manual/screens.config.ts` の `roles` に `"center"` を含む画面（login, set-password, home, orders[list/detail/print], stock[list], stock-sites[list], stock-inventory[list/detail]）と、
`src/lib/auth/access-rules.ts`、`src/lib/auth/ui-capabilities.ts`。

## 1. center が初回パスワード設定画面（/auth/set-password）に到達できない可能性（要確認・重要）

- `src/app/layout.tsx` の `AUTHZ_EXEMPT_PATHS` には `/login`, `/auth/signout`, `/no-access`, `/forbidden` のみが登録されており、`/auth/set-password` は含まれていません。
- `src/lib/auth/access-rules.ts` の `PATH_ACCESS_RULES` にも `/auth/set-password` に対応するルールがありません。
- `evaluatePathAccess` は、どのルールにもマッチしないパスに対して「center のみ forbidden、admin/vendor は allow」を返す実装です（コード内コメント「center はヒアリングで確定した画面だけを明示許可する（新規画面は既定拒否）」）。
- そのため、ログイン済みの center ユーザーが `/auth/set-password` を開くと、root layout が `evaluatePathAccess` の結果 `forbidden` を受けて `/forbidden`（403画面）へリダイレクトすると読めます。
- 実際、本タスクで用意された `docs/manual/screenshots/center/set-password-page.png` は、初回パスワード設定フォームではなく「403 FORBIDDEN／この画面にはアクセスできません」という画面が撮影されていました。これはこの経路の推測を裏付ける状況証拠です。
- screens.config.ts では `set-password` の `roles` に `"center"` が含まれており、center も本来この画面を使う想定になっています（招待直後の初回パスワード設定に必須の画面のはずです）。
- 影響が事実であれば、centerユーザーが招待リンクから初回パスワードを設定できない可能性があり、業務影響が大きいため、開発チームでの実機確認を強く推奨します。
- center.md では、screens.config.ts の正本に従い「初回パスワード設定」の手順（フォームの使い方）をそのまま記載していますが、上記の理由からスクリーンショットは掲載していません（403画面を初回パスワード設定の手順として載せると誤解を招くため）。

## 2. スクリーンショットが撮れていない棚卸の状態

- `docs/manual/screenshots/center/` には棚卸の一覧（`stock-inventory-list.png`）と「実数入力中（draft）」状態の詳細画面（`stock-inventory-detail.png`）のみが存在し、「差異確認中（counted）」状態および「完了（completed）」状態の画面のスクリーンショットはありませんでした。
- center.md の「5-3. 差異を確認して在庫へ反映する」は `src/app/stock/inventory/[id]/page.tsx` のソースコードの記述に基づいて手順・表示内容を記載していますが、画像による裏付けができていません。実際の画面表示と齟齬がないか、実機で確認することを推奨します。

## 3. 用語・表記ゆれ（軽微）

- ホーム画面の説明文（`src/app/page.tsx`）では「オーダーの印刷と、センター・現場の在庫確認を行います。」と書かれており、棚卸には触れていません。一方 `homeNavLinks` には「棚卸」へのリンクがあり、実際に center が棚卸を行えます。ホーム画面の説明文とリンク一覧の間に軽微な表記の食い違いがあります（機能自体は正しく使えるため、マニュアルの正確性には影響していません）。

## 4. 確認済みで問題なしと判断した点

- center が使える画面は `/orders`、`/stock`、`/stock/inventory`、`/stock/sites` の4つのみであることを `access-rules.ts` の `PATH_ACCESS_RULES` および `ui-capabilities.ts` の `homeNavLinks(role === "center")` の両方で確認しました。
- `/stock`（センター在庫）、`/stock/sites`（現場在庫）のスクリーンショットで、返却登録・入出庫登録・暫定メンテ・履歴のリンクや操作列が center には表示されていないことを実画像で確認しました（`canShowStockReturn` / `canShowStockMovement` / `canShowStockDirectEdit` はいずれも `role === "admin"` のみ true）。
- `/orders/[id]` で center が実際に押せる操作は「出庫完了」（`requireCenter()`）と「ヤード積込日の保存」（`requireAdminOrCenter()`）のみで、数量修正・明細追加・自社／リース区分変更は admin 専用（`requireAdmin()`）であることをソースコードで確認し、center.md では admin 専用操作を記載していません。
