export type CenterTransferItemRow = {
  id: string;
  product_code_snapshot: string | null;
  product_name_snapshot: string | null;
  product_unit_snapshot: string | null;
  quantity: number;
  shortage_quantity: number;
};

export type CenterTransferRow = {
  id: string;
  from_center_id: string;
  to_center_id: string;
  from_center_name: string;
  to_center_name: string;
  note: string | null;
  created_at: string;
  items: CenterTransferItemRow[];
};
