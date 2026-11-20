"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { submitJoinRequest } from "@/lib/actions/store-requests";
import { BUSINESS_TYPES, SKILL_TAGS } from "@/lib/constants/options";
import { useWorkerId } from "@/lib/hooks/use-worker-id";
import { Store } from "@/lib/types/database";
import { ConsentFields, ConsentGate } from "@/components/legal/ConsentGate";

const initialState = { error: undefined, success: false };

function storeLabel(store: Store): string {
  const company = store.companies?.name;
  return company ? `${company} ${store.name}` : store.name;
}

export function JoinStoreForm({ stores }: { stores: Store[] }) {
  const [state, action, pending] = useActionState(submitJoinRequest, initialState);
  const [query, setQuery] = useState("");
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [ageBracket, setAgeBracket] = useState<"" | "adult" | "minor">("");
  const { refreshWorker } = useWorkerId();
  const router = useRouter();

  const filtered = query.trim()
    ? stores.filter((s) => storeLabel(s).includes(query.trim()))
    : stores;

  if (state.success) {
    return (
      <div className="rounded-xl border border-brand-blue-light bg-brand-blue-light p-6 text-center">
        <p className="text-2xl">✓</p>
        <p className="mt-2 text-base font-bold text-ink">登録しました</p>
        <p className="mt-1 text-sm text-ink-soft">
          すぐにシフト希望を提出できます。店舗にはあなたが所属したことが共有されます。
        </p>
        {state.warning && <p role="alert" className="mt-3 text-sm text-brand-yellow-dark">{state.warning}</p>}
        <button
          type="button"
          onClick={async () => {
            await refreshWorker();
            router.push("/workers/shifts");
          }}
          className="app-primary mt-4 px-5"
        >
          シフト希望を入力する
        </button>
      </div>
    );
  }

  if (stores.length === 0) {
    return (
      <div className="app-card text-center">
        <p className="text-sm leading-relaxed text-ink-soft">
          まだShiflunに登録された店舗がありません。働いているお店の店長に、店舗の方の登録（
          <span className="font-semibold text-ink">/managers/settings</span>
          ）をお願いしてください。店舗の登録が済むと、ここから選べるようになります。
        </p>
      </div>
    );
  }

  return (
    <ConsentGate role="worker">
    <form action={action} className="flex flex-col gap-5">
      {state.error && (
        <p role="alert" className="app-error">
          {state.error}
        </p>
      )}

      {/* 店舗検索（登録済みの店舗からのみ選択・自由入力はできない） */}
      <div>
        {selectedStore ? (
          <p className="app-label">働いているお店</p>
        ) : (
          <label htmlFor="store_search" className="app-label">働いているお店</label>
        )}

        {selectedStore ? (
          <div className="flex items-center justify-between rounded-lg border border-brand-blue bg-brand-blue-light px-4 py-3">
            <span className="text-sm font-semibold text-ink">{storeLabel(selectedStore)}</span>
            <button
              type="button"
              onClick={() => { setSelectedStore(null); setQuery(""); }}
              className="text-xs font-semibold text-brand-blue hover:underline"
            >
              変更
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              id="store_search"
              type="text"
              required
              placeholder="例：渋谷店"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
              onFocus={() => setShowResults(true)}
              onBlur={() => setTimeout(() => setShowResults(false), 150)}
              className="app-input"
            />
            {showResults && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line bg-white">
                {filtered.length === 0 ? (
                  <li className="px-4 py-3 text-sm text-ink-soft">
                    見つかりませんでした。店舗名の表記をお店の方に確認してみてください。
                  </li>
                ) : (
                  filtered.map((store) => (
                    <li key={store.id}>
                      <button
                        type="button"
                        onClick={() => { setSelectedStore(store); setQuery(storeLabel(store)); setShowResults(false); }}
                        className="w-full px-4 py-3 text-left text-sm font-medium text-ink-soft hover:bg-brand-blue-light hover:text-brand-blue"
                      >
                        {storeLabel(store)}
                        {store.area && <span className="ml-2 text-xs text-ink-soft">{store.area}</span>}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        )}
        <input type="hidden" name="store_id" value={selectedStore?.id ?? ""} />
        <p className="mt-2 text-xs text-ink-soft">
          候補にない場合は、店舗の方に先にShiflunへの店舗登録をお願いしてください。
        </p>
      </div>

      <div>
        <label htmlFor="business_type" className="app-label">働いているお店の業態</label>
        <select
          id="business_type"
          name="business_type"
          required
          defaultValue=""
          className="app-input bg-white"
        >
          <option value="" disabled>業態を選択してください</option>
          {BUSINESS_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      </div>

      {/* 名前 */}
      <div>
        <label className="app-label" htmlFor="worker_name">
          あなたの名前
        </label>
        <input
          id="worker_name"
          name="worker_name"
          type="text"
          required
          placeholder="例：山田 太郎"
          className="app-input"
        />
      </div>

      {/* ポジション */}
      <div>
        <p className="app-label">ポジション（複数可）</p>
        <div className="flex flex-wrap gap-2">
          {SKILL_TAGS.map((tag) => (
            <label
              key={tag}
              className="flex cursor-pointer items-center rounded-full border border-line bg-white px-3 py-1.5 text-sm has-[:checked]:border-brand-blue has-[:checked]:bg-brand-blue-light has-[:checked]:text-brand-blue"
            >
              <input type="checkbox" name="skill_tags" value={tag} className="sr-only" />
              {tag}
            </label>
          ))}
        </div>
      </div>

      {/* 経験年数 */}
      <div>
        <label className="app-label" htmlFor="experience_years">
          飲食バイト経験（年）
        </label>
        <select
          id="experience_years"
          name="experience_years"
          defaultValue="0"
          className="app-input bg-white"
        >
          <option value="0">未経験</option>
          <option value="1">1年未満</option>
          <option value="2">1〜2年</option>
          <option value="3">3年以上</option>
        </select>
      </div>

      {/* 自己PR（任意） */}
      <div>
        <label className="app-label" htmlFor="bio">
          自己PR（任意）
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={2}
          placeholder="明るく丁寧に対応します、など"
          className="app-input resize-none"
        />
      </div>

      {/* メッセージ（任意） */}
      <div>
        <label className="app-label" htmlFor="message">
          店長へのメッセージ（任意）
        </label>
        <textarea
          id="message"
          name="message"
          rows={2}
          placeholder="面接でお会いした○○です、など"
          className="app-input resize-none"
        />
      </div>

      {/* 年齢・未成年の場合の親権者同意（利用規約第13条） */}
      <div>
        <label className="app-label" htmlFor="age_bracket">
          年齢
        </label>
        <select
          id="age_bracket"
          name="age_bracket"
          required
          value={ageBracket}
          onChange={(e) => setAgeBracket(e.target.value as "" | "adult" | "minor")}
          className="app-input bg-white"
        >
          <option value="" disabled>選択してください</option>
          <option value="adult">18歳以上</option>
          <option value="minor">16〜17歳（高校生を除く）</option>
        </select>
      </div>

      {ageBracket === "minor" && (
        <div className="rounded-lg border border-brand-yellow bg-brand-yellow-light p-4">
          <p className="mb-3 text-xs leading-relaxed text-brand-yellow-dark">
            16〜17歳の方は、親権者または法定代理人の同意が必要です（利用規約第13条）。
          </p>
          <label className="app-label" htmlFor="guardian_name">
            親権者の氏名
          </label>
          <input
            id="guardian_name"
            name="guardian_name"
            required={ageBracket === "minor"}
            placeholder="例：山田 花子"
            className="app-input"
          />
          <label className="mt-3 flex items-start gap-2 text-xs text-brand-yellow-dark">
            <input type="checkbox" name="guardian_consent" required={ageBracket === "minor"} className="mt-0.5" />
            <span>親権者が本サービスの利用規約に同意していることを確認しました。</span>
          </label>
        </div>
      )}

      <ConsentFields />

      <button
        type="submit"
        disabled={pending || !selectedStore}
        className="app-primary"
      >
        {pending ? "登録中…" : "この店舗で登録する"}
      </button>
    </form>
    </ConsentGate>
  );
}
