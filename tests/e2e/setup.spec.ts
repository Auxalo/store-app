import { expect, type Page, test } from "@playwright/test";
import { signUp, signUpToSetup } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

async function paste(page: Page, text: string) {
  await page.getByTestId("setup-paste").click();
  await page.getByTestId("setup-paste-text").fill(text);
  await page.getByTestId("setup-paste-add").click();
}

test("a new owner is guided through setup: products, customers with dues, suppliers", async ({
  page,
}, testInfo) => {
  await signUpToSetup(page, `set${Date.now()}${testInfo.project.name}`);

  // Step 1: shop details.
  await page.getByTestId("setup-store-phone").fill("01711-000000");
  await page.getByTestId("setup-store-save").click();

  // Step 2: products, pasted from a spreadsheet (with its header row), plus one bad row.
  await paste(
    page,
    [
      "Name\tBangla name\tCategory\tUnit\tPurchase price\tSelling price\tStock",
      "Miniket Rice\tমিনিকেট চাল\tচাল-ডাল\tkg\t68\t75\t100",
      "Salt\t\tমসলা\tpacket\t36\t42\t20",
      "Free Gift\t\t\tpcs\t0\t10\t5",
    ].join("\n"),
  );
  await expect(page.getByTestId("setup-row")).toHaveCount(3);
  await expect(page.getByTestId("setup-row-problem")).toContainText(
    "০-এর বেশি হতে হবে",
  );
  await expect(page.getByTestId("setup-save")).toBeDisabled();

  // Remove the bad row; the rest can be saved.
  await page
    .getByTestId("setup-row")
    .nth(2)
    .getByRole("button", { name: "মুছুন" })
    .click();
  await expect(page.getByTestId("setup-summary")).toContainText("২টি সারি");
  await page.getByTestId("setup-save").click();
  await expect(page.getByText("২টি যোগ হয়েছে")).toBeVisible();
  await expect(page.getByTestId("setup-row")).toHaveCount(0);

  // Step 3: customers who owe money. One has no phone, one has no amount.
  await page.getByTestId("setup-next").click();
  await paste(
    page,
    [
      "Name\tPhone\tAddress\tDue",
      "রহিম উদ্দিন\t01711000001\tমিরপুর\t1250",
      "সালমা\t\t\t500",
      "করিম\t01711000002\t\t",
    ].join("\n"),
  );
  await page.getByTestId("setup-save").click();
  await expect(page.getByText("৩টি যোগ হয়েছে")).toBeVisible();

  // Step 4: a supplier the shop owes.
  await page.getByTestId("setup-next").click();
  await paste(
    page,
    "Name\tPhone\tAddress\tPayable\nকরিম ট্রেডার্স\t01811000003\t\t4000",
  );
  await page.getByTestId("setup-save").click();
  await expect(page.getByText("১টি যোগ হয়েছে")).toBeVisible();

  // Finish.
  await page.getByTestId("setup-next").click();
  await expect(page.getByTestId("setup-done-summary")).toContainText(
    "২টি পণ্য, ৩জন ক্রেতা, ১জন সরবরাহকারী",
  );
  await page.getByTestId("setup-finish").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("setup-banner")).toHaveCount(0);

  // The dues show up, and none of it counts as a sale.
  await expect(page.getByTestId("stat-customerDue")).toHaveText("৳১,৭৫০");
  await expect(page.getByTestId("stat-supplierDue")).toHaveText("৳৪,০০০");
  await expect(page.getByTestId("stat-todaySales")).toHaveText("৳০");

  await page.goto("/inventory");
  await expect(
    page.getByTestId("product-row").filter({ hasText: "মিনিকেট চাল" }),
  ).toContainText("১০০ কেজি");

  await page.goto("/customers");
  await expect(
    page.getByTestId("party-row").filter({ hasText: "রহিম উদ্দিন" }),
  ).toContainText("৳১,২৫০");
  await page
    .getByTestId("party-row")
    .filter({ hasText: "রহিম উদ্দিন" })
    .getByRole("link")
    .click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳১,২৫০");
  await expect(page.getByText("আগের হিসাব")).toBeVisible();

  // Running the same list again is caught: nothing is added twice.
  await page.goto("/settings/setup");
  await page.getByTestId("setup-step-customers").click();
  await paste(
    page,
    "রহিম উদ্দিন\t01711000001\t\t1250\nনতুন ক্রেতা\t01711000009\t\t",
  );
  await expect(page.getByTestId("setup-row-problem")).toContainText(
    "দোকানে আগেই আছে",
  );
  await expect(page.getByTestId("setup-save")).toBeDisabled();
});

test("the dashboard reminds a new owner to finish setup, until they do or skip", async ({
  page,
}, testInfo) => {
  await signUpToSetup(page, `ban${Date.now()}${testInfo.project.name}`);
  // Leave without finishing: go straight to the dashboard.
  await page.goto("/dashboard");
  await expect(page.getByTestId("setup-banner")).toBeVisible();
  await page.getByRole("link", { name: "সাজানো চালিয়ে যান" }).click();
  await expect(page).toHaveURL(/\/settings\/setup$/);
  await page.getByTestId("setup-skip").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("setup-banner")).toHaveCount(0);
});

test("adding a customer can include what they already owed", async ({
  page,
}, testInfo) => {
  await signUp(page, `opn${Date.now()}${testInfo.project.name}`);
  await page.goto("/customers");
  await page.getByRole("button", { name: "ক্রেতা যোগ করুন" }).click();
  await page.getByLabel("নাম", { exact: true }).fill("জামাল");
  await page.getByLabel(/আগের বাকি/).fill("300");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await expect(
    page.getByTestId("party-row").filter({ hasText: "জামাল" }),
  ).toContainText("৳৩০০");
});
