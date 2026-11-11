/** 資材種別マスタ（Phase 7-1）。選択肢は運用で追加・改名できる。 */
export type ProductCategory = {
  id: string;
  code: string | null;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** 資材フォームの選択肢に使う最小形。 */
export type ProductCategoryOption = {
  id: string;
  name: string;
};
