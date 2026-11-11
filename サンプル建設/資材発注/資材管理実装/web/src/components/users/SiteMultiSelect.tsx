"use client";

import type { SiteOptionForUser } from "@/types/user-management";
import { useMemo, useState } from "react";

type Props = {
  sites: SiteOptionForUser[];
  defaultValues?: string[];
  disabled?: boolean;
};

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

export function SiteMultiSelect({ sites, defaultValues = [], disabled = false }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set(defaultValues));
  const visibleSites = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return sites;
    return sites.filter((site) => normalize(`${site.code ?? ""} ${site.name}`).includes(q));
  }, [query, sites]);

  function toggle(siteId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(siteId)) next.delete(siteId);
      else next.add(siteId);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-zinc-300 bg-white p-3">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="現場名・コードで検索"
        disabled={disabled}
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100"
      />
      <p className="mt-2 text-xs text-zinc-500">{selected.size}現場を選択中</p>
      <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
        {visibleSites.map((site) => (
          <label key={site.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-zinc-50">
            <input
              type="checkbox"
              name="site_ids"
              value={site.id}
              checked={selected.has(site.id)}
              onChange={() => toggle(site.id)}
              disabled={disabled}
            />
            <span>{site.code ? `${site.code} — ${site.name}` : site.name}</span>
          </label>
        ))}
        {visibleSites.length === 0 && <p className="px-2 py-3 text-sm text-zinc-500">一致する現場がありません。</p>}
      </div>
    </div>
  );
}
