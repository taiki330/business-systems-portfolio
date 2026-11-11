export type Product = {
  id: string;
  code: string | null;
  name: string;
  unit: string | null;
  /** 資材種別（Phase 7-1）。既存資材は未分類のため NULL 可。 */
  category_id: string | null;
  /** セット数（半端もん機能）。NULL=制約なし。 */
  lot_size: number | null;
  /** 1単位あたりの重量(kg)。資材発注書の合計重量に使う。NULL=未登録。 */
  weight_kg: number | null;
  created_at: string;
  updated_at: string;
};

export type ProductFormData = {
  code: string;
  name: string;
  unit: string;
  category_id: string;
  lot_size: string;
  weight_kg: string;
};
