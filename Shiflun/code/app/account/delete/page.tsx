import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { DeleteAccountSection } from "@/components/account/DeleteAccountSection";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { getAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "退会とデータの削除 | シフルン" };

/**
 * 退会（アカウント削除）の案内。アプリの外からも開けるページ（ストアの掲載情報に載せる URL）。
 * ログイン中ならこの場で退会でき、ログインできない場合はお問い合わせから依頼できる。
 */
export default async function AccountDeletePage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const { done } = await searchParams;
  const { user } = await getAuth();

  if (done && !user) {
    return <div className="app-page">
      <AppHeader title="退会が完了しました" />
      <main className="space-y-4">
        <section role="status" className="app-card space-y-3 text-sm leading-relaxed text-ink-soft">
          <p>アカウントを削除しました。これまでシフルンをご利用いただき、ありがとうございました。</p>
          <p>本人確認で身分証の画像を提出していた場合は、運営が削除します。</p>
        </section>
        <Link href="/" className="app-secondary w-full">トップへ戻る</Link>
      </main>
      <LegalLinks className="mt-8" />
    </div>;
  }

  return <div className="app-page">
    <AppHeader title="退会とデータの削除" description="シフルンのアカウントを削除する方法と、削除されるデータ・残るデータの説明です。" />
    <main className="space-y-5">
      <section className="app-card space-y-3 text-sm leading-relaxed text-ink-soft">
        <h2 className="text-base font-bold text-ink">退会の方法</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>シフルンにログインします。</li>
          <li>ワーカーは「プロフィール」、店舗は「店舗・時給設定」の画面を開きます（このページからも退会できます）。</li>
          <li>画面の下にある「退会する（アカウントを削除）」を開き、内容を確認して「退会する」を押します。</li>
        </ol>
        <p>ログインできない場合は、<Link href="/contact?category=deletion" className="font-semibold underline underline-offset-2">お問い合わせ</Link>から、登録に使ったメールアドレスを添えて退会をご依頼ください。</p>
      </section>

      <section className="app-card space-y-3 text-sm leading-relaxed text-ink-soft">
        <h2 className="text-base font-bold text-ink">削除されるデータ</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>ログイン情報（メールアドレス、パスワード）</li>
          <li>プロフィール（名前、所属店舗、経験、自己紹介、希望エリア、親権者の氏名など）</li>
          <li>勤務希望と、まだ働いていない勤務予定</li>
          <li>本人確認の提出内容（氏名カナ、生年月日、身分証の画像）</li>
          <li>お知らせ、ブロックの設定</li>
        </ul>
        <p className="text-xs text-ink-soft">身分証の画像は、退会の手続き後に運営の担当者が削除します。</p>
      </section>

      <section className="app-card space-y-3 text-sm leading-relaxed text-ink-soft">
        <h2 className="text-base font-bold text-ink">退会後も残るデータ</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>働いた勤務の記録（勤務日時、出退勤の記録）と、支払いの記録</li>
          <li>チャットの履歴</li>
          <li>運営への通報・お問い合わせの記録</li>
        </ul>
        <p>これらは、勤務先の店舗が勤務・賃金の記録を保存する必要があるため、またトラブルの確認のために残します。名前は「退会済みユーザー」に置き換えられ、退会した本人のプロフィールとは結びつかなくなります。</p>
        <p>店舗が退会した場合、店舗名は、ワーカー側に残る勤務・支払いの記録のために残ります。</p>
      </section>

      {user
        ? <DeleteAccountSection />
        : <div className="space-y-2">
          <Link href="/login?next=/account/delete" className="app-primary w-full">ワーカーとしてログインして退会する</Link>
          <Link href="/managers/login?next=/account/delete" className="app-secondary w-full">店舗としてログインして退会する</Link>
        </div>}
    </main>
    <LegalLinks className="mt-8" />
  </div>;
}
