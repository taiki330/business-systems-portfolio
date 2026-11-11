import { test, expect } from "./fixtures/auth";
import { uniqueName } from "./helpers";

/**
 * admin: リース会社登録（Phase 3-1 / レビュー対応の is_active 含む）
 */
test.describe("admin: リース会社登録", () => {
  test("新規登録でき、一覧に反映される", async ({ adminPage: page }) => {
    const name = uniqueName("E2E会社");

    await page.goto("/leases/companies/new");
    await expect(
      page.getByRole("heading", { name: "リース会社を新規追加" }),
    ).toBeVisible();

    await page.getByLabel("リース会社名").fill(name);
    await page.getByLabel("備考").fill("E2Eテストで作成");
    await page.getByRole("button", { name: "登録" }).click();

    await page.waitForURL("**/leases/companies");
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();

    // 直後は有効（is_active デフォルト true）
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row.getByText("有効", { exact: true })).toBeVisible();
  });

  test("会社名が空だと登録できない（必須バリデーション）", async ({
    adminPage: page,
  }) => {
    await page.goto("/leases/companies/new");
    const nameInput = page.getByLabel("リース会社名");
    await expect(nameInput).toHaveAttribute("required", "");
    // ブラウザの required バリデーションでフォーム送信がブロックされ、
    // 送信されないため URL は new のまま留まることを確認する。
    await page.getByRole("button", { name: "登録" }).click();
    await expect(page).toHaveURL(/\/leases\/companies\/new$/);
  });

  test("編集で無効化すると、新規借用の会社選択肢から消える", async ({
    adminPage: page,
  }) => {
    const name = uniqueName("E2E無効化会社");

    await page.goto("/leases/companies/new");
    await page.getByLabel("リース会社名").fill(name);
    await page.getByRole("button", { name: "登録" }).click();
    await page.waitForURL("**/leases/companies");

    const row = page.getByRole("row", { name: new RegExp(name) });
    await row.getByRole("link", { name: "編集" }).click();
    await expect(page.getByRole("heading", { name: "リース会社を編集" })).toBeVisible();

    await page.getByLabel(/有効/).uncheck();
    await page.getByRole("button", { name: "更新" }).click();
    await page.waitForURL("**/leases/companies");
    await expect(row.getByText("無効", { exact: true })).toBeVisible();

    // 借用登録フォームの会社候補に出てこないこと
    // （検索付き選択欄なので、開いてから候補を数える）
    await page.goto("/leases/batches/new");
    const companyInput = page.locator("#lease_company_id");
    await companyInput.click();
    const options = await page
      .locator('ul[role="listbox"] [role="option"]')
      .allTextContents();
    // 候補が0件だと「含まれない」判定が常に成立してしまうため、
    // まず候補が出ていること自体を確認する（空振りの検知）。
    expect(options.length, "有効な会社の候補が出ていること").toBeGreaterThan(0);
    expect(options.some((o) => o.includes(name))).toBe(false);
  });
});
