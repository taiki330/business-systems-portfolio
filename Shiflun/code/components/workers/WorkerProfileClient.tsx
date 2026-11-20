"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Worker } from "@/lib/types/database";
import { useSession } from "@/components/auth/SessionProvider";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { useCurrentWorker } from "@/lib/hooks/use-current-worker";
import { saveWorkerProfile, ProfileState } from "@/lib/actions/profile";
import { BUSINESS_TYPES, SKILL_TAGS } from "@/lib/constants/options";
import { WorkerSetupPrompt } from "@/components/workers/WorkerSetupPrompt";
import { LoadingMascot } from "@/components/ui/LoadingMascot";
import { Photo } from "@/components/ui/Photo";
import { PhotoUploader } from "@/components/ui/PhotoUploader";
import { ChangeStoreSection } from "@/components/workers/ChangeStoreSection";

export function WorkerProfileClient() {
  const { worker, ready } = useCurrentWorker();
  if (!ready) return <LoadingMascot label="プロフィールを読み込み中…" />;
  if (!worker) return <WorkerSetupPrompt />;
  return <div className="space-y-4">
    <section className="app-card flex items-center gap-4">
      <Photo src={worker.photo_url} name={worker.name} className="size-20" />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-xl font-bold text-ink">{worker.name}</h2>
        <p className="mt-0.5 truncate text-sm text-ink-soft">{worker.current_store}</p>
      </div>
      <div className="shrink-0 border-l border-line pl-4 text-right">
        <p className="text-xs text-ink-soft">働いた回数</p>
        <p className="text-3xl font-black leading-tight tabular-nums text-ink">{worker.completed_scout_count ?? "—"}<span className="ml-0.5 text-sm font-bold">回</span></p>
      </div>
    </section>
    <p className="px-1 text-xs leading-relaxed text-ink-soft">働いた回数は、スカウト経由で出勤記録がある勤務の数です。同じ勤務は1回と数えます。</p>
    <ProfileEditor key={worker.id} worker={worker} />
    <SignOutButton className="pt-2 text-center" />
  </div>;
}

function ProfileEditor({ worker }: { worker: Worker }) {
  const router = useRouter();
  const { refresh } = useSession();
  const [state, action, pending] = useActionState(async (prev: ProfileState, form: FormData) => {
    const result = await saveWorkerProfile(prev, form);
    if (result.success) { await refresh(); router.refresh(); }
    return result;
  }, {});
  return <section className="app-card space-y-5">
    <h2 className="app-section-title">プロフィールを編集</h2>
    <PhotoUploader role="worker" name={worker.name} url={worker.photo_url ?? null} onChange={refresh} />
    <div className="border-t border-line pt-5"><ChangeStoreSection currentStore={worker.current_store} currentStoreId={worker.current_store_id} changedAt={worker.store_changed_at} /></div>
    <form action={action} className="space-y-5 border-t border-line pt-5">
      <div><label htmlFor="profile_name" className="app-label">名前</label><input id="profile_name" name="name" required maxLength={100} defaultValue={worker.name} className="app-input" /></div>
      <div><label htmlFor="profile_business" className="app-label">経験のある業態</label><select id="profile_business" name="business_type" defaultValue={worker.business_type} className="app-input">{BUSINESS_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
      <fieldset><legend className="app-label">できるポジション</legend><div className="flex flex-wrap gap-2">{SKILL_TAGS.map((tag) => <label key={tag} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink has-checked:border-brand-yellow has-checked:bg-brand-yellow has-checked:font-bold"><input type="checkbox" name="skill_tags" value={tag} defaultChecked={worker.skill_tags.includes(tag)} className="size-4 accent-brand-blue" />{tag}</label>)}</div></fieldset>
      <div><label htmlFor="profile_experience" className="app-label">経験年数</label><input id="profile_experience" type="number" name="experience_years" min={0} max={99.9} step={0.1} required defaultValue={worker.experience_years} className="app-input" /></div>
      <div><label htmlFor="profile_areas" className="app-label">働きたいエリア</label><textarea id="profile_areas" name="preferred_areas" rows={2} defaultValue={(worker.preferred_areas ?? []).join("、")} placeholder="例：大阪市北区、梅田、難波" className="app-input" /><p className="mt-2 text-xs text-ink-soft">市区町村や最寄り駅を「、」で区切って10件まで。店舗が人材を探すときの条件になります。</p></div>
      <div><label htmlFor="profile_skills" className="app-label">スキルの補足</label><textarea id="profile_skills" name="skills" maxLength={500} rows={2} defaultValue={worker.skills ?? ""} className="app-input" placeholder="例：ラテアート、英語での接客" /></div>
      <div><label htmlFor="profile_bio" className="app-label">自己紹介</label><textarea id="profile_bio" name="bio" maxLength={1000} rows={4} defaultValue={worker.bio ?? ""} className="app-input" placeholder="得意なことや、働くときに大切にしていること" /></div>
      <p className="app-notice">勤務の時給と提示額は、お店から届くスカウトで確認できます。</p>
      {state.error && <p role="alert" className="app-error">{state.error}</p>}
      {state.success && <p role="status" className="app-success">プロフィールを更新しました。</p>}
      <button disabled={pending} className="app-primary w-full">{pending ? "保存中…" : "プロフィールを保存"}</button>
    </form>
  </section>;
}
