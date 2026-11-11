import { expect, test } from "./fixtures/auth";

test.describe("center: 限定業務メニュー", () => {
  test("ホームには確定した4業務だけを表示する", async ({
    centerPage: page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "サンプル市Aセンター" })).toBeVisible();
    await expect(page.getByRole("link", { name: /オーダーを確認・印刷/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /センター在庫を見る/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "棚卸" })).toBeVisible();
    await expect(page.getByRole("link", { name: /現場在庫を見る/ })).toBeVisible();
    await expect(page.locator("main nav").getByRole("link")).toHaveCount(4);
  });

  test("オーダー・センター在庫・現場在庫にはアクセスできる", async ({
    centerPage: page,
  }) => {
    await page.goto("/orders");
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole("heading", { name: "オーダーを確認・印刷" })).toBeVisible();

    await page.goto("/stock");
    await expect(page).toHaveURL(/\/stock$/);
    await expect(page.getByRole("heading", { name: "センター在庫" })).toBeVisible();

    await page.goto("/stock/sites");
    await expect(page).toHaveURL(/\/stock\/sites$/);
    await expect(page.getByRole("heading", { name: "現場在庫一覧" })).toBeVisible();
  });

  test("オーダー一覧と詳細で登録時の現場名が一致する", async ({
    centerPage: page,
  }) => {
    await page.goto("/orders");
    const firstRow = page.locator("tbody tr").first();
    if ((await firstRow.count()) === 0) test.skip(true, "確認対象のオーダーがありません");

    const siteName = (await firstRow.locator("td").nth(1).innerText()).trim();
    await firstRow.getByRole("link", { name: /確認・印刷/ }).click();
    await expect(page.getByText(`現場: ${siteName}`, { exact: false })).toBeVisible();
  });

  test("棚卸を開始し、入力・確定できる画面へアクセスできる", async ({
    centerPage: page,
  }) => {
    await page.goto("/stock/inventory");
    await expect(page).toHaveURL(/\/stock\/inventory$/);
    await expect(page.getByRole("heading", { name: "棚卸", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "棚卸を開始" })).toBeVisible();
  });

  for (const path of [
    "/requests",
    "/stock/move",
    "/stock/ledger",
    "/stock/returns",
    "/leases/batches",
    "/leases/stock",
    "/analytics",
    "/products",
    "/sites",
  ]) {
    test(`${path} は権限エラーになる`, async ({ centerPage: page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/forbidden$/);
      await expect(
        page.getByRole("heading", { name: "この画面にはアクセスできません" }),
      ).toBeVisible();
    });
  }
});
