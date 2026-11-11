export type SiteProduct = {
  id: string;
  site_id: string;
  product_id: string;
  display_order: number | null;
  note: string | null;
  /** 半端もん許可（半端もん機能）。既定 true。false でセット数の倍数チェックを強制する。 */
  allow_partial_lot_override: boolean | null;
  created_at: string;
  updated_at: string;
};

export type SiteProductRow = SiteProduct & {
  products: {
    code: string | null;
    name: string;
    unit: string | null;
  } | null;
};

export type SiteProductFormData = {
  product_id: string;
  display_order: string;
  note: string;
  allow_partial_lot_override: string;
};
