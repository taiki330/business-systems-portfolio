import { Capacitor } from "@capacitor/core";

/**
 * スマホのアプリ（Capacitor）の中で開いているか。ブラウザで開いているときは false。
 * アプリは本番サイトをそのまま読み込む方式なので、同じ画面がブラウザでもアプリでも動く。
 * ネイティブ機能（QR読み取り・プッシュ通知など）は、これが true のときだけ使う。
 */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** "ios" / "android" / "web"。 */
export function nativePlatform(): "ios" | "android" | "web" {
  if (!isNativeApp()) return "web";
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android" ? platform : "web";
}
