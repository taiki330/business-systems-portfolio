"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Store } from "@/lib/types/database";
import { saveStoreSettings, StoreSettingsState } from "@/lib/actions/stores";
import { useStoreId } from "@/lib/hooks/use-stored-id";
import { useCurrentStore } from "@/lib/hooks/use-current-store";
import { ConsentFields, ConsentGate } from "@/components/legal/ConsentGate";
import { PhotoUploader } from "@/components/ui/PhotoUploader";

export function StoreSettingsForm() {
  const { store, ready } = useCurrentStore();
  if (!ready) return <p className="text-sm text-ink-soft">読み込み中…</p>;
  if (store) return <StoreEditor key={store.id} store={store} />;
  // 新規登録のときだけ、同意ページでの同意を先に求める。
  return <ConsentGate role="store"><StoreEditor key="new" /></ConsentGate>;
}

function StoreEditor({ store }: { store?: Store }) {
  const { refreshStore } = useStoreId();
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: StoreSettingsState, form: FormData) => {
    const result = await saveStoreSettings(prev, form);
    if (result.storeId) {
      await refreshStore();
      router.refresh();
    }
    return result;
  }, {});
  return <div className="space-y-4">
    {store && <section className="app-card"><PhotoUploader role="store" name={store.name} url={store.photo_url ?? null} onChange={refreshStore} /></section>}
    <form action={action} className="app-card space-y-5">
    <div><h2 className="text-xl font-bold text-ink">{store ? store.name : "お店のことを教えてください"}</h2><p className="mt-2 text-sm leading-relaxed text-ink-soft">ここで設定した時給で、ワーカーに勤務のスカウトを送ります。</p></div>
    <input type="hidden" name="store_id" value={store?.id ?? state.storeId ?? ""} />
    {!store && <>
      <div><label className="app-label" htmlFor="company_name">企業名・事業者名</label><input id="company_name" name="company_name" required maxLength={100} className="app-input" /></div>
      <div><label className="app-label" htmlFor="store_name">店舗名</label><input id="store_name" name="name" required maxLength={100} className="app-input" /></div>
    </>}
    <div><label className="app-label" htmlFor="area">勤務地（市区町村・最寄り駅など）</label><input id="area" name="area" required maxLength={100} defaultValue={store?.area ?? ""} placeholder="例：大阪市北区・梅田駅" className="app-input" /></div>
    <div><label className="app-label" htmlFor="hourly_wage">この店舗の時給（円）</label><input id="hourly_wage" name="hourly_wage" type="number" inputMode="numeric" min={1} max={999999} step={1} required defaultValue={store?.hourly_wage ?? ""} placeholder="例：1200" className="app-input" /><p className="mt-2 text-xs leading-relaxed text-ink-soft">変更は次に送るスカウトから反映します。送信済みの提示額は変わりません。</p></div>
    {!store && <ConsentFields />}
    {state.error && <p role="alert" className="app-error">{state.error}</p>}
    {state.success && <p role="status" className="app-success">店舗の設定を保存しました。</p>}
    <button className="app-primary w-full" disabled={pending}>{pending ? "保存中…" : "この内容で保存"}</button>
    </form>
  </div>;
}
