import { test, expect } from "./fixtures/auth";
import { isForbiddenUrl } from "./helpers";

/**
 * vendor: 権限確認・他現場アクセス不可・リース会社名が見えないこと
 */

const FORBIDDEN_FOR_VENDOR = [
  "/leases/companies",
  "/leases/companies/new",
  "/leases/batches",
  "/plans/over",
  "/analytics",
  "/users",
];

test.describe("vendor: 権限確認", () => {
  for (const path of FORBIDDEN_FOR_VENDOR) {
    test(`${path} にアクセスできない`, async ({ vendorPage: page }) => {
      await page.goto(path);
      expect(isForbiddenUrl(page)).toBe(true);
    });
  }

  test("admin 専用の借用登録・リース会社登録リンクがホームに出ない", async ({
    vendorPage: page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: "リース会社管理へ" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "リース借用管理へ" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "予定数量超過の確認" }),
    ).toHaveCount(0);
  });

  test("在庫内訳ページは参照でき、リース会社名は表示されない", async ({
    vendorPage: page,
  }) => {
    await page.goto("/leases/stock");
    expect(isForbiddenUrl(page)).toBe(false);
    await expect(
      page.getByRole("heading", { name: "在庫内訳（自社所有・リース）" }),
    ).toBeVisible();

    // 明細テーブルに「リース会社」列自体が出ない（admin/center のみ表示する列）
    await expect(page.getByRole("columnheader", { name: "リース会社" })).toHaveCount(
      0,
    );
    // 明細行にも会社名セルが出ない（canShowLeaseCompanyName=false 時は列自体を描画しない実装のため、
    // テーブルが存在する場合は列数で間接確認する）
    const headerCells = page.locator("table thead th");
    const headerCount = await headerCells.count();
    if (headerCount > 0) {
      const headerTexts = await headerCells.allTextContents();
      expect(headerTexts).not.toContain("リース会社");
    }
  });
});

test.describe("vendor: 他現場アクセス不可（要 E2E_OTHER_SITE_NAME）", () => {
  const otherSite = process.env.E2E_OTHER_SITE_NAME;

  test("現場セレクトに担当外現場が出ない（sites テーブル自体が vendor_sites 経由で絞られている）", async ({
    vendorPage: page,
  }) => {
    test.skip(!otherSite, "E2E_OTHER_SITE_NAME 未設定のためスキップ");

    await page.goto("/leases/stock");
    // 検索付き選択欄なので、開いてから候補を読む。
    const siteInput = page.locator("#site_id");
    await siteInput.click();
    const siteOptions = await page
      .locator('ul[role="listbox"] [role="option"]')
      .allTextContents();
    // 候補が0件だと「含まれない」判定が常に成立してしまうため、
    // 担当現場が候補に出ていること自体を先に確認する（空振りの検知）。
    const ownSite = process.env.E2E_VENDOR_SITE_NAME;
    if (ownSite) {
      expect(
        siteOptions.some((o) => o.includes(ownSite)),
        "担当現場は候補に出ること",
      ).toBe(true);
    } else {
      expect(siteOptions.length, "候補が出ていること").toBeGreaterThan(0);
    }
    // sites テーブルの SELECT RLS（sites_vendor_select, 017 migration）が
    // vendor_sites 経由で担当現場のみに絞るため、fetchSiteOptions() 自体が
    // 担当外現場を一切返さない。ドロップダウンから選ぶ余地が無い、という
    // より強いフェイルクローズ設計になっている（URL 直接指定は次のテストで確認）。
    expect(siteOptions.some((o) => o.includes(otherSite!))).toBe(false);
  });

  test("URLを直接書き換えて担当外現場を指定しても、RLSにより他現場データは出ない", async ({
    adminPage,
    vendorPage: page,
  }) => {
    test.skip(!otherSite, "E2E_OTHER_SITE_NAME 未設定のためスキップ");

    // ドロップダウンには出てこない（上のテストで確認済み）ため、
    // URL を直接書き換えて担当外現場の site_id を指定するケースを想定する
    // （リンク推測・ブックマーク・過去 URL の使い回し等）。
    // site_id は admin 側で調べる（vendor は他現場の一覧に到達できないため）。
    await adminPage.goto("/sites");
    const row = adminPage.getByRole("row", { name: otherSite! });
    const editHref = await row
      .getByRole("link", { name: "編集" })
      .getAttribute("href");
    test.skip(!editHref, `現場 "${otherSite}" が見つからないためスキップ`);
    const otherSiteId = editHref!.match(/\/sites\/([^/]+)\/edit/)?.[1];
    test.skip(!otherSiteId, "site_id の抽出に失敗したためスキップ");

    await page.goto(`/leases/stock?site_id=${otherSiteId}`);
    expect(isForbiddenUrl(page)).toBe(false); // ページ自体は表示される(404/403ではない)
    // RLS により、担当外現場を URL で直接指定しても vendor には行が返らない
    await expect(page.getByText("在庫がありません。")).toBeVisible();
  });
});
