"use client";

import { removeVendorSite } from "@/app/vendors/[id]/sites/actions";

type Props = {
  vendorId: string;
  siteId: string;
  siteLabel: string;
};

export function DeleteVendorSiteButton({
  vendorId,
  siteId,
  siteLabel,
}: Props) {
  return (
    <form
      action={removeVendorSite.bind(null, vendorId, siteId)}
      onSubmit={(e) => {
        if (
          !confirm(
            `「${siteLabel}」の紐づけを削除しますか？\nこの業者はこの現場への新規出庫依頼ができなくなります。`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="rounded-lg border border-red-200 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        削除
      </button>
    </form>
  );
}
