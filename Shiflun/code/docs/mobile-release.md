# iOS / Android リリース準備（Capacitor）

Shiflun は Next.js の Server Components / Server Actions に強く依存しているため、既存のWebアプリをフルネイティブに書き直す代わりに、**Capacitor でデプロイ済みのサイトをネイティブのWebViewとして開く**方式でiOS/Androidアプリ化しています。オフライン動作はしません（常にネットワーク接続が必要）。

## ここまでで準備できたもの

- `capacitor.config.ts` — アプリ設定（appId・appName・接続先URL）
- `android/` — Android Studio で開けるネイティブプロジェクト一式
- `ios/` — Xcode で開けるネイティブプロジェクト一式
- `resources/icon.png` / `resources/splash.png` — アプリアイコン・スプラッシュ画面の元画像（**プレースホルダー**。`public/logo-icon.png` を正方形キャンバスに配置しただけなので、申請前に正式デザインへ差し替えが必要）
- 上記からアイコン・スプラッシュ画像一式を各プラットフォーム向けに自動生成済み（`npm run cap:assets` で再生成可能）
- `icons/` — 同じ元画像から生成したPWA用アイコン（Web版でのホーム画面追加等に利用可能。App Store/Google Play提出には直接関係しない）

ここから先は、私（Claude）の環境（Windowsサンドボックス）では実行できない作業です。特にiOSはMac + Xcodeが必須になります。

## 残りの作業チェックリスト

### 1. 事業まわり（すでに進行中のものを含む）
- [ ] 法人設立（[前回までのやり取り参照](../利用規約（ワーカー・店舗共通）V4ドラフト.md)）
- [ ] **プライバシーポリシーの作成・公開**：App Store・Google Playとも、審査申請時に**公開URLでアクセスできるプライバシーポリシー**が必須です。現状これは未整備です（[docs/legal/04_questions-lawyer.md](legal/04_questions-lawyer.md)「5. 個人情報」参照）。ストア申請の**ハードブロッカー**なので、法人設立と並行して早めに着手することを推奨します
- [ ] 本番ドメインの決定（`capacitor.config.ts` の `CAPACITOR_SERVER_URL` に設定する本番URL）
- [ ] `capacitor.config.ts` の `appId`（`com.shiflun.app` は仮置き）を正式なものに確定。**iOS側は公開後の変更が事実上できない**ので、ストア提出前に必ず確定させること

### 2. Apple Developer Program（iOS）
- [ ] Apple ID作成 → Apple Developer Programへ法人として登録（年会費 $99、D-U-N-S番号が必要。取得に数日〜数週間かかることがあるので早めに申請）
- [ ] Macを用意し、Xcodeをインストール
- [ ] `npm run cap:open:ios` で `ios/App/App.xcworkspace` を開き、署名設定（Team・Bundle ID）を行う
- [ ] TestFlightで実機テスト → App Store Connect でストア掲載情報（スクリーンショット、説明文、プライバシーポリシーURL等）を入力して審査提出

### 3. Google Play Console（Android）
- [ ] Google Playデベロッパーアカウント登録（登録料 $25、一度きり）
- [ ] 署名用キーストアを作成（`android/` 配下でのリリースビルド設定）
- [ ] `npm run cap:open:android` で Android Studio を開き、リリースAAB（App Bundle）をビルド
- [ ] Play Console でストア掲載情報を入力し、内部テスト→段階的公開の順でリリース

### 4. Apple審査対策（重要）

Appleは「WebViewでサイトを表示しているだけのアプリ」をGuideline 4.2（Minimum Functionality）でリジェクトすることがあります。単なるラッパーと判断されないよう、ネイティブ機能を最低限組み込むことを推奨します。

- **GPS勤怠打刻（実装済み）**: アプリでは `@capacitor/geolocation` で位置を取ります（端末標準の許可ダイアログ）。ブラウザでは従来どおり Geolocation API。`lib/hooks/use-geolocation.ts`。
- **アプリ内のQR読み取り（実装済み）**: 今日のシフトのカードに「店舗のQRコードで打刻する」が出ます（アプリの中だけ）。`@capacitor/barcode-scanner` でカメラを起動し、読み取った `/checkin?...` をアプリの中で開きます。`components/native/QrCheckinButton.tsx`。
- **プッシュ通知（コードは実装済み・外部の設定待ち）**: 下の「5. プッシュ通知の設定」を参照。
- **オフライン画面（実装済み）**: 起動時に接続できないときは、端末内の `offline.html` を表示します（`capacitor.config.ts` の `server.errorPath`）。使っている途中で通信が切れたときは、画面上部に帯を出します。

### 5. プッシュ通知の設定

アプリ側のコード（通知の許可・端末の登録・通知を押したときの画面移動）と、送信する仕組み（Supabase Edge Function `send-push`）は実装済みです。動かすには、次の外部の設定が必要です。

1. **DB**：`supabase/migrations/025_push_tokens.sql` を SQL Editor で実行する（024 の後）。
2. **Android（Firebase）**
   - [Firebase コンソール](https://console.firebase.google.com/)でプロジェクトを作り、Android アプリ（パッケージ名 = `appId`）を追加する。
   - ダウンロードした `google-services.json` を `android/app/` に置く（`android/app/build.gradle` が自動で読み込む）。
   - プロジェクトの設定 → サービスアカウント → 「新しい秘密鍵を生成」で JSON を取得する（下の `FCM_SERVICE_ACCOUNT` に使う。**リポジトリには入れない**）。
3. **iOS（Apple）**
   - Xcode で `ios/App/App.xcodeproj` を開き、Signing & Capabilities → 「+ Capability」→ **Push Notifications** を追加する。
   - Apple Developer → Keys で「Apple Push Notifications service (APNs)」の鍵（.p8）を作る。Key ID と Team ID を控える。
4. **送信用の関数を Supabase に置く**（Supabase CLI が必要）
   ```bash
   supabase functions deploy send-push --no-verify-jwt --project-ref <プロジェクトID>
   supabase secrets set --project-ref <プロジェクトID>      SHIFLUN_WEBHOOK_SECRET=<推測されにくい長い文字列>      FCM_SERVICE_ACCOUNT="$(cat service-account.json)"      APNS_KEY_P8="$(cat AuthKey_XXXX.p8)" APNS_KEY_ID=<Key ID> APNS_TEAM_ID=<Team ID>      APNS_BUNDLE_ID=<appId> APNS_PRODUCTION=false
   ```
   `APNS_PRODUCTION` は、Xcode から直接入れたアプリでは `false`、TestFlight・App Store 版では `true`。どちらか片方の鍵しか無ければ、その OS だけに送ります。
5. **通知が作られたら関数を呼ぶ**：Supabase Dashboard → Database → Webhooks → Create a new hook
   - Table: `app_notifications`、Events: **Insert** だけ
   - Type: Supabase Edge Functions → `send-push`
   - HTTP Headers に `x-shiflun-webhook-secret` = 上の `SHIFLUN_WEBHOOK_SECRET` と同じ値
6. 実機でログインし、通知を許可して、別アカウントからスカウトやメッセージを送って届くか確認する。

※ 通知の本文には、メッセージの先頭（100文字まで）が入ります。ロック画面にも表示されます。

### 6. ストア審査用のアカウント

審査担当はメールの確認コードを受け取れないので、パスワードで入れるアカウントを用意します。

1. Supabase Dashboard → Authentication → Users → Add user で、**ワーカー用**と**店舗用**の2つを作る（メールアドレスとパスワードを入れ、「Auto Confirm User」をオン）。
2. 店舗用：`/managers/login` でログインし、店舗を登録する。
3. ワーカー用：`/login` の下にある「パスワードでログイン」から入り、2 の店舗を所属先にしてプロフィールを登録する。
4. 店舗用からワーカー用へスカウトを送り、承諾してチャットまで進めておくと、審査担当が全機能を確認しやすい。
5. 2つのログイン情報を、App Store Connect の「App Review に関する情報」と Play Console の「アプリのアクセス権」に書く。

### 7. 公開前に必ず設定する環境変数

- `CAPACITOR_SERVER_URL`：本番の https URL。設定してから `npm run cap:sync`（オフライン画面にも同じURLが入る）。
- `CHECKIN_QR_SECRET`（ホスティング先）：出勤用QRコードの署名の鍵。**未設定だと、コードに書かれた仮の鍵が使われ、誰でもQRコードを偽造できる。** 推測されにくい長い文字列を設定すること。

### まだ無いもの

- **カメラで読んだQRコードやリンクからアプリを直接開く仕組み**（iOS の Universal Links / Android の App Links）。本番ドメインと Apple の Team ID が決まってから設定する。それまでは、端末の標準カメラでQRコードを読むとブラウザが開くので、アプリ内の「店舗のQRコードで打刻する」を使ってもらう。

## 開発時の動作確認

```bash
# 1. Next.js を起動
npm run dev

# 2. capacitor.config.ts の server.url を開発機のローカルIP（例: http://192.168.x.x:3000）に変更
#    ※ Android実機・エミュレータからは localhost ではなくローカルIPでアクセスする必要がある

# 3. ネイティブプロジェクトに設定を反映（オフライン画面も作られる）
npm run cap:sync

# 4. Android Studio / Xcode で開いて実機・エミュレータで起動
npm run cap:open:android
npm run cap:open:ios   # Macのみ
```

本番ビルドの前には、必ず `capacitor.config.ts` の `server.url` を本番の https ドメインに戻すこと。
