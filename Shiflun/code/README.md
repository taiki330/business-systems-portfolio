# Shiflun

飲食業界向け「現役バイト認証付きスカウトサービス」です。デモ MVP として始まり、**現在は本番運用に向けて開発を進めています。**

Next.js + Supabase + Vercel を前提に構築しています。

## 技術スタック

- Next.js 16（App Router）
- TypeScript
- Tailwind CSS
- Supabase（PostgreSQL）

## 前提・本番化に向けた現状

- **ログイン（Supabase Auth）と、全テーブルのアクセス制限（RLS）を導入済みです（migration 022）。** ワーカーはメールの確認コード、店長はメールアドレスとパスワードでログインします。ログインしていない状態（anon key）では、どのテーブルも読み書きできません。詳細は下記「`022_auth_rls.sql`（ログインとアクセス制限）」を参照
- 実際の送金（決済代行連携）・外部eKYCベンダー連携は未実装です
  - 通知（アプリ内）・チャットは実装済みです（Phase 8-C）
  - 支払い状況・本人確認は「店舗/運営が手動で記録・審査する」暫定実装があります（Phase 9-A・9-B）。実際にお金を動かしたり、本物の身分証確認を行ったりはしません
  - 身分証の画像と提出記録を読めるのは、2段階認証でログインした運営の審査担当だけです（`/admin/identity-verifications`）

## ローカル起動手順

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

```bash
cp .env.local.example .env.local
```

`.env.local` に Supabase の値を設定します。

| 変数名 | 取得場所 |
|--------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API → anon public key |

### 3. Supabase でテーブルを作成

1. [Supabase](https://supabase.com/) で新規プロジェクトを作成
2. Dashboard → **SQL Editor** を開く
3. `supabase/migrations/001_initial_schema.sql` の内容を貼り付けて実行
4. Phase 2 以降を使う場合は、続けて `supabase/migrations/002_phase2_industry_skills_availability.sql` も実行
5. Phase 3 以降を使う場合は、続けて `supabase/migrations/003_phase3_manager_verification.sql` も実行
6. Phase 4 以降を使う場合は、続けて `supabase/migrations/004_phase4_scout_requests.sql` も実行
7. Phase 5 以降を使う場合は、続けて `supabase/migrations/005_phase5_availability_work_date.sql` も実行
8. Phase 5-D 以降を使う場合は、続けて `supabase/migrations/006_phase5d_shift_status.sql` も実行
9. Phase 6（シフト期間管理）を使う場合は、続けて `supabase/migrations/007_shift_periods.sql` も実行
10. Phase 7（companies / stores 正規化）を使う場合は、続けて `supabase/migrations/008_phase7_companies_stores_normalization.sql` も実行
11. Phase 7-B（店舗参加の自己申告）を使う場合は、続けて `supabase/migrations/010_store_join_requests.sql` も実行
12. Phase 7-C（スカウトステータス・自己申告プロフィール拡張）を使う場合は、続けて `supabase/migrations/011_scout_status_join_profile.sql` も実行
13. Phase 8-A（スカウト成立→勤怠連携）を使う場合は、続けて `supabase/migrations/012_scout_shift_link_and_attendance.sql` も実行
14. Phase 8-B（店舗所属の自己申告制＋通報機能）を使う場合は、続けて `supabase/migrations/013_self_report_join_and_worker_flags.sql` も実行
15. Phase 8-C（提示額・プロフィール・承諾後チャット・アプリ内通知）を使う場合は、続けて `supabase/migrations/014_matching_profiles_chat_notifications.sql` も実行（詳細は [docs/matching-chat.md](docs/matching-chat.md)）
16. Phase 9-A（支払い状況の手動記録）を使う場合は、続けて `supabase/migrations/015_payouts.sql` も実行
17. Phase 9-B（本人確認の暫定実装）を使う場合は、続けて `supabase/migrations/016_identity_verifications.sql` も実行（Storageバケット作成に失敗する場合はDashboardから手動作成）
18. Phase 9-C（未成年ワーカーの親権者同意）を使う場合は、続けて `supabase/migrations/017_minor_guardian_consent.sql` も実行
19. 続けて `018_identity_documents_access_restriction.sql`〜`022_auth_rls.sql` を順に実行（022 でログインとアクセス制限が入ります。**022 の前に、ログインと結びついていないデータは消しておく必要があります**）

> **本番DB（001〜014・017 が適用済み）の場合**は、`supabase/setup/reset_and_apply_015-022.sql` を SQL Editor に貼り付けて1回だけ実行してください。テストデータを消してから 015〜022 を当てます。**最初にアプリのデータがすべて消えます**（実際の利用者のデータが入った後は実行しないこと）。このファイルは `supabase/setup/reset_test_data.sql` と各migrationをつなげたもので、元のファイルを直したら作り直してください。

作成されるテーブル:

- `workers` — ワーカープロフィール（`skill_tags` 配列カラム含む）
- `manager_verifications` — 店長認証（`store_name` カラム含む、1ワーカー1認証）
- `scout_requests` — スカウト送信（`store_name`・希望勤務条件・提示時給カラム含む）
- `worker_availability_slots` — 勤務可能時間（`work_date` カラム含む。Phase 8-A でスカウト連携・勤怠打刻カラムを追加）
- `shift_periods` — シフト期間管理
- `companies` — 企業（Phase 7 で追加）
- `stores` — 店舗、1 company : N stores（Phase 7 で追加）
- `store_join_requests` — 店舗所属の自己申告記録（Phase 7-B で追加。Phase 8-B 以降は承認待ちのゲートではなく記録用）
- `worker_flags` — 店長による通報（Phase 8-B で追加）
- `scout_messages` / `app_notifications` — 承諾後チャット・アプリ内通知（Phase 8-C で追加。詳細は [docs/matching-chat.md](docs/matching-chat.md)）
- `payouts` — 支払い状況の手動記録（Phase 9-A で追加）
- `identity_verifications` — 本人確認の提出・審査記録（Phase 9-B で追加）

#### Phase 3-A: `003_phase3_manager_verification.sql` の内容

既に Phase 1・2 の SQL を実行済みの場合、**003 だけ**を SQL Editor に貼り付けて実行します。

| 変更 | 内容 |
|------|------|
| `manager_verifications.store_name` | 店長が入力する店舗名（NOT NULL） |
| `uq_manager_verifications_worker_id` | `worker_id` に UNIQUE 制約（1ワーカー1認証） |

**Supabase での確認場所**

1. Dashboard → **Table Editor** → `manager_verifications`
2. カラム一覧に `store_name` があること
3. Dashboard → **Database** → **Tables** → `manager_verifications` → **Constraints** に `uq_manager_verifications_worker_id` があること

> 同一 `worker_id` のレコードが複数あると UNIQUE 制約の追加に失敗します。その場合は重複を削除してから再実行してください。

#### Phase 4-B: `004_phase4_scout_requests.sql` の内容

既に Phase 1〜3 の SQL を実行済みの場合、**004 だけ**を SQL Editor に貼り付けて実行します。

| 変更 | 内容 |
|------|------|
| `scout_requests.store_name` | 店舗名（NULL 許容、必須はアプリ側） |
| `scout_requests.preferred_work_date` | 希望勤務日（NULL 許容） |
| `scout_requests.preferred_start_time` | 希望開始時間（NULL 許容） |
| `scout_requests.preferred_end_time` | 希望終了時間（NULL 許容） |
| `scout_requests.offered_hourly_wage` | 提示時給（NULL 許容） |
| `chk_scout_requests_time_range` | 終了 > 開始（NULL 時はスキップ） |
| `chk_scout_requests_offered_hourly_wage` | 時給 > 0（NULL 時はスキップ） |

**Supabase での確認場所**

1. Dashboard → **Table Editor** → `scout_requests`
2. カラム一覧に `store_name`, `preferred_work_date`, `preferred_start_time`, `preferred_end_time`, `offered_hourly_wage` があること
3. Dashboard → **Database** → **Tables** → `scout_requests` → **Constraints** に上記 CHECK 制約があること

#### Phase 5-A: `005_phase5_availability_work_date.sql` の内容

既に Phase 1〜4 の SQL を実行済みの場合、**005 だけ**を SQL Editor に貼り付けて実行します。

| 変更 | 内容 |
|------|------|
| `worker_availability_slots.work_date` | 勤務可能日（DATE, NULL 許容） |
| `day_of_week` | NULL 許容に変更 |
| `idx_worker_availability_slots_work_date` | 日付検索用インデックス |
| `idx_worker_availability_slots_search` | 日付+時間帯検索用インデックス |

**Supabase での確認場所**

1. Dashboard → **Table Editor** → `worker_availability_slots`
2. カラム `work_date` があること
3. `day_of_week` が Nullable であること

#### Phase 5-D: `006_phase5d_shift_status.sql` の内容

| 変更 | 内容 |
|------|------|
| `status` | pending / assigned / released / cancelled |
| `reviewed_at` | 店長判定日時 |
| 検索インデックス | work_date + status + 時間帯 |

> **注意:** この MVP では RLS を有効化しません。本番化前に Supabase Auth + RLS を導入してください。

#### Phase 7: `008_phase7_companies_stores_normalization.sql` の内容

`company_name` / `store_name` / `current_store`（自由入力）を正規化するための下地です。
**additive-only** — 既存カラムは削除せず、新カラムは全て NULL 許容です。既存アプリのコード・画面は変更していません。

| 変更 | 内容 |
|------|------|
| `companies`（新規テーブル） | `id`, `name`（NOT NULL）, `created_at` |
| `stores`（新規テーブル） | `id`, `company_id`（NOT NULL, `companies` 参照）, `name`（NOT NULL）, `owner_user_id`（NULL, `auth.users` 参照）, `created_at` |
| `workers.user_id` | `auth.users` 参照（NULL 許容、UNIQUE） |
| `workers.current_store_id` | `stores` 参照（NULL 許容、`current_store` の正規化先） |
| `manager_verifications.store_id` | `stores` 参照（NULL 許容、`store_name` の正規化先） |
| `scout_requests.store_id` | `stores` 参照（NULL 許容、`company_name`/`store_name` の正規化先。`company_id` は持たず `stores.company_id` から辿る） |
| `shift_periods.store_id` | `stores` 参照（NULL 許容、`store_name` の正規化先） |
| `worker_availability_slots.store_id` | `stores` 参照（NULL 許容、assigned/released 先の店舗を追跡する下地） |

**Supabase での確認場所**

1. Dashboard → **Table Editor** → `companies`, `stores` が作成されていること
2. `workers`, `manager_verifications`, `scout_requests`, `shift_periods`, `worker_availability_slots` の各テーブルに `store_id`（`workers` は `current_store_id`）カラムが追加されていること
3. Dashboard → **Database** → **Tables** → `workers` → **Constraints** に `uq_workers_user_id` があること
4. 既存の `company_name` / `store_name` / `current_store` カラムがそのまま残っていること（削除されていないこと）

> **注意:** このフェーズでは既存デモデータの `store_name` → `store_id` の名寄せは行いません。新カラムは Phase 8 以降、認証導入と合わせて値を投入します。

#### Phase 8-A: `012_scout_shift_link_and_attendance.sql` の内容

スカウトが承諾された時点で `worker_availability_slots` に勤務枠（`status = 'assigned'`）を自動作成し、出勤打刻の対象にする。あわせて、`status = 'attended'` を許可していなかった既存の CHECK 制約の不具合も修正。

| 変更 | 内容 |
|------|------|
| `worker_availability_slots.store_name` / `company_name` | スカウト経由の勤務枠に入る店舗名・企業名（自店舗シフトでは NULL） |
| `worker_availability_slots.scout_request_id` | もとになったスカウトへの参照 |
| `worker_availability_slots.hourly_wage` | スカウトの提示時給を引き継ぐ |
| `worker_availability_slots.clock_in_at` / `clock_out_at` / `clock_in_lat` / `clock_in_lng` / `clock_out_lat` / `clock_out_lng` | 出退勤の日時・位置情報 |
| `worker_availability_slots.checkin_method` | `self_report` / `gps` / `qr` |
| `chk_worker_availability_slots_status` | `attended` を許可するよう修正（既存バグ修正） |

**Supabase での確認場所**

1. Dashboard → **Table Editor** → `worker_availability_slots`
2. 上記カラムが追加されていること
3. ワーカーがスカウトを承諾すると、同テーブルに `status = 'assigned'` の新規行ができること

#### Phase 8-B: `013_self_report_join_and_worker_flags.sql` の内容

弁護士・自治体への相談で、店舗所属の店長承認フローが有料職業紹介事業の「あっせん」に該当しうると指摘されたため、店舗所属を店長の事前承認制から**自己申告制＋店長による事後の通報**に変更した（詳細は `docs/legal/05_open-issues.md`）。この対応で法的リスクが解消されるとは限らず、要再確認。

| 変更 | 内容 |
|------|------|
| `store_join_requests` | 承認待ちのゲートとしては使わず、自己申告の記録として `status = 'approved'` で作成 |
| `worker_flags`（新規テーブル） | 店長が「見覚えがない」と通報した記録。`status`: open / resolved / dismissed |

**Supabase での確認場所**

1. Dashboard → **Table Editor** → `worker_flags` が作成されていること
2. `/workers/join-store` から登録すると、承認を待たずに即座に `workers` テーブルへ行が追加されること
3. `/managers/staff` のスタッフ一覧から「見覚えがない・通報」で `worker_flags` に行が追加されること

#### Phase 9-A: `015_payouts.sql` の内容

docs/legal/02_money-flow.md の案A（無仲介）を暫定実装。Shiflunは送金せず、店舗が直接ワーカーへ支払い、支払い済みかどうかを手動で記録するだけの機能です。出勤打刻（`status = 'attended'`）が確定すると、DBトリガーが自動的に `payouts` レコードを作成します。

| 変更 | 内容 |
|------|------|
| `payouts`（新規テーブル） | `wage_amount_yen` / `service_fee_yen`（migration 014 の金額計算を引き継ぐ）、`status`: pending / paid |
| `create_payout_on_attendance` トリガー | 出勤確定時に自動でレコード作成（スカウト経由の勤務枠のみ対象） |

**画面**: `/managers/payouts`（店舗側が支払い済みにする）、`/workers/earnings`（ワーカー側の収入確認）

#### Phase 9-B: `016_identity_verifications.sql` の内容

要件定義書のeKYC構想について、外部ベンダー未契約のため「本人が身分証画像を提出し、運営が目視審査する」暫定フローを実装。店長認証（勤務実績の確認）とは別物です。

| 変更 | 内容 |
|------|------|
| `identity_verifications`（新規テーブル） | `status`: unverified / pending / verified / rejected |
| `identity-documents` Storageバケット（非公開） | 身分証画像の保管用 |

> 作成時点では anon の読み書きを許可していましたが、018 で読み取りを閉じ、**022 で提出は本人のフォルダだけ・閲覧は2段階認証済みの審査担当だけ**にしました。

**画面**: `/workers/verify-identity`（提出）、`/admin/identity-verifications`（運営の審査担当のみ。下記 022 参照）

**Supabase での確認場所**

1. Dashboard → **Storage** → `identity-documents` バケットが作成されていること（非公開）
2. 作成に失敗した場合は手動でバケットを作成し、`016_identity_verifications.sql` 内のポリシー定義（`CREATE POLICY ... ON storage.objects`）部分のみ再実行

#### Phase 9-C: `017_minor_guardian_consent.sql` の内容

利用規約第13条（未成年の親権者同意）について、登録フローに同意取得UIがなかった点（[docs/legal/05_open-issues.md](docs/legal/05_open-issues.md) #11）に対応。`/workers/join-store` の登録フォームで年齢区分を選択し、未成年の場合は親権者氏名と同意チェックを必須にしています。

| 変更 | 内容 |
|------|------|
| `workers.is_minor` / `guardian_name` / `guardian_consented_at` | 未成年の場合は氏名・同意日時が必須（CHECK制約あり） |

#### Phase 9-E: `018_identity_documents_access_restriction.sql` の内容

`identity-documents` バケットの anon 読み取りポリシーを撤廃しました。当時は認証が無かったため、画像の閲覧だけを service role key 経由にしていましたが、**022 でログインとアクセス制限に置き換え、service role key は使わなくなりました**（下記 022 参照）。

#### `019_staff_chat.sql` の内容（所属スタッフ ⇔ 店長チャット）

下のバーの「チャット」タブから、所属先の店長とのシフト相談と、承諾済みスカウトの会話をまとめて開けます。

| 変更 | 内容 |
|------|------|
| `staff_messages` | スタッフと店長の会話。送信時点の `store_id` を保存し、異動後も履歴は元の店舗に残る |
| `check_staff_message` トリガー | `workers.current_store_id` と一致する店舗とだけ送信可能 |
| `app_notifications` | `scout_id` を NULL 許可、`staff_message_id` / `staff_worker_id` を追加、`kind` に `staff_message` を追加 |
| `notify_staff_message` トリガー | 相手側にだけ通知を作成 |

> 送信者はログイン中の本人に限られます（022 の RLS）。

#### `020_terms_consent.sql` と 規約・ポリシーの表示

- `/terms`（利用規約）と `/privacy`（プライバシーポリシー）は、リポジトリ直下の Markdown をビルド時に読み込んで表示します。どのファイル・版を使うかは `lib/legal/versions.ts` で管理します。
- 同意は登録フォームのチェックボックスではなく、別ページ `/agreement` で取ります（弁護士の助言による）。利用規約とプライバシーポリシーの全文を表示し、末尾の「同意する」ボタンを押すと同意したことになります。
- ワーカー登録（`/workers/join-store`）と店舗の新規登録（`/managers/settings`）は、同意するまでフォームを出さず、同意ページへの案内を表示します（`components/legal/ConsentGate.tsx`）。同意後は元の画面に戻ります。
- ボタンを押した時刻と版は端末に保存し、登録の送信時にサーバーへ送ります。サーバーは「現在の版で、24時間以内」の同意だけを受け付け（`validConsentTime`）、版（例: `terms-v4+privacy-v1-draft`）とボタンを押した日時を `workers` / `stores` の `terms_version` / `terms_agreed_at` に保存します。
- 登録済みのアカウントで `terms_version` が現在の版と違う（未同意・旧版）場合は、ワーカー画面・店長画面を開いたときに同意ページへ移動させ、同意するとその場で記録します（`components/legal/ConsentRecheck.tsx`、`lib/actions/consent.ts`）。
- 文書を改定したら `lib/legal/versions.ts` の `file` と `version` を更新してください。版が変わると、全員が次に画面を開いたときに再同意を求められます。
- 同意の記録は、ログイン中の本人のワーカー・店舗にだけ書き込めます（022 の RLS）。
- **プライバシーポリシーは弁護士確認前のドラフトです**（`draft: true` の間は画面に「確定前の案」と表示）。本文中の【要確認】【要記入】を解消してから `draft: false` にしてください。

#### `021_store_access_policies.sql`（店舗の候補が空になる問題）

Supabase 側で `companies` / `stores` の RLS が有効になっていてポリシーが無いと、店舗が0件に見えていた問題への暫定対応でした（anon に閲覧・登録・更新を許可）。**022 でこのポリシーは削除し、ログイン中の利用者向けのポリシーに置き換えています。** RLS の状態は `supabase/diagnostics/rls_status.sql` で確認できます。

#### `022_auth_rls.sql`（ログインとアクセス制限）

これまでは端末に保存したIDで本人を区別しており、公開用の anon キーでどのテーブルも読み書きできました。022 で次のようにしています。

| 対象 | 内容 |
|------|------|
| ログイン | ワーカーは `workers.user_id`、店長は `stores.owner_user_id` でログインユーザーと結びつく（どちらも必須）。1つのログインでワーカー1人・店舗1つまで |
| anon（ログインしていない状態） | どのテーブル・関数も使えない |
| ワーカー | 自分のプロフィール・シフト・スカウト・チャット・通知・支払いだけ。認証状態（`verification_status`）は自分で変えられない |
| 店長 | 人材検索用のワーカー情報と公開シフト、自店のスタッフ・スカウト・チャット・支払い・シフト期間・通報。自店のスタッフの勤務希望だけ確定・公開できる |
| 審査担当 | `app_metadata.role = 'identity_reviewer'` で、2段階認証（aal2）でログインしたときだけ、身分証の画像と提出記録を読める・審査結果を書ける |
| 変更の制限 | シフトの状態遷移（確定・公開・出勤・退勤）はトリガー `guard_slot_update` で確認。提示額・通知・支払い額などは、決められた関数・トリガー以外では変えられない |

**ログイン画面**: `/login`（ワーカー：メールの確認コード）、`/managers/login`（店長：メールアドレス＋パスワード。新規登録・パスワード再設定はメールの確認コード）、`/admin/login`（審査担当：パスワード＋認証アプリ）。ログインが必要なページは `proxy.ts` がログイン画面へ案内します（データの保護自体は RLS が行います）。

**Supabase 側で必要な設定**（Dashboard）

1. **Authentication → Sign In / Providers → Email**：有効にし、「Confirm email」をオンにする。パスワードの最小文字数は8以上にする
2. **Authentication → Emails（Email Templates）**：アプリはメールのリンクではなく**確認コード**を使います（スマホアプリの中ではメールのリンクを開けないため）。次の3つのテンプレートに `{{ .Token }}`（確認コード）を入れてください。リンク（`{{ .ConfirmationURL }}`）は消してかまいません
   - **Magic Link**（ワーカーのログイン）、**Confirm signup**（店長の新規登録）、**Reset Password**（店長のパスワード再設定）
   - 例：`<p>シフルンの確認コード：<strong>{{ .Token }}</strong></p><p>このコードを画面に入力してください。心当たりがない場合は、このメールを破棄してください。</p>`
3. **Authentication → Emails → SMTP Settings**：Supabase 標準のメール送信は1時間あたりの送信数がごく少なく、本番では足りません。独自の SMTP（メール配信サービス）を設定してください（送信数の上限・費用は要確認）
4. **Authentication → Multi-Factor**：TOTP（認証アプリ）を有効にする（審査担当の2段階認証に使います）
5. **Authentication → URL Configuration**：Site URL に本番のURLを設定する
6. 審査担当のアカウントに権限を付ける：`supabase/setup/grant_identity_reviewer.sql`

**service role key は使わなくなりました。** ホスティング先（Vercel 等）と `.env.local` の `SUPABASE_SERVICE_ROLE_KEY` は削除してください。

#### `023_account_deletion_chat_safety_contact.sql`（退会・通報とブロック・お問い合わせ）

App Store / Google Play の審査で求められる機能です。**022 の適用後に、SQL Editor でこのファイルを実行してください**（`reset_and_apply_015-022.sql` には含まれていません）。

| 機能 | 画面 | 内容 |
|---|---|---|
| 退会（アカウント削除） | `/workers/mypage`・`/managers/settings` の下部、`/account/delete` | ログイン情報とプロフィールを消す。働いた勤務・支払いの記録とチャットの履歴は相手側に残し、名前を「退会済みユーザー」に置き換える（利用規約第15条）。返信前のスカウトとこれからの勤務予定は取り消して相手に通知する |
| チャットのブロック | 各チャット画面 | ワーカーと店舗の組み合わせごと。どちらかがブロックすると、メッセージとスカウトを送れず、店舗の人材検索にも出ない |
| チャットの通報 | 各チャット画面 → `/admin/reports` | 会話全体、またはメッセージ単位で運営に通報する。本文はデータベースから写しを取る |
| お問い合わせ | `/contact` → `/admin/inquiries` | ログインなしでも送れる。返信はメールで行う |

- `/account/delete` と `/contact` はログインなしで開けます。ストアの掲載情報に載せる「アカウント削除の案内URL」「サポートURL」に使えます。
- `/admin/reports`・`/admin/inquiries` は、本人確認の審査と同じ審査担当アカウント（2段階認証済み）だけが開けます。
- **退会した人の身分証画像は、自動では消えません。** 本人は自分の身分証画像を読めない作りのため、退会時は「削除待ち」として記録し、審査担当が `/admin/identity-verifications` に出るボタンで削除します。退会があったら、この画面を確認してください。
- 通報を受けたあとの利用停止・アカウント削除は、Supabase Dashboard（Authentication → Users）で行います（アプリ内に利用停止の画面はありません）。
- 検証：`node tests/account-safety-db.mjs`（`auth-rls-db.mjs` と同じく、メモリ上の PostgreSQL で実行。Supabase には接続しません）。

#### `024_profile_photos.sql`（プロフィール写真・店舗写真）

**023 の適用後に、SQL Editor でこのファイルを実行してください。** 未適用でもアプリは動きます（写真の枠には名前の頭文字が出て、写真の登録だけが失敗します）。

- ワーカーは `/workers/mypage`、店舗は `/managers/settings` から写真を登録できます。写真は任意です。
- 保存先は非公開のバケット `profile-photos`。画面には、1時間だけ有効なURL（署名付きURL）で表示します。
- アップロード・削除できるのは本人のフォルダだけ。ワーカーの写真を見られるのは本人・店舗・審査担当、店舗の写真はログインしていれば誰でも見られます。
- 写真は、画面側で長辺800px以内の JPEG に縮めてから送ります（撮影場所などの付帯情報は送られません）。
- 退会すると、写真のファイルと登録は消えます。
- `next.config.ts` で Server Action の受信サイズを 9MB に広げています（既定の1MBでは、身分証の画像（8MBまで）を受け取れないため）。

#### `025_push_tokens.sql`（プッシュ通知の宛先）

スマホアプリのプッシュ通知で、端末の宛先を保存します。024 の後に実行してください。通知を実際に送るには、Firebase・Apple・Supabase の設定が必要です（手順は [docs/mobile-release.md](docs/mobile-release.md)「5. プッシュ通知の設定」）。送信用の Edge Function（`supabase/functions/send-push`）は、Supabase の中だけで service role を使います。

#### `026_privacy_store_change_minor_suspension.sql`（本人専用情報・所属変更・18歳未満の規制・利用停止）

**025 の後に、SQL Editor で1回だけ実行してください。** 実行前にこのコードをデプロイすると、ワーカー・店舗の一覧と検索がエラーになり、ワーカーの登録もできません（逆に、SQL だけ先に流すと、古いコードのワーカー登録が止まります）。**SQL を流した直後にデプロイしてください。**

| 機能 | 内容 |
|---|---|
| 本人専用情報の分離 | 親権者の氏名・同意日時と、規約の同意記録を、`workers`（全店舗が読める）から `worker_private`（本人だけが読める）へ移す。「18歳未満かどうか」（`is_minor`）だけは、深夜勤務の規制を店舗が確認できるよう残す |
| ワーカー登録 | `register_worker` だけで行う（`workers` への直接の挿入は不可）。公開プロフィールと本人専用情報を同時に作る |
| 所属店舗の変更 | `/workers/mypage` の「変更する」。**7日に1回まで**。変えると店長認証は外れ（認証の記録は残る）、旧店舗向けの勤務希望は取り消される。今の所属先で確定しているこれからの勤務があるときは変えられない |
| 18歳未満の夜間規制 | 午後10時から翌午前5時にかかるスカウトと勤務希望を、DBで止める（労働基準法第61条）。画面（スカウト送信・勤務希望）でも先に警告する。ちょうど22:00に終わる・5:00に始まるのは可 |
| 利用停止 | `/admin/reports` の各通報から、通報された側を停止できる。`/admin/suspensions` で一覧と解除。ログインを止め（Supabase Auth の `banned_until`）、今のログイン状態も消す。停止中は一覧・検索に出ず、メッセージもスカウトも届かない |

**運用の注意**

- **`workers` に列を足すと、全店舗に見える。** 店舗に見せたくない列は `worker_private` に入れてください。
- 利用停止は、同じログインのワーカーと店舗の両方を止めます。解除理由は記録に残ります。停止した人がログインしようとすると「現在ご利用いただけません」と出て、`/contact` から連絡できます。
- 利用停止は Supabase の `auth.users` と `auth.sessions` を SQL から更新します。**実際の Supabase では、停止後にそのアカウントでログインできないこと・解除後に入れることを、最初に1度確認してください**（このリポジトリのテストは、メモリ上の PostgreSQL で検証しています）。
- 検証：`node tests/privacy-store-change-db.mjs`、`node --test tests/minor-rule.test.mjs`。

### デザイン（2026-11 の作り直し）

色・ボタン・カードなどの共通の見た目は `app/globals.css` の `.app-*` クラスにまとめています。画面を足すときは、`<div className="app-page">` の先頭に `AppHeader` を置き、`.app-card` / `.app-primary` / `.app-secondary` / `.app-pill` / `.app-tag` を使ってください。色は「青＝押せるもの」「黄＝選択中・未対応」の2つです。

### 4. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。

### 5. 接続確認

トップページ（`/）で以下を確認します。

- **接続OK** バッジが表示される
- 3 テーブルすべてが **参照OK** になる（Phase 2 適用後は 4 テーブル）
- 登録件数が表示される（初期状態は 0 件で正常）

環境変数未設定や SQL 未実行の場合は、画面上のセットアップ手順に従ってください。

## プロジェクト構成（Phase 1 時点）

```
shiflun/
├── app/
│   ├── layout.tsx          # 共通レイアウト
│   ├── page.tsx            # トップ（サービス概要 + 導線）
│   ├── companies/
│   │   └── page.tsx        # 人材一覧
│   ├── workers/
│   │   └── register/
│   │       ├── page.tsx    # ワーカー登録
│   │       └── success/
│   │           └── page.tsx # 登録完了
│   └── globals.css
├── components/
│   ├── layout/AppHeader.tsx
│   ├── ui/FormField.tsx, PrimaryButton.tsx, NavCard.tsx
│   ├── workers/WorkerCard.tsx, VerificationBadge.tsx, WorkerRegisterForm.tsx, SkillTagPicker.tsx
│   └── dev/DevConnectionPanel.tsx
├── lib/
│   ├── actions/workers.ts  # 登録・一覧取得
│   ├── supabase/
│   │   ├── server.ts       # Supabase クライアント
│   │   └── connection-check.ts
│   ├── types/
│   │   └── database.ts     # 型定義
│   └── constants/
│       └── options.ts      # 業態・スキルタグ定数
├── supabase/
│   └── migrations/
│       ├── 001_initial_schema.sql
│       ├── 002_phase2_industry_skills_availability.sql
│       ├── 003_phase3_manager_verification.sql
│       ├── 004_phase4_scout_requests.sql
│       ├── 005_phase5_availability_work_date.sql
│       └── 006_phase5d_shift_status.sql
├── .env.local.example
└── README.md
```

## 実装フェーズ

店舗の時給設定・手数料込み確認、プロフィール編集、店舗側の人材検索、勤務回数、通知、承諾後チャットの導入方法は [docs/matching-chat.md](docs/matching-chat.md) を参照してください。利用には追加migration `014_matching_profiles_chat_notifications.sql` の適用が必要です。

| Phase | 内容 | 状態 |
|-------|------|------|
| 0 | 方針確認 | 完了 |
| 1 | DB・Supabase 接続・ワーカー登録・人材一覧 | 完了 |
| 2 | 飲食業特化・スキルタグ・将来シフト用スキーマ | 完了 |
| 3 | 人材詳細・店長認証 | 完了 |
| 4 | スカウト送信 | 完了 |
| 5 | シフト連動（勤務希望・店長判定・検索） | 進行中（5-D 完了） |
| 6 | デモ用 UI 調整 | 未着手 |
| 8-A | スカウト成立→勤怠連携・出退勤打刻（GPS/QR対応） | 完了 |
| 8-B | 店舗所属の自己申告制＋通報機能 | 完了 |
| 8-C | 提示額計算・プロフィール編集・承諾後チャット・アプリ内通知 | 完了（[docs/matching-chat.md](docs/matching-chat.md)） |
| 9-A | 支払い状況の手動記録（送金は代行しない） | 完了 |
| 9-B | 本人確認（eKYC）の暫定実装（運営による目視審査） | 完了。外部eKYCベンダー連携は未着手 |
| 9-C | 未成年ワーカーの親権者同意UI | 完了 |
| 9-D | モバイルアプリ化（Capacitor） | プロジェクト雛形・アイコン生成まで完了。ストア提出には未着手（[docs/mobile-release.md](docs/mobile-release.md)参照） |
| 9-E | 本人確認バケットの読み取り制限（本番化対応） | 完了（022 でログイン＋RLS に置き換え） |
| 10 | ログイン（Supabase Auth）・全テーブルの RLS・審査担当の2段階認証 | 完了（022） |
| 11 | 退会・チャットの通報とブロック・お問い合わせ（ストア審査対応） | 完了（023）。実際の Supabase 環境での動作確認は未実施 |
| 12 | 全画面のデザイン作り直し・プロフィール写真と店舗写真 | 完了（024）。写真の登録は実際の Supabase 環境では未確認 |
| 13 | アプリ化の機能（権限宣言・アプリ内QR読み取り・オフライン画面・プッシュ通知・審査用ログイン） | コード完了（025）。実機・プッシュ通知の外部設定は未実施 |
| 14 | 親権者情報の非公開化・所属店舗の変更・18歳未満の夜間規制・利用停止 | コード完了（026）。実際の Supabase での利用停止の動作は未確認 |

## モバイルアプリ（iOS / Android）

既存のWebアプリをCapacitorでラップする形でiOS/Androidアプリ化を進めています。セットアップ済みの内容、残っている作業（Apple Developer Program登録・プライバシーポリシー整備等）は [docs/mobile-release.md](docs/mobile-release.md) を参照してください。

## Vercel デプロイ（任意）

1. GitHub にリポジトリを push
2. Vercel でプロジェクトをインポート
3. Environment Variables に `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` を設定
4. Deploy

## セキュリティに関する注意

- **service role key は使用・設定しないでください。** クライアント・サーバーとも anon key と、ログイン中の利用者のログイン情報だけで動きます。データの保護はデータベース側の RLS（migration 022）が行います
- テーブルを追加したら、必ず RLS を有効にしてポリシーを書いてください（022 で anon への既定の権限は外してあります）。`supabase/diagnostics/rls_status.sql` で、RLS が無効なテーブルやポリシーの無いテーブルを確認できます
- アクセス制限のテストは `tests/auth-rls-db.mjs`（メモリ上の PostgreSQL で実行。本物の Supabase には接続しません）
- 店長は人材検索のため、ワーカーのプロフィール（未成年かどうか・親権者の氏名を含む）を読めます。見せる項目を絞る場合は、ビューに分けるなどの対応が必要です
