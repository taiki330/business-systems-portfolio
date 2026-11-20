import type { CapacitorConfig } from "@capacitor/cli";

// Shiflun は Next.js のサーバー機能（Server Components / Server Actions）に強く依存しているため、
// 静的書き出し（next export）ではなく、デプロイ済みのサイトをネイティブの WebView で
// そのまま開く「server.url」方式を採用する。オフライン動作はしない前提。
//
// CAPACITOR_SERVER_URL が未設定の場合は開発用にローカルの Next.js dev サーバーを指す。
// 本番ビルド（ストア提出用）の前に、必ず本番ドメインの https URL を設定すること。
// 設定を変えたら `npm run cap:sync` で反映する（オフライン画面にも同じURLが入る）。
const serverUrl = process.env.CAPACITOR_SERVER_URL || "http://localhost:3000";
const isLocalHttp = serverUrl.startsWith("http://");

const config: CapacitorConfig = {
  // TODO: 正式なドメイン・法人名が決まり次第、逆ドメイン形式の正式な appId に変更する。
  // 一度ストアに公開すると iOS 側は appId（Bundle ID）を事実上変更できないため、
  // 本番ビルドの前に必ず確定させること。
  appId: "com.shiflun.app",
  appName: "Shiflun",
  webDir: "public",
  server: {
    url: serverUrl,
    // ローカル開発時（http）のみ平文通信を許可。本番（https）では false のままにする。
    cleartext: isLocalHttp,
    // 接続先を読み込めなかったとき（圏外など）に出す、端末内のページ（public/offline.html）。
    errorPath: "offline.html",
  },
  plugins: {
    // アプリを開いている間に届いたプッシュ通知も、画面上部に表示する（iOS）。
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
