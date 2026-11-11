import type { AppUserRole } from "@/types/app-user";

export type AppUserListRow = {
  id: string;
  email: string | null;
  role: AppUserRole;
  display_name: string | null;
  vendor_id: string | null;
  site_id: string | null;
  site_name: string | null;
  site_ids: string[];
  site_names: string[];
  center_id: string | null;
  center_name: string | null;
  created_at: string;
  updated_at: string;
};

export type ResolvedAuthUser = {
  id: string;
  email: string | null;
};

export type VendorOption = {
  id: string;
  name: string;
};

export type SiteOptionForUser = {
  id: string;
  code: string | null;
  name: string;
};

export type CenterOptionForUser = {
  id: string;
  code: string;
  name: string;
};

export type RegisterUserFormData = {
  email: string;
  role: AppUserRole;
  display_name: string;
  site_ids: string[];
  center_id: string;
};

export type UpdateUserFormData = {
  display_name: string;
  role: AppUserRole;
  site_ids: string[];
  center_id: string;
};
