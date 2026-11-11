/**
 * リース会社マスタ。Phase 3-1 で管理画面から操作可能に。vendors（二次業者マスタ）とは無関係の独立テーブル。
 * 電話番号・担当者・FAX・メールは管理しない（Phase 3 確定事項）。
 */
export type LeaseCompany = {
  id: string;
  name: string;
  note: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type LeaseCompanyFormData = {
  name: string;
  note: string;
  is_active: boolean;
};

/** 借用登録などの選択肢用（有効なリース会社のみ） */
export type LeaseCompanyOption = {
  id: string;
  name: string;
};
