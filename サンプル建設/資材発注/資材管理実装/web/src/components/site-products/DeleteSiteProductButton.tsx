"use client";

import { deleteSiteProduct } from "@/app/sites/[id]/products/actions";

type Props = {
  siteId: string;
  id: string;
  productLabel: string;
};

export function DeleteSiteProductButton({ siteId, id, productLabel }: Props) {
  return (
    <form
      action={deleteSiteProduct.bind(null, siteId, id)}
      onSubmit={(e) => {
        if (
          !confirm(
            `「${productLabel}」の紐づけを削除しますか？\nこの現場の並び順情報も失われます。`,
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
