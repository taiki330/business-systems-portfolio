import { test, expect } from "./fixtures/auth";

/**
 * 分析画面（Phase 5）。D-20260806-03 以降は admin のみ参照可能。
 *
 * Phase 3-6 の「資材移動集計」画面は Phase 5 でダッシュボードと各分析画面に
 * 置き換わったため、本ファイルは現行の構成を対象にしている。
 */

const PAGES: { path: string; heading: string }[] = [
  { path: "/analytics", heading: "分析ダッシュボード" },
  { path: "/analytics/period", heading: "月別・年別集計" },
  { path: "/analytics/sites", heading: "現場別分析" },
  { path: "/analytics/products", heading: "商品別 稼働率分析" },
  { path: "/analytics/leases", heading: "リース分析" },
];

const CSV_EXPORTS = [
  "/analytics/period/export",
  "/analytics/sites/export",
  "/analytics/products/export",
  "/analytics/leases/export",
];

test.describe("分析画面", () => {
  test("admin: 各分析画面を表示でき、集計エラーが出ない", async ({
    adminPage: page,
  }) => {
    for (const { path, heading } of PAGES) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: heading }),
        `${path} の見出し`,
      ).toBeVisible();
      await expect(
        page.getByText(/取得できませんでした|読み込みに失敗/),
        `${path} でエラー表示が出ていないこと`,
      ).toHaveCount(0);
    }
  });

  test("admin: 期間別で月別・年別を切り替えられる", async ({ adminPage: page }) => {
    await page.goto("/analytics/period");
    for (const label of ["月別", "年別"]) {
      await page.getByLabel("期間単位").selectOption({ label });
      await page.getByRole("button", { name: "集計" }).click();
      await expect(
        page.getByRole("heading", { name: "月別・年別集計" }),
      ).toBeVisible();
    }
  });

  test("admin: 稼働率分析の並び順を切り替えられる", async ({ adminPage: page }) => {
    await page.goto("/analytics/products");
    await page.getByLabel("並び順").selectOption({ label: "回転量" });
    await page.getByRole("button", { name: "表示" }).click();
    await expect(
      page.getByRole("heading", { name: "商品別 稼働率分析" }),
    ).toBeVisible();
  });

  test("center: 参照できない", async ({ centerPage: page }) => {
    await page.goto("/analytics");
    await expect(page).toHaveURL(/\/forbidden$/);
  });

  test("center: CSVへ直接アクセスしても拒否される", async ({
    centerPage: page,
  }) => {
    for (const path of CSV_EXPORTS) {
      const response = await page.request.get(path);
      expect(response.status(), `${path} がcenterを拒否すること`).toBe(403);
    }
  });

  test("vendor: いずれの分析画面も参照できない", async ({ vendorPage: page }) => {
    for (const { path, heading } of PAGES) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: heading }),
        `${path} が vendor に見えていないこと`,
      ).toHaveCount(0);
    }
  });
});
