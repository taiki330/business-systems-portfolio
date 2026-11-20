# Shiflun(業種特化型・シフト連動型マッチングアプリ)

店舗とワーカーをつなぐ、シフト連動型のスポットワークマッチングアプリです。Next.js + TypeScript + Supabase(Capacitor で iOS/Android 化)。

- ポートフォリオページ: [`portfolio/shiflun-portfolio.html`](portfolio/shiflun-portfolio.html)(公開版: https://claude.ai/artifact/EBciGWSwVJEaAuKEHzTUjx)
- ソースコード: [`code/`](code/README.md)
- コミット履歴: [`commit-history.txt`](commit-history.txt)

## 見てほしい場所

- サービスの仕組み: `code/docs/legal/01_service-overview.md`
- データベースの設計と変更の流れ: `code/supabase/migrations/`(001〜026)
- ログインとアクセス制限(RLS): `code/supabase/migrations/022_auth_rls.sql`
- 18歳未満の夜間規制: `code/supabase/migrations/026_privacy_store_change_minor_suspension.sql`
- 画面: `code/app/`(ワーカー `workers/`、店舗 `managers/` `companies/`、運営 `admin/`)
- テスト: `code/tests/`

## 動かす場合

DB につながずデモデータで画面を確認できます。

```powershell
cd code
npm install
$env:DEMO_MOCK = "true"; npx next dev -p 3123
```

http://localhost:3123 を開く。`.env.local` は作らないでください(作ると本番 DB につながります)。

※ 利用規約・プライバシーポリシーの原稿(`/terms` `/privacy` が読み込むファイル)は、公開リポジトリには含めていません。
