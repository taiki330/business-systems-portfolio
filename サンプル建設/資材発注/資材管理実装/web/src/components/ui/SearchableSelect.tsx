"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SearchableOption = {
  /** フォームへ送る値（多くは UUID） */
  value: string;
  /** 画面に出す名称 */
  label: string;
  /** 名称以外に検索対象へ含めたい文字列（コードなど） */
  keywords?: string;
  /** 絞り込み用のグループ（商品の資材種別など） */
  group?: string | null;
};

type Props = {
  /** hidden input の name。フォーム送信時はここに value が入る */
  name: string;
  options: SearchableOption[];
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  /** 「指定なし」を選べるようにする（絞り込み用途） */
  allowEmpty?: boolean;
  emptyLabel?: string;
  /** 選択時に GET フォームを自動送信する（一覧の絞り込み用） */
  submitOnChange?: boolean;
  id?: string;
  /**
   * 入力欄の読み上げ名。<label> で囲むだけの使い方では、内側の種別絞り込み
   * （select）が先に来るため入力欄に名前が付かない。その場合に指定する。
   */
  ariaLabel?: string;
  disabled?: boolean;
  /** 選択が変わったときの通知（呼び出し側で連動表示を更新する用途） */
  onValueChange?: (value: string) => void;
};

/** 検索用に正規化する（大文字小文字・全角半角・カタカナ/ひらがなの差を吸収）。 */
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0x60),
    );
}

/**
 * 検索して選ぶ入力欄。
 *
 * 現場名・商品名が長く全文を打たない運用のため、部分一致で候補を出して選ばせる。
 * 候補の絞り込みは画面側で行う（サーバーへの都度問い合わせをせず、入力の反応を速く保つ）。
 * 実際にフォームへ送るのは hidden input の値（ID）で、表示名は送らない。
 */
export function SearchableSelect({
  name,
  options,
  defaultValue = "",
  placeholder = "名前の一部を入力",
  required = false,
  allowEmpty = false,
  emptyLabel = "指定なし",
  submitOnChange = false,
  id,
  ariaLabel,
  disabled = false,
  onValueChange,
}: Props) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const listId = `${autoId}-list`;

  const selectedOption = options.find((o) => o.value === defaultValue) ?? null;
  const [value, setValue] = useState(defaultValue);
  const [query, setQuery] = useState(selectedOption?.label ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [groupFilter, setGroupFilter] = useState<string>("");

  const containerRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const o of options) if (o.group) set.add(o.group);
    return Array.from(set);
  }, [options]);

  const matches = useMemo(() => {
    const q = normalize(query.trim());
    const selectedLabel = selectedOption?.label ?? "";
    // 選択直後（入力欄＝選択中の名称）は全件を出す。絞り込み直後に候補が1件だけ
    // 残って選び直せない、という状態を避けるため。
    const effective = q && query !== selectedLabel ? q : "";
    return options.filter((o) => {
      if (groupFilter && o.group !== groupFilter) return false;
      if (!effective) return true;
      return (
        normalize(o.label).includes(effective) ||
        (o.keywords ? normalize(o.keywords).includes(effective) : false)
      );
    });
  }, [options, query, groupFilter, selectedOption]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function commit(option: SearchableOption | null) {
    setValue(option?.value ?? "");
    setQuery(option?.label ?? "");
    setOpen(false);
    onValueChange?.(option?.value ?? "");
    if (submitOnChange) {
      // hidden input の値が反映されてからフォームを送る
      requestAnimationFrame(() => hiddenRef.current?.form?.requestSubmit());
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((i) => {
        const max = matches.length - 1 + (allowEmpty ? 1 : 0);
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return Math.max(0, Math.min(max, next));
      });
      return;
    }
    if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      if (allowEmpty && activeIndex === 0) {
        commit(null);
        return;
      }
      const option = matches[activeIndex - (allowEmpty ? 1 : 0)];
      if (option) commit(option);
      return;
    }
    if (e.key === "Escape") setOpen(false);
  }

  const noMatch = query.trim() !== "" && matches.length === 0;

  return (
    <div ref={containerRef} className="relative">
      <input ref={hiddenRef} type="hidden" name={name} value={value} />

      {groups.length > 1 && (
        <select
          aria-label="種別で絞り込む"
          value={groupFilter}
          onChange={(e) => {
            setGroupFilter(e.target.value);
            setOpen(true);
          }}
          disabled={disabled}
          className="mb-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700"
        >
          <option value="">種別すべて</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      )}

      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        required={required && value === ""}
        onChange={(e) => {
          setQuery(e.target.value);
          if (value !== "") onValueChange?.("");
          setValue("");
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:bg-zinc-100"
      />

      {value !== "" && (
        <button
          type="button"
          aria-label="選択を解除"
          onClick={() => {
            setQuery("");
            setValue("");
            setOpen(true);
            onValueChange?.("");
          }}
          className="absolute right-2 top-[calc(50%-0.5rem)] text-sm text-zinc-400 hover:text-zinc-700"
        >
          ×
        </button>
      )}

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-zinc-300 bg-white py-1 shadow-lg"
        >
          {allowEmpty && (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value === ""}
                onClick={() => commit(null)}
                className={`w-full px-3 py-2 text-left text-sm ${
                  activeIndex === 0 ? "bg-zinc-100" : "hover:bg-zinc-50"
                } text-zinc-500`}
              >
                {emptyLabel}
              </button>
            </li>
          )}
          {matches.map((o, i) => {
            const index = i + (allowEmpty ? 1 : 0);
            return (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  data-value={o.value}
                  aria-selected={o.value === value}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(o)}
                  className={`w-full px-3 py-2 text-left text-sm ${
                    index === activeIndex ? "bg-zinc-100" : "hover:bg-zinc-50"
                  } ${o.value === value ? "font-medium text-zinc-900" : "text-zinc-700"}`}
                >
                  {o.label}
                  {o.group && (
                    <span className="ml-2 text-xs text-zinc-400">{o.group}</span>
                  )}
                </button>
              </li>
            );
          })}
          {noMatch && (
            <li className="px-3 py-2 text-sm text-zinc-500">
              一致する候補がありません
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
