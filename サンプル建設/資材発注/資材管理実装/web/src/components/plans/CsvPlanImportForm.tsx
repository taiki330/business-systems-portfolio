"use client";

import { SubmitButton } from "@/components/ui/SubmitButton";
import type { ProductOption } from "@/types/stock";
import Link from "next/link";
import { useMemo, useState } from "react";

type ImportedRow = {
  id: string;
  building: string;
  sourceCode: string;
  sourceName: string;
  quantity: number;
  classification: string;
  note: string;
  include: boolean;
  productId: string;
};

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  siteId: string;
  siteName: string;
  products: ProductOption[];
};

const HEADER_ALIASES = {
  code: ["商品コード", "資材コード", "品番", "material_code", "code"],
  name: ["名称", "資材名", "商品名", "name"],
  quantity: ["数量", "生成数量", "補正後数量", "予定数量", "計上数量"],
  building: ["棟", "棟名", "building"],
  classification: ["区分", "classification"],
  note: ["備考", "算出根拠", "根拠", "note"],
} as const;

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s　]/g, "");
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  const text = source.replace(/^\uFEFF/, "");

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value.trim());
      value = "";
    } else if (character === "\n") {
      row.push(value.trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else if (character !== "\r") {
      value += character;
    }
  }
  row.push(value.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

function findColumn(headers: string[], aliases: readonly string[]): number {
  const normalizedAliases = aliases.map(normalizeHeader);
  return headers.findIndex((header) => normalizedAliases.includes(normalizeHeader(header)));
}

function parseImportRows(
  source: string,
  products: ProductOption[],
): { rows: ImportedRow[]; error: string | null } {
  const csv = parseCsv(source);
  if (csv.length < 2) return { rows: [], error: "CSVに明細がありません。" };

  const headers = csv[0];
  const codeIndex = findColumn(headers, HEADER_ALIASES.code);
  const nameIndex = findColumn(headers, HEADER_ALIASES.name);
  const quantityIndex = findColumn(headers, HEADER_ALIASES.quantity);
  const buildingIndex = findColumn(headers, HEADER_ALIASES.building);
  const classificationIndex = findColumn(headers, HEADER_ALIASES.classification);
  const noteIndex = findColumn(headers, HEADER_ALIASES.note);
  if (quantityIndex < 0 || (codeIndex < 0 && nameIndex < 0)) {
    return { rows: [], error: "「品番または名称」と「数量」の列が必要です。CSVの見出しを確認してください。" };
  }

  const rows: ImportedRow[] = [];
  const invalidRows: number[] = [];
  csv.slice(1).forEach((line, index) => {
    const quantity = Number((line[quantityIndex] ?? "").replace(/[,\s　]/g, ""));
    if (!Number.isInteger(quantity) || quantity < 0) {
      invalidRows.push(index + 2);
      return;
    }
    const classification = classificationIndex >= 0 ? (line[classificationIndex] ?? "").trim() : "";
    const sourceCode = codeIndex >= 0 ? (line[codeIndex] ?? "").trim() : "";
    const matchedProductId = sourceCode
      ? (products.find((product) => product.code === sourceCode)?.id ?? "")
      : "";
    rows.push({
      id: `${index}-${line.join("|")}`,
      building: buildingIndex >= 0 ? (line[buildingIndex] ?? "").trim() : "",
      sourceCode,
      sourceName: nameIndex >= 0 ? (line[nameIndex] ?? "").trim() : "",
      quantity,
      classification,
      note: noteIndex >= 0 ? (line[noteIndex] ?? "").trim() : "",
      include: classification === "" || classification === "計上",
      productId: matchedProductId,
    });
  });

  if (rows.length === 0) return { rows: [], error: "反映できる明細がありません。数量は0以上の整数で入力してください。" };
  if (invalidRows.length > 0) return { rows, error: `${invalidRows.slice(0, 5).join("、")}行目の数量を読み取れませんでした。該当行は除外しています。` };
  return { rows, error: null };
}

export function CsvPlanImportForm({ action, siteId, siteName, products }: Props) {
  const [rows, setRows] = useState<ImportedRow[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const buildings = useMemo(() => Array.from(new Set(rows.map((row) => row.building).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ja")), [rows]);
  const visibleRows = useMemo(() => rows.filter((row) => !selectedBuilding || row.building === selectedBuilding), [rows, selectedBuilding]);
  const rowsToSubmit = visibleRows.filter((row) => row.include);
  const incompleteCount = rowsToSubmit.filter((row) => !row.productId).length;
  const payload = JSON.stringify(rowsToSubmit.map((row) => ({ product_id: row.productId, quantity: row.quantity })));

  function updateRow(rowId: string, update: Partial<ImportedRow>) {
    setRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...update } : row)));
  }

  async function onFileChange(file: File | null) {
    if (!file) return;
    const parsed = parseImportRows(await file.text(), products);
    const fileBuildings = Array.from(new Set(parsed.rows.map((row) => row.building).filter(Boolean)));
    setRows(parsed.rows);
    setSelectedBuilding(fileBuildings.length === 1 ? fileBuildings[0] : "");
    setMessage(parsed.error);
  }

  return (
    <form action={action} className="mt-6 space-y-6">
      <input type="hidden" name="site_id" value={siteId} />
      <input type="hidden" name="rows_json" value={payload} />
      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <p className="text-sm text-zinc-700">反映先: <span className="font-semibold text-zinc-950">{siteName}</span></p>
        <label htmlFor="plan-csv" className="mt-4 block text-sm font-medium text-zinc-800">資材予測CSV <span className="text-red-600">*</span></label>
        <input id="plan-csv" type="file" accept=".csv,text/csv" onChange={(event) => void onFileChange(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm text-zinc-700 file:mr-4 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-800 hover:file:bg-zinc-200" />
        <p className="mt-2 text-xs text-zinc-600">「品番または名称」「数量」を読み込みます。「棟」「区分」「備考・算出根拠」があるCSVにも対応します。</p>
      </section>

      {message && <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{message}</p>}

      {rows.length > 0 && <>
        {buildings.length > 1 && <section className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <label htmlFor="csv-building" className="block text-sm font-semibold text-amber-950">CSV内の棟を選択してください <span className="text-red-700">*</span></label>
          <select id="csv-building" value={selectedBuilding} onChange={(event) => setSelectedBuilding(event.target.value)} className="mt-2 w-full max-w-md rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-zinc-900">
            <option value="">選択してください</option>
            {buildings.map((building) => <option key={building} value={building}>{building}</option>)}
          </select>
          <p className="mt-2 text-xs text-amber-900">複数の棟が入ったCSVは、選んだ棟の明細だけを「{siteName}」へ反映します。</p>
        </section>}

        {(!buildings.length || selectedBuilding) && <section className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <div className="border-b border-zinc-200 px-5 py-4">
            <h2 className="font-semibold text-zinc-900">反映する資材を確認</h2>
            <p className="mt-1 text-sm text-zinc-600">商品コードが一致した行は自動で商品を選択します。未登録・不一致の行だけ選択してください。同じ商品を複数行で選んだ場合は数量を合算します。</p>
          </div>
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-700"><tr><th className="px-4 py-3 font-medium">反映</th><th className="px-4 py-3 font-medium">CSVの品番・名称</th><th className="px-4 py-3 text-right font-medium">数量</th><th className="px-4 py-3 font-medium">区分</th><th className="px-4 py-3 font-medium">反映先の商品</th><th className="px-4 py-3 font-medium">備考・算出根拠</th></tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {visibleRows.map((row) => <tr key={row.id} className={row.include ? "" : "bg-zinc-50 text-zinc-500"}>
                <td className="px-4 py-3"><input type="checkbox" checked={row.include} onChange={(event) => updateRow(row.id, { include: event.target.checked })} className="h-4 w-4 rounded border-zinc-300" /></td>
                <td className="px-4 py-3 text-zinc-900"><div>{row.sourceCode || "品番なし"}</div><div className="mt-0.5 text-zinc-600">{row.sourceName || "名称なし"}</div></td>
                <td className="px-4 py-3 text-right font-medium text-zinc-900">{row.quantity}</td>
                <td className="px-4 py-3 text-zinc-700">{row.classification || "―"}</td>
                <td className="px-4 py-3"><select value={row.productId} disabled={!row.include} onChange={(event) => updateRow(row.id, { productId: event.target.value })} className="w-72 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 disabled:bg-zinc-100"><option value="">商品を選択してください</option>{products.map((product) => <option key={product.id} value={product.id}>{product.code ? `${product.code} — ${product.name}` : product.name}</option>)}</select></td>
                <td className="px-4 py-3 text-zinc-600">{row.note || "―"}</td>
              </tr>)}
            </tbody>
          </table>
        </section>}

        {selectedBuilding && <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">今回反映するのは{rowsToSubmit.length}件です。CSVにない既存の予定数量は残ります。{incompleteCount > 0 && ` 商品が未選択の行が${incompleteCount}件あります。`}</div>}
      </>}

      <div className="flex gap-3 border-t border-zinc-200 pt-6">
        <SubmitButton disabled={rowsToSubmit.length === 0 || incompleteCount > 0 || (buildings.length > 1 && !selectedBuilding)} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400" pendingLabel="反映中...">予定数量へ反映</SubmitButton>
        <Link href="/plans" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">キャンセル</Link>
      </div>
    </form>
  );
}
