import Link from "next/link";
import { ParticipantRole } from "@/lib/types/database";

/** プロフィール（ワーカー）・店舗の登録がまだのときに出す案内。 */
export function AccountRequired({ role }: { role: ParticipantRole }) {
  return (
    <section className="app-card py-8 text-center">
      <h2 className="app-section-title">{role === "store" ? "まず店舗を登録しましょう" : "まずプロフィールを登録しましょう"}</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{role === "store" ? "店舗を登録すると、人材探しやスカウトが使えます。" : "登録すると、勤務希望の提出やスカウトの受け取りができます。"}</p>
      <Link className="app-primary mt-5 w-full" href={role === "store" ? "/managers/settings" : "/workers/join-store"}>{role === "store" ? "店舗を登録する" : "プロフィールを登録する"}</Link>
    </section>
  );
}
