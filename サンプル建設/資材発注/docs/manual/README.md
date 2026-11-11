# 利用者マニュアルの生成の仕組み

ロール（事務 / サンプル市Aセンター / 現場・業者）ごとに、クライアント（サンプル建設）に納品する
利用者マニュアルをまとめている。同じ画面が複数ロールから見える場合、そのロールの視点だけで
書くため、内容の一部が重複する（「自分に関係ない操作の説明を読み飛ばす」負担を無くすための
トレードオフとして意図的に採用）。internal ロールは admin と同等に扱い、独立したマニュアルは
作らない。

## 構成

```
docs/manual/
├─ admin/
│  ├─ admin.md                          … 編集用Markdown原稿
│  ├─ 資材管理システム_事務操作マニュアル.pdf   … 配布用PDF
│  ├─ review_notes_admin.md             … コードと画面の食い違い等の記録
│  └─ screenshot_index_admin.md         … スクリーンショット⇔機能の対応表
├─ center/   （同様の構成）
├─ vendor/   （同様の構成）
├─ screenshots/{admin,center,vendor}/   … 撮影したスクリーンショット一式
├─ manual_review_notes.md               … 3ロール分の気づき・要確認事項の統合版
└─ tools/build-pdf.mjs                  … Markdown原稿 → PDF 変換ツール
```

PDFの再生成（`資材管理実装/web` から実行、`@playwright/test` の chromium を使う）:

```bash
cd 資材管理実装/web
node ../../docs/manual/tools/build-pdf.mjs admin
node ../../docs/manual/tools/build-pdf.mjs center
node ../../docs/manual/tools/build-pdf.mjs vendor
```

## 全体の流れ

1. **スクリーンショット取得（機械的・自動）**
   `資材管理実装/web/e2e-manual/screens.config.ts` に書かれた画面一覧を、
   Playwright が実際にログインして1枚ずつ撮影する。
2. **マニュアル本文の執筆（コード+スクリーンショットの確認が必要なため、Claude Code で実施）**
   `screens.config.ts` の `sourceFiles`（各画面の page.tsx / actions.ts / フォームコンポーネント）と、
   手順1で撮ったスクリーンショットの両方を確認しながら、画面ごとに以下を書く。
   - この画面でできること
   - 操作手順（番号付き）
   - 各項目の説明（入力欄・ボタン・チェックボックスなど）
   - 注意事項
   - よくある質問

   ルール:
   - コードに存在しない機能は書かない。推測で書かない。
   - スクリーンショットだけで分からないこと（バリデーション内容・権限差など）はコードで確認する。
   - コードだけで分からないこと（実際の見た目・表示位置）はスクリーンショットで確認する。

## 画面一覧の正本

`資材管理実装/web/e2e-manual/screens.config.ts` の `SCREEN_GROUPS` が正本。
実際にどのロールがどのパスへアクセスできるかは
`資材管理実装/web/src/lib/auth/access-rules.ts`（`PATH_ACCESS_RULES`）を転記したもの。

## スクリーンショットの再取得

```bash
cd 資材管理実装/web
npm run manual:screenshots
```

- `e2e/.env.e2e`（admin / center / vendor 3ロール分のログイン情報）が必要。
  既存の E2E テスト（`npm run test:e2e`）と同じファイルを共用する。
- 出力先: `docs/manual/screenshots/<role>/<slug>-<view>.png`
- `[id]` を含む画面（詳細・編集など）は URL を直接組み立てず、一覧ページ上の実際のリンクを
  探して遷移する。対象データが1件も無い環境では、その画面だけ警告を出してスキップする
  （撮影全体は失敗させない）。

## 画面が増えた・変わったときの更新手順

1. `screens.config.ts` の `SCREEN_GROUPS` に画面を追加/変更する（ルート・ロール・sourceFiles）。
2. `npm run manual:screenshots` を実行してスクリーンショットを更新する。
3. 影響するロールの `.md` を開き、該当する `# 画面名` セクションを追記・修正する
   （新規画面なら新しい `#` セクションをファイル末尾に追加する）。
4. 新しいロールを追加した場合のみ `index.md` にリンクを追加する（通常は不要）。

## 対象外にしている画面

`/forbidden`・`/no-access`・`error.tsx` は操作対象のページではなく、権限が無い/エラー時に
自動的に表示される案内画面のため、5項目のテンプレート（操作手順・よくある質問など）を書く
対象にせず、各ロールのマニュアル末尾に短い注記としてのみ触れています。
