export type Site = {
  id: string;
  code: string | null;
  name: string;
  address: string | null;
  prime_contractor_id: string | null;
  slip_site_number: number | null;
  /** 現場が属する地域センター。既定値=関西（サンプル市A）。設定・変更は事務（admin）のみ。P4 */
  center_id: string;
  allow_partial_lot_default: boolean;
  created_at: string;
  updated_at: string;
};

export type SiteFormData = {
  code: string;
  name: string;
  address: string;
  prime_contractor_id: string;
  center_id: string;
  allow_partial_lot_default: boolean;
};

export type PrimeContractorOption = {
  id: string;
  name: string;
  slip_number: string;
};

export type CenterOption = {
  id: string;
  code: string;
  name: string;
};
