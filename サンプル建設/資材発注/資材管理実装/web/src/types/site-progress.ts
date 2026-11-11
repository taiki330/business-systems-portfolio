/** 現場進捗の区分。dismantle_completed が完工（現場が終わること）にあたる。 */
export type SiteProgressKind =
  | "assembly_completed"
  | "dismantle_started"
  | "dismantle_completed";

export const SITE_PROGRESS_LABELS: Record<SiteProgressKind, string> = {
  assembly_completed: "組立完了",
  dismantle_started: "解体開始",
  dismantle_completed: "解体完了（完工）",
};

/** 区分ごとに画面で主役にする数値。ヒアリングの要望に対応する。 */
export const SITE_PROGRESS_FOCUS: Record<
  SiteProgressKind,
  { key: "shipped" | "siteQuantity"; label: string; description: string }
> = {
  assembly_completed: {
    key: "shipped",
    label: "出庫総数",
    description: "この現場へ出庫した資材の累計です。",
  },
  dismantle_started: {
    key: "shipped",
    label: "出庫総数",
    description:
      "組立完了時から出庫総数が変わっていないかを確認します（下に差分を表示）。",
  },
  dismantle_completed: {
    key: "siteQuantity",
    label: "現場に残っている数",
    description: "完工時点でこの現場に残っている資材です。",
  },
};

export const SITE_PROGRESS_ORDER: SiteProgressKind[] = [
  "assembly_completed",
  "dismantle_started",
  "dismantle_completed",
];

export function isSiteProgressKind(value: string): value is SiteProgressKind {
  return (SITE_PROGRESS_ORDER as string[]).includes(value);
}

export type MaterialOwnership = "owned" | "leased";

export const OWNERSHIP_LABELS: Record<MaterialOwnership, string> = {
  owned: "自社",
  leased: "リース",
};

/** スナップショットの1明細（資材 × 自社/リース）。 */
export type SiteProgressSnapshotItem = {
  productId: string;
  productName: string;
  productCode: string | null;
  productUnit: string | null;
  categoryName: string | null;
  ownership: MaterialOwnership;
  shippedQuantity: number;
  returnedQuantity: number;
  outstandingQuantity: number;
  overReturnQuantity: number;
  siteQuantity: number;
};

/** 進捗記録の合計値。 */
export type SiteProgressTotals = {
  shipped: number;
  returned: number;
  outstanding: number;
  overReturn: number;
  siteQuantity: number;
};

/** 進捗記録の1件（一覧用）。 */
export type SiteProgressEventRow = {
  id: string;
  siteId: string;
  siteName: string;
  kind: SiteProgressKind;
  occurredOn: string;
  recordedAt: string;
  recordedByName: string | null;
  note: string | null;
  totals: SiteProgressTotals;
};

/** 進捗記録の詳細（完工時レポート）。 */
export type SiteProgressDetail = {
  event: SiteProgressEventRow;
  items: SiteProgressSnapshotItem[];
  /** 比較対象（解体開始・解体完了のとき、直前の組立完了時の記録） */
  baseline: {
    kind: SiteProgressKind;
    occurredOn: string;
    totals: SiteProgressTotals;
  } | null;
};

/** 未返却資材一覧の1行（リアルタイム）。 */
export type SiteOutstandingRow = {
  siteId: string;
  siteName: string;
  /** 完工日（解体完了の記録があれば） */
  completedOn: string | null;
  productId: string;
  productName: string;
  productCode: string | null;
  categoryName: string | null;
  ownership: MaterialOwnership;
  shippedQuantity: number;
  returnedQuantity: number;
  outstandingQuantity: number;
  overReturnQuantity: number;
  siteQuantity: number;
};

export function emptyTotals(): SiteProgressTotals {
  return { shipped: 0, returned: 0, outstanding: 0, overReturn: 0, siteQuantity: 0 };
}
