/**
 * 業者（二次業者）マスタ。A-4 で DB 導入。Phase 2-1 で管理画面から操作可能に。
 */
export type Vendor = {
  id: string;
  name: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type VendorFormData = {
  name: string;
  note: string;
};

/**
 * 業者と現場の多対多紐付け。
 */
export type VendorSite = {
  vendor_id: string;
  site_id: string;
  created_at: string;
};

export type VendorSiteRow = VendorSite & {
  sites: {
    code: string | null;
    name: string;
  } | null;
};

export type SiteOptionForVendor = {
  id: string;
  code: string | null;
  name: string;
};
