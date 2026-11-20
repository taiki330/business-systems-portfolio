"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSession } from "@/components/auth/SessionProvider";
import { registerPushToken } from "@/lib/actions/push";
import { isNativeApp, nativePlatform } from "@/lib/native";

/** この端末の通知の宛先。ログアウトのときに登録を外すため、端末に覚えておく。 */
export const PUSH_TOKEN_KEY = "shiflun_push_token";

/** 通知を押したときに開く画面。送信側（supabase/functions/send-push）が data.link に入れる。 */
function safeLink(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : null;
}

/**
 * アプリでログインしたら、プッシュ通知の許可を求めて端末を登録する。ブラウザでは何もしない。
 * 許可されなかった場合も、アプリ内のお知らせ（ベルのマーク）は今までどおり使える。
 */
export function PushRegistration() {
  const router = useRouter();
  const { me } = useSession();
  const signedIn = Boolean(me?.signedIn && (me.worker || me.store));
  const userKey = me?.email ?? null;
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; }, [router]);

  useEffect(() => {
    if (!signedIn || !isNativeApp()) return;
    const platform = nativePlatform();
    if (platform === "web") return;
    let cancelled = false;
    const handles: { remove: () => Promise<void> }[] = [];

    (async () => {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      handles.push(await PushNotifications.addListener("registration", async ({ value }) => {
        if (cancelled) return;
        const { error } = await registerPushToken(value, platform);
        if (!error) { try { localStorage.setItem(PUSH_TOKEN_KEY, value); } catch {} }
      }));
      handles.push(await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
        const link = safeLink(notification.data?.link);
        if (link) routerRef.current.push(link);
      }));
      let permission = await PushNotifications.checkPermissions();
      if (permission.receive === "prompt" || permission.receive === "prompt-with-rationale") permission = await PushNotifications.requestPermissions();
      if (cancelled || permission.receive !== "granted") return;
      if (platform === "android") {
        // Android 8 以降は通知のチャンネルが必要。
        await PushNotifications.createChannel({ id: "default", name: "スカウトとメッセージ", importance: 4, visibility: 0 }).catch(() => undefined);
      }
      await PushNotifications.register();
    })().catch(() => undefined);

    return () => { cancelled = true; handles.forEach((handle) => void handle.remove()); };
  }, [signedIn, userKey]);

  return null;
}
