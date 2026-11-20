"use client";

import Link from "next/link";
import { useActionState } from "react";
import { deleteAccount, DeleteAccountState } from "@/lib/actions/account";

/** 退会（アカウント削除）。ふだんは閉じておき、開くと注意書きと確認のチェックが出る。 */
export function DeleteAccountSection({ className = "" }: { className?: string }) {
  const [state, action, pending] = useActionState(deleteAccount, {} as DeleteAccountState);
  return <details className={`rounded-xl border border-line bg-white p-4 ${className}`}>
    <summary className="cursor-pointer text-sm font-semibold text-ink-soft">退会する（アカウントを削除）</summary>
    <form action={action} className="mt-4 space-y-4">
      <div className="space-y-2 text-sm leading-relaxed text-ink-soft">
        <p>退会すると、このアカウントではログインできなくなります。元に戻すことはできません。</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>消えるもの：ログイン情報、プロフィール、勤務希望、まだ働いていない勤務予定、本人確認の提出内容</li>
          <li>残るもの：働いた勤務の記録と支払いの記録、チャットの履歴（相手には「退会済みユーザー」と表示されます）</li>
          <li>返信していないスカウトと、これからの勤務予定は取り消され、相手に通知されます</li>
          <li>ワーカーと店舗の両方を登録している場合は、両方とも退会になります</li>
          <li>店舗の場合、未払いの支払いは退会後も支払う必要があります</li>
        </ul>
        <p className="text-xs text-ink-soft">本人確認で提出した身分証の画像は、退会後に運営が削除します。詳しくは<Link href="/account/delete" className="underline underline-offset-2">退会とデータの削除について</Link>をご覧ください。</p>
      </div>
      <label className="flex items-start gap-2 text-sm text-ink"><input type="checkbox" name="confirm" required className="mt-1 size-4" /><span>上の内容を確認しました。退会します。</span></label>
      {state.error && <p role="alert" className="app-error">{state.error}</p>}
      <button disabled={pending} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-rose-300 bg-white px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">{pending ? "退会の処理中…" : "退会する"}</button>
    </form>
  </details>;
}
