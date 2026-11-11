/**
 * 仕入先マスタ。lease_companies とは別テーブル
 * （同一企業から購入も借用もする場合は両方に登録する）。
 */
export type Supplier = {
  id: string;
  name: string;
  note: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SupplierFormData = {
  name: string;
  note: string;
  is_active: boolean;
};

/** 仕入れ登録の選択肢用（有効な仕入先のみ） */
export type SupplierOption = {
  id: string;
  name: string;
};

/** 仕入れ（購入）履歴の1行。 */
export type StockPurchaseRow = {
  id: string;
  quantity: number;
  purchaseDate: string;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
  productName: string;
  productCode: string | null;
  productUnit: string | null;
  categoryName: string | null;
  supplierName: string;
};
