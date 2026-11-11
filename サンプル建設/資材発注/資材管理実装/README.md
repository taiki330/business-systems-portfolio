# 資材管理実装（Next.js + PostgreSQL）

アプリのコード変更・起動・デプロイ作業は **このフォルダ配下**で行います（親の `LINE発注` とは分離）。

| 内容 | 場所 |
|------|------|
| Next.js アプリ | `web/` |
| ホスティング | **Vercel**（予定） |
| データベース | **Supabase**（PostgreSQL） |

要件・ロードマップ・データフローはリポジトリ直下の `docs/` を参照。

---

## まずやること（M0）

**アカウント作成だけでは不十分**ですが、最初のブロックとしては次で足ります。

1. **Supabase**でプロジェクトを1つ作成する。  
2. **Vercel**でアカウントを用意する（後から `web` を Git 連携で紐づけてもよい）。  
3. Supabase の **Project URL** と **anon / service_role キー**、**Database の接続文字列**を控える（まだコードに貼らない）。  
4. `web/.env.example` を見て、ローカル用に `web/.env.local` を自分の PC にだけ作り、そこに実値を書く。

ローカルで動かす: `cd web` → `npm install`（初回のみ）→ `npm run dev`。

---

## 秘密情報（鍵）の置き方 — 必ず守ること

**ID・トークン・API キー・接続文字列は、できるだけソースコードに書かない。**

| 置き場所 | 用途 |
|----------|------|
| **`web/.env.local`**（各開発者の PC のみ） | ローカル開発。Git に**コミットしない**（`.gitignore` で除外）。 |
| **`web/.env.example`** | **変数名だけ**のサンプル。実値は入れない。Git にコミットしてよい。 |
| **Vercel の Environment Variables** | 本番・Preview 用。ダッシュボードから設定。 |
| **Supabase のダッシュボード** | DB パスワードのローテーション、API キー再発行はここから。 |

### 追加ルール

- チャット・メール・スクリーンショットに **本番キーを貼らない**。  
- `service_role` は**サーバー専用**。ブラウザに渡すクライアントコードに埋め込まない。  
- 漏洩したら **即ローテーション**（キー再発行）を前提にする。  
- 親フォルダの `LINE発注/Code.gs` のようにトークン直書きは**新規では行わない**。

---

## 認証必須化フラグ（`REQUIRE_AUTH`）

- ログイン必須化は **既定 ON（Fail Closed）**。未設定・空文字・誤字はすべて ON 側に倒れる。
- ローカル開発でログインなしに動作確認したいときだけ、`web/.env.local` に `REQUIRE_AUTH=0` を設定する。
- **本番・Vercel の Preview / Production 環境変数には `REQUIRE_AUTH=0` を絶対に設定しない**（設定しなければ自動的に ON になる）。
- 判定ロジックは `src/lib/auth/authz-flag.ts` の `isAuthzEnabled()` に一本化している。`process.env.REQUIRE_AUTH` を他の場所で直接見ないこと。

---

## 改訂履歴

| 日付 | 内容 |
|------|------|
| 2026-05-12 | 初版（配置ルール・Supabase/Vercel・秘密情報方針） |
| 2026-07-03 | REQUIRE_AUTH を Fail Closed（既定 ON）に変更。判定ロジックを `authz-flag.ts` に集約。 |
| 2026-07-16 | Phase 2-2（既存ユーザーの権限・業者紐付け管理）完了。`/users` 系画面で、Supabaseで発行済みのログインに対し表示名・role・vendor_id を割り当て・編集可能に（新規Authアカウント発行・`service_role` は対象外のまま）。一覧・メール検索は `list_app_users()` / `resolve_auth_user_by_email()`、他人ユーザー更新は `update_app_user_by_internal()`（いずれも internal 限定の SECURITY DEFINER 関数）経由。自分自身の role/vendor_id 変更は UI・Server Action・DBトリガーの三層で禁止。 |
