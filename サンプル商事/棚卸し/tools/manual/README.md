# マニュアル自動生成の仕組み

受託開発したシステムを納品するとき、**初心者でも読める利用者マニュアルを短時間で作る**ための仕組みです。

## 設計の考え方

マニュアル作成でいちばん危険なのは「それらしいが実装には無い機能」を書いてしまうことです。
そこでこの仕組みは、**書く前に「根拠（証拠）」を機械的にそろえる**構成にしています。

```
 ①スクリーンショット自動取得        ②コード解析（証拠抽出）
    capture.mjs (Playwright)          evidence.mjs
           │                                │
   docs/manual/images/*.png     tools/manual/.evidence/*.md
           │                                │
           └──────────┬─────────────────────┘
                      ▼
           ③本文の作成（Claude Code のスキル /manual-write）
              ・見た目のことは画像から
              ・仕様・制限・エラーはコードから
              ・どちらにも無いことは書かない
                      ▼
            docs/manual/screens/<画面キー>.md
                      │
        ┌─────────────┴──────────────┐
        ▼                            ▼
   build-index.mjs               build-pdf.mjs
   docs/manual/index.md          配布用PDF
```

役割分担は次のとおりです。

| 担当 | やること |
| --- | --- |
| **機械** | 画面の洗い出し・スクリーンショット取得・入力欄／ボタン／エラーメッセージの抽出・目次生成・PDF化 |
| **Claude（人）** | 集まった証拠を読んで、初心者向けの日本語で本文を書く |

### 「増えても壊れない」ための約束

- 画面の一覧は `manual.config.json` の `screens` が唯一の正。
- `router.js` の `PAGE_ROUTES` に画面を足したら `npm run manual:sync` で自動追記される。
- 目次 `docs/manual/index.md` は毎回 **生成し直す**（手で編集しない）。
- 1画面＝1ファイル。既存の画面には触らずに追加できる。

## 使い方

### 初回だけ

```bash
npm install
npx playwright install chromium

# manual.config.json の source.appUrl にデプロイ済みWebアプリのURLを設定してから
npm run manual:login          # ブラウザが開くのでGoogleログイン（.auth に保存される）
```

### 通常の流れ

```bash
npm run manual:sync           # router.js と画面一覧を突き合わせる
npm run manual:capture        # 全画面のスクリーンショットを撮る
npm run manual:evidence       # コードから証拠ファイルを作る
# → Claude Code で /manual-write <画面キー>（または all）を実行して本文を書く
npm run manual:index          # トップページ（目次）を作り直す
npm run manual:pdf            # 配布用PDFを書き出す
```

### 画面が1つ増えたとき

```bash
npm run manual:sync                        # 画面一覧に自動追記される
npm run manual:capture -- --only=<新キー>
npm run manual:evidence -- --only=<新キー>
# → /manual-write <新キー>
npm run manual:index
```

## コマンド一覧

| コマンド | 内容 |
| --- | --- |
| `npm run manual:sync` | `router.js` の画面ルートを読み、`manual.config.json` に無い画面を追記する |
| `npm run manual:login` | Playwrightで手動ログインし、セッションを `tools/manual/.auth` に保存する |
| `npm run manual:capture` | 本番URLから全画面のPNGを撮る（`--only=` で絞り込み、`--headed` で画面表示） |
| `npm run manual:capture:local` | ログイン不要。ローカルのモックでPNGを撮る |
| `npm run manual:evidence` | 画面ごとの証拠ファイル `tools/manual/.evidence/*.md` を作る |
| `npm run manual:index` | `docs/manual/index.md` を作り直す。未作成の画面も報告する |
| `npm run manual:pdf` | Markdown全体から表紙・目次つきのPDFを書き出す |

## 設定（`manual.config.json`）

| キー | 説明 |
| --- | --- |
| `product` | 表紙・ヘッダに出る製品名／クライアント名／版数 |
| `source.appUrl` | デプロイ済みWebアプリのURL（`.../exec`）。**capture前に必ず設定する** |
| `source.defaultQuery` | 全画面に付けるURLパラメータ（例：`{"clinic":"MOR"}`） |
| `capture.redactSelectors` | スクリーンショットでぼかす要素のCSSセレクタ（患者名など） |
| `capture.viewport` / `deviceScaleFactor` | 撮影サイズ。既定は 1280px幅・2倍解像度 |
| `screens[].query` | その画面を開くためのURLパラメータ |
| `screens[].waitFor` | 撮影前に表示を待つCSSセレクタ |
| `screens[].actions` | 撮影前の操作（`click` / `fill` / `select` / `wait` / `waitFor`） |
| `screens[].shots` | 1画面で複数枚撮りたいとき（`{name, actions, query}` の配列） |

## ログインできない・データが出ないとき

GASのWebアプリは「自分だけがアクセス可能」設定のため、Playwrightからはログインが必要です。
うまくいかないときは `--source=local` を使うと、ログイン無しで画面の見た目を撮れます。

- 表示に使うダミーデータ … `tools/manual/mocks/<画面キー>.json`（全画面共通は `_common.json`）
- キーはサーバー関数名。用意が無い関数は `null` を返すので、空の状態の画面が撮れます。
- **本番データでの見え方は `--source=remote`（既定）で撮り直してください。**

## ファイルの置き場所

```
tools/manual/
  manual.config.json     画面一覧と設定（この仕組みの唯一の設定ファイル）
  capture.mjs            スクリーンショット取得（Playwright）
  evidence.mjs           コード解析 → 証拠ファイル生成
  sync-screens.mjs       router.js と画面一覧の同期
  build-index.mjs        トップページ生成
  build-pdf.mjs          PDF生成
  serve-mock.mjs         ログイン不要撮影用のローカルサーバー
  lib/                   設定読み込み・コード解析・Markdown処理
  templates/             画面マニュアルのひな形 / PDFのスタイル
  mocks/                 ローカル撮影用のダミーデータ
  .auth/                 ログインセッション（配布しないこと）
  .evidence/             自動生成の証拠ファイル（配布しないこと）

docs/manual/
  index.md               トップページ（自動生成）
  screens/<キー>.md      画面ごとのマニュアル本文
  images/<キー>.png      画面のスクリーンショット
  *.pdf                  配布用PDF

.claude/skills/manual-write/SKILL.md   本文を書くときのルールと手順
```

> `tools/` と `docs/` は `.claspignore` で除外しているため、Apps Script へは push されません。

## 他の案件に流用するとき

1. `tools/manual/`・`.claude/skills/manual-write/`・`package.json` の `manual:*` スクリプトをコピーする。
2. `manual.config.json` の `product` / `source.appUrl` / `screens` を書き換える。
3. GAS以外のシステムの場合は `source.type` に応じて次の2点だけ調整する。
   - `capture.mjs` の `resolveAppFrame()`（iframeを使わないなら `page.mainFrame()` を返すだけ）
   - `sync-screens.mjs`（ルート定義の読み取り方。無ければ `screens` を手で書く）

`evidence.mjs` / `build-index.mjs` / `build-pdf.mjs` はプロジェクト非依存です。
