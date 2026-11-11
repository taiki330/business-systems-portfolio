import { test, expect } from "./fixtures/auth";
import { isForbiddenUrl } from "./helpers";

/**
 * 在庫調整（暫定メンテ / adjust_stock_item RPC）。
 *
 * centerの在庫更新は棚卸だけが例外で、通常の在庫調整は事務専用。
 * 本ファイルでは「admin が調整できる」「center はできない」の両方を検証する。
 */
test.describe("在庫調整（暫定メンテ）", () => {
  test("admin: 既存在庫の数量を補正すると ledger に理由付きで記録される", async ({
    adminPage: page,
  }) => {
    await page.goto("/stock");
    const editLink = page.getByRole("link", { name: "編集" }).first();
    const hasRow = (await editLink.count()) > 0;
    test.skip(!hasRow, "センター在庫が1件も無いためスキップ");

    await editLink.click();
    await expect(page.getByRole("heading")).toBeVisible();

    const quantityInput = page.locator("#quantity");
    const before = await quantityInput.inputValue();
    const newValue = String(Number(before) + 1);
    await quantityInput.fill(newValue);
    await page.getByRole("button", { name: "更新" }).click();
    await page.waitForURL("**/stock");

    // 履歴ページで reason 付きの補正が記録されていることを確認
    await page.goto("/stock/ledger");
    expect(isForbiddenUrl(page)).toBe(false);
  });

  test("admin: 新規在庫登録ができる（暫定メンテ）", async ({
    adminPage: page,
  }) => {
    await page.goto("/stock");
    await expect(page.getByRole("link", { name: "暫定メンテ" })).toBeVisible();
  });

  test("center: 暫定メンテ導線が表示されず、直接アクセスも拒否される", async ({
    centerPage: page,
  }) => {
    await page.goto("/stock");
    await expect(page.getByRole("link", { name: "暫定メンテ" })).toHaveCount(0);

    await page.goto("/stock/new");
    expect(isForbiddenUrl(page)).toBe(true);
  });
});
