export type StockProductRef = {
  code: string | null;
  name: string;
  unit: string | null;
};

export type StorageKind = "center" | "site";

export type CenterStockRow = {
  id: string;
  location: string;
  quantity: number;
  storage_kind?: StorageKind;
  site_id?: string | null;
  products: StockProductRef | null;
};

export type ProductOption = {
  id: string;
  code: string | null;
  name: string;
  /** 資材種別名（Phase 7-1）。選択欄の種別絞り込みに使う。未分類は null */
  category_name?: string | null;
  /** 単位（本・枚など）。束数量の表示に使う */
  unit?: string | null;
  /** 1束あたりの数量（セット数）。未設定は null＝束の概念なし */
  lot_size?: number | null;
};

export type StockItem = {
  id: string;
  product_id: string;
  location: string;
  quantity: number;
  storage_kind?: StorageKind;
  site_id?: string | null;
  products: StockProductRef | null;
};

export type StockItemFormData = {
  product_id: string;
  location: string;
  quantity: number;
};

export type SiteRef = {
  name: string;
};

export type SiteStockRow = {
  id: string;
  product_id: string;
  site_id: string;
  quantity: number;
  products: StockProductRef | null;
  sites: SiteRef | null;
  /** 現場で最終的に必要な予定数量。未登録は null */
  planned_quantity?: number | null;
  /** 予定に対して、既出庫＋依頼中を含めた今後の見込数量 */
  expected_quantity?: number | null;
  /** 予定数量から見込数量を引いた残り必要数 */
  remaining_planned_quantity?: number | null;
};
