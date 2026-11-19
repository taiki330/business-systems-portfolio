# 仮設資材 在庫・発注・リース管理システム

建設会社の仮設資材(足場など)の **在庫・出庫依頼・発注・リース・センター間移動** を一元管理する Web アプリです。
従来は LINE と Excel で運用していた業務を置き換えるために、要件定義から実装・テストまで一人で担当しました。

**状態**: お客様が実際に利用できる状態まで開発しました。退職により、本番環境・実データは手元に残っていません(そのため画面は下記のダミーデータで再現しています)。

## 画面

実際のアプリ(Next.js)を、**ダミーデータだけを返すモックの Supabase につないで起動し、そのまま撮影**した画面です。
画面のコード・レイアウトは実物で、中身の商品名・現場名・数量はすべて架空です
(仕組み: [`tools/mock-screens`](../../tools/mock-screens/) — 再現コマンド `node tools/mock-screens/run.mjs`)。
ログイン中のロール(事務・現場・センター)によって、見える画面とメニューが変わります。

### 事務(管理者)

| ホーム(4 分類) | 在庫・入出庫メニュー |
|---|---|
| ![ホーム(4 分類)](docs/screenshots/admin-01-home.png) | ![在庫・入出庫メニュー](docs/screenshots/admin-02-menu-stock.png) |

| センター在庫 | 現場在庫 |
|---|---|
| ![センター在庫](docs/screenshots/admin-03-stock.png) | ![現場在庫](docs/screenshots/admin-04-stock-sites.png) |

| オーダー一覧 | オーダー詳細 |
|---|---|
| ![オーダー一覧](docs/screenshots/admin-05-orders.png) | ![オーダー詳細](docs/screenshots/admin-06-order-detail.png) |

| 資材発注書(印刷) | 未返却資材一覧 |
|---|---|
| ![資材発注書(印刷)](docs/screenshots/admin-07-order-print.png) | ![未返却資材一覧](docs/screenshots/admin-08-outstanding.png) |

| 現場進捗 | 在庫履歴 |
|---|---|
| ![現場進捗](docs/screenshots/admin-09-progress.png) | ![在庫履歴](docs/screenshots/admin-10-ledger.png) |

| 返却履歴 | 返却期限・未返却リース |
|---|---|
| ![返却履歴](docs/screenshots/admin-11-returns.png) | ![返却期限・未返却リース](docs/screenshots/admin-12-lease-due.png) |

| リース借用管理 | リース在庫内訳 |
|---|---|
| ![リース借用管理](docs/screenshots/admin-13-lease-batches.png) | ![リース在庫内訳](docs/screenshots/admin-14-lease-stock.png) |

| 現場別 予定数量 | 分析ダッシュボード |
|---|---|
| ![現場別 予定数量](docs/screenshots/admin-15-plans.png) | ![分析ダッシュボード](docs/screenshots/admin-16-analytics.png) |

| 現場別分析 | 商品マスタ |
|---|---|
| ![現場別分析](docs/screenshots/admin-17-analytics-sites.png) | ![商品マスタ](docs/screenshots/admin-18-products.png) |

| 現場マスタ | ユーザー管理 |
|---|---|
| ![現場マスタ](docs/screenshots/admin-19-sites.png) | ![ユーザー管理](docs/screenshots/admin-20-users.png) |

### 現場(業者)― 自分の現場の依頼と在庫だけが見えます

| ホーム | 出庫依頼一覧 |
|---|---|
| ![ホーム](docs/screenshots/vendor-01-home.png) | ![出庫依頼一覧](docs/screenshots/vendor-02-requests.png) |

| 出庫依頼の新規登録 | 出庫依頼の詳細 |
|---|---|
| ![出庫依頼の新規登録](docs/screenshots/vendor-03-request-new.png) | ![出庫依頼の詳細](docs/screenshots/vendor-04-request-detail.png) |

| 自現場の在庫 |  |
|---|---|
| ![自現場の在庫](docs/screenshots/vendor-05-site-stock.png) |  |

### センター ― 印刷と在庫確認が中心です

| ホーム | オーダー確認・印刷 |
|---|---|
| ![ホーム](docs/screenshots/center-01-home.png) | ![オーダー確認・印刷](docs/screenshots/center-02-orders.png) |

| センター在庫 |  |
|---|---|
| ![センター在庫](docs/screenshots/center-03-stock.png) |  |

> ホーム画面の「接続状態」などはモックに接続した結果の表示です。

## システム構成

```mermaid
flowchart LR
  subgraph Users["利用者(ロール別)"]
    A["管理者 admin<br/>(事務・本部)"]
    C["センター center<br/>(地域の倉庫)"]
    V["業者 vendor<br/>(協力会社)"]
  end

  subgraph App["Next.js 16 (App Router) / React 19 / TypeScript"]
    UI["画面<br/>在庫・出庫依頼・発注・リース<br/>現場・業者・分析"]
    SA["Server Actions / Route Handlers"]
    AUTH["認証・権限判定<br/>(ロール × 画面 × 操作)"]
  end

  subgraph SB["Supabase"]
    PG[("PostgreSQL<br/>在庫台帳 stock_ledger<br/>RLS ポリシー・RPC")]
    SAUTH["Supabase Auth"]
  end

  GAS["Google Apps Script<br/>現場進捗・マスタ同期"]

  A & C & V --> UI
  UI --> SA --> AUTH
  AUTH --> SAUTH
  SA -->|"RPC(発注・返却・移動は<br/>1トランザクション)"| PG
  GAS -. "現場マスタ・進捗を同期" .-> PG
```

## 設計のポイント

- **在庫は「台帳(stock_ledger)」の積み上げで管理**: 在庫数を直接書き換えず、入庫・出庫・返却・調整をすべて台帳に記録します。履歴を追跡でき、数量の食い違いを検証できます。
- **更新はデータベース側の関数(RPC)で一括実行**: 発注作成・現場返却・センター間移動など、複数テーブルにまたがる処理を 1 トランザクションにまとめ、途中で失敗しても中途半端な状態を残しません。
- **二重送信対策(冪等性)**: 発注作成・明細追加はリクエストの重複を検出し、ダブルクリックや再送で二重登録されません(`083`, `099` 番のマイグレーション)。
- **権限は二重で守る**: アプリ側のロール判定に加え、DB 側の RLS ポリシーでもロールごとのアクセス範囲を制限します。
- **認証は Fail Closed**: 環境変数が未設定・誤記でも「ログイン必須」側に倒れる設計です(`src/lib/auth/authz-flag.ts`)。
- **秘密情報はコードに置かない**: 鍵は環境変数で渡し、`service_role` はサーバー専用です。

## 主な機能

| 領域 | 内容 |
|---|---|
| 在庫 | 倉庫在庫・現場在庫、入出庫、在庫調整(承認フロー)、棚卸し、台帳照会・エクスポート |
| 出庫依頼 | 業者・現場からの依頼、ステータス遷移、返却・過返却の補正 |
| 発注 | 複数明細の発注、ロットサイズ制約、印刷用の伝票、仕入先管理 |
| リース | リース会社、リース在庫、借用一覧、返却期限の管理 |
| センター | 関西・関東・九州など地域センター別の在庫とセンター間移動 |
| 分析 | 現場別・商品別・期間別の動き、稼働率スナップショット |
| 管理 | ユーザー・業者・現場・元請の各マスタ、操作ログ、履歴アーカイブ |

## 技術スタック

Next.js 16 / React 19 / TypeScript / Tailwind CSS 4 / Supabase(PostgreSQL・Auth)/ Playwright(E2E)/ Vercel(ホスティング想定)

## ディレクトリ

```
資材管理実装/web/
  src/app/                 画面(ルーティング)
  src/lib/                 認証・在庫・発注などのドメインロジック
  supabase/migrations/     DB の変更履歴(001〜103、約100本)
  supabase/tests/          DB 側のテスト SQL
  e2e/                     Playwright による E2E テスト
docs/                      要件定義書、設計整理、決定ログ、ロードマップ(23_ が現行仕様の正本)
GENBA_WORK/                現場管理の Google Apps Script 群(職人進捗・是正報告・ダッシュボード など)
LINE発注/                  旧システム(LINE 発注受付の GAS)
```

## 開発の進め方

要件定義 → ヒアリング → 決定ログ → 実装計画 → 実装 → UAT という流れを `docs/` に残しています。
フェーズごとに「設計整理(確定/未確定の区別)」「決定事項(時系列ログ)」「実装計画(ゲート条件)」を作り、
**確定していない仕様は実装しない**ことを徹底しました。
