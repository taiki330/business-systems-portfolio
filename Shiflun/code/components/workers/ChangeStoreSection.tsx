"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/components/auth/SessionProvider";
import { changeMyStore } from "@/lib/actions/store-change";
import { getStores } from "@/lib/actions/stores";
import { Store } from "@/lib/types/database";

const COOLDOWN_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

function label(store: Store): string {
  const company = store.companies?.name;
  return company ? `${company} ${store.name}` : store.name;
}

/** 変えられるようになるまでの日数。いつでも変えられるなら 0。 */
function daysUntilChange(changedAt: string | null | undefined): number {
  if (!changedAt) return 0;
  const left = new Date(changedAt).getTime() + COOLDOWN_DAYS * DAY - Date.now();
  return left > 0 ? Math.ceil(left / DAY) : 0;
}

/** プロフィールの「所属店舗」。今の所属先を見せ、変えるときは登録済みの店舗から選び直す。 */
export function ChangeStoreSection({ currentStore, currentStoreId, changedAt }: { currentStore: string; currentStoreId?: string | null; changedAt?: string | null }) {
  const router = useRouter();
  const { refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [stores, setStores] = useState<Store[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Store | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const wait = daysUntilChange(changedAt);

  useEffect(() => {
    if (!open || stores) return;
    let active = true;
    getStores().then((result) => { if (!active) return; if (result.error) setLoadError(result.error); else setStores(result.stores); })
      .catch(() => { if (active) setLoadError("店舗の一覧を読み込めませんでした。"); });
    return () => { active = false; };
  }, [open, stores]);

  const candidates = (stores ?? []).filter((s) => s.id !== currentStoreId && (!query.trim() || label(s).includes(query.trim())));

  async function submit() {
    if (!selected) return;
    setPending(true); setError(null);
    const result = await changeMyStore(selected.id);
    setPending(false);
    if (result.error) { setError(result.error); return; }
    setDone(label(selected));
    setOpen(false); setSelected(null); setAgreed(false);
    await refresh();
    router.refresh();
  }

  return <div>
    <p className="app-label">所属店舗（自己申告）</p>
    <div className="flex items-center gap-3 rounded-lg bg-chip p-3">
      <p className="min-w-0 flex-1 text-sm text-ink [overflow-wrap:anywhere]">{currentStore}</p>
      {!open && <button type="button" onClick={() => { setOpen(true); setDone(null); }} disabled={wait > 0} className="min-h-11 shrink-0 text-sm font-bold text-brand-blue underline underline-offset-2 disabled:text-ink-soft disabled:no-underline">変更する</button>}
    </div>
    {wait > 0 && !open && <p className="mt-2 text-xs leading-relaxed text-ink-soft">所属店舗の変更は7日に1回までです。あと{wait}日後に変更できます。</p>}
    {done && <p role="status" className="app-success mt-2">所属店舗を「{done}」に変更しました。</p>}

    {open && <div className="app-card mt-3 space-y-4">
      <h3 className="app-section-title">新しい所属店舗を選ぶ</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink">
        <li>店長認証は外れます。新しい店舗の店長に認証してもらってください。</li>
        <li>今の店舗に出していた勤務希望は取り消されます。</li>
        <li>今の店舗で確定しているこれからの勤務があるときは、変更できません。</li>
        <li>変更は7日に1回までです。</li>
      </ul>
      <div>
        <label htmlFor="change_store_query" className="app-label">店舗名で探す</label>
        <input id="change_store_query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="店舗名や企業名" className="app-input" autoComplete="off" />
      </div>
      {loadError && <p role="alert" className="app-error">{loadError}</p>}
      {!stores && !loadError && <p className="text-sm text-ink-soft">店舗を読み込み中…</p>}
      {stores && <ul role="listbox" aria-label="店舗の候補" className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {candidates.length === 0 && <li className="px-4 py-3 text-sm text-ink-soft">当てはまる店舗がありません。</li>}
        {candidates.map((s) => <li key={s.id}>
          <button type="button" role="option" aria-selected={selected?.id === s.id} onClick={() => setSelected(s)}
            className={`flex min-h-12 w-full items-center px-4 py-2 text-left text-sm text-ink ${selected?.id === s.id ? "bg-brand-yellow font-bold" : "hover:bg-paper"}`}>{label(s)}</button>
        </li>)}
      </ul>}
      {selected && <label className="flex items-start gap-2 text-sm text-ink"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 size-4 accent-brand-blue" /><span>「{label(selected)}」に変更します。上の内容を確認しました。</span></label>}
      {error && <p role="alert" className="app-error">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={() => { setOpen(false); setSelected(null); setAgreed(false); setError(null); }} className="app-secondary flex-1">やめる</button>
        <button type="button" disabled={pending || !selected || !agreed} onClick={() => void submit()} className="app-primary flex-[2]">{pending ? "変更中…" : "この店舗に変更する"}</button>
      </div>
    </div>}
  </div>;
}
