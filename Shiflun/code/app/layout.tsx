import type { Metadata, Viewport } from "next";
import { Zen_Kaku_Gothic_New } from "next/font/google";
import { BottomNav } from "@/components/layout/BottomNav";
import { PageTransition } from "@/components/layout/PageTransition";
import { ConsentRecheck } from "@/components/legal/ConsentRecheck";
import { SessionProvider } from "@/components/auth/SessionProvider";
import { OfflineNotice } from "@/components/native/OfflineNotice";
import { PushRegistration } from "@/components/native/PushRegistration";
import "./globals.css";

const zenKaku = Zen_Kaku_Gothic_New({
  variable: "--font-brand-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
});

export const metadata: Metadata = {
  title: "シフルン | 現役バイト認証付きスカウト",
  description:
    "飲食業界向けマッチングサービス — 現役バイトの勤務実績と店長認証を可視化し、店舗がスカウトできるサービス",
};

// スマホアプリでは画面の端（ノッチ・ホームバー）まで使い、余白は safe-area で取る。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${zenKaku.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-paper pt-[env(safe-area-inset-top)] text-ink">
        {/* ステータスバー（時計・電池の表示）の裏を白く塗る。ブラウザでは高さ0。 */}
        <div aria-hidden="true" className="fixed inset-x-0 top-0 z-[70] h-[env(safe-area-inset-top)] bg-white" />
        <SessionProvider>
          <OfflineNotice />
          <PushRegistration />
          <div className="flex flex-1 flex-col pb-20">
            <PageTransition>{children}</PageTransition>
          </div>
          <BottomNav />
          <ConsentRecheck />
        </SessionProvider>
      </body>
    </html>
  );
}
