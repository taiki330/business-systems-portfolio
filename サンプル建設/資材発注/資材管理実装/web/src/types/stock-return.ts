import type { SiteRef, StockProductRef } from "@/types/stock";

export type StockReturn = {
  id: string;
  product_id: string;
  site_id: string;
  quantity: number;
  memo: string | null;
  returned_by: string | null;
  created_at: string;
};

export type StockReturnFormData = {
  product_id: string;
  site_id: string;
  quantity: number;
  memo: string;
};

export type StockReturnListRow = {
  id: string;
  inputQuantity: number;
  quantity: number;
  overQuantity: number;
  memo: string | null;
  returnedByName: string | null;
  createdAt: string;
  correctedAt: string | null;
  products: StockProductRef | null;
  sites: SiteRef | null;
};
