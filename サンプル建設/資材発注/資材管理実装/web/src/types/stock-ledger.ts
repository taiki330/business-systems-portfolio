export type MovementType = "in" | "out";

export type StockLedgerRow = {
  id: string;
  product_id: string;
  location: string;
  movement_type: MovementType;
  quantity: number;
  created_at: string;
  products: {
    code: string | null;
    name: string;
  } | null;
};

export type StockMovementFormData = {
  product_id: string;
  location: string;
  movement_type: MovementType;
  quantity: number;
};
