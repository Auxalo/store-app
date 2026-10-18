import { expect, type Page, test } from "@playwright/test";
import { createProduct, openCart, signUp, tapProduct } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

/** Sells one milk to a new customer (so the invoice has a customer on it) and leaves the receipt open. */
async function sellOne(page: Page, username: string) {
  await signUp(page, username);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "10",
  });
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  await cart.getByTestId("customer-button").click();
  await page.getByRole("button", { name: "নতুন ক্রেতা" }).click();
  await page.getByLabel("নাম", { exact: true }).fill("রহিম");
  await page.getByLabel("মোবাইল নম্বর").fill("01711000001");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  const received = cart.getByTestId("received-input");
  await expect(async () => {
    await received.fill("20");
    await expect(received).not.toHaveValue("", { timeout: 500 });
  }).toPass();
  await cart.getByTestId("complete-sale").click();
  await expect(page.locator("#print-receipt")).toBeVisible();
}

test("on a phone the invoice goes to the share sheet as plain text (WhatsApp, Messenger ...)", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    (window as unknown as { __shared: unknown[] }).__shared = [];
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: unknown) => {
        (window as unknown as { __shared: unknown[] }).__shared.push(data);
      },
    });
  });
  await sellOne(page, `shr${Date.now()}${testInfo.project.name}`);
  await page.getByTestId("share-receipt").click();

  const shared = await page.evaluate(
    () => (window as unknown as { __shared: Array<{ text: string }> }).__shared,
  );
  expect(shared).toHaveLength(1);
  const text = shared[0].text;
  expect(text).toContain("রহিম স্টোর");
  expect(text).toContain("ফ্রেশ দুধ");
  expect(text).toContain("রহিম");
  expect(text).toContain("৳৫০.০০"); // the total
  expect(text).toContain("৳৩০.০০"); // what is still due
  await expect(page.getByTestId("share-dialog")).toHaveCount(0);
});

test("without a share sheet (a computer) a window offers WhatsApp to the customer's number and copy", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
  });
  await sellOne(page, `shr2${Date.now()}${testInfo.project.name}`);
  await page.getByTestId("share-receipt").click();

  await expect(page.getByTestId("share-dialog")).toBeVisible();
  await expect(page.getByTestId("share-text")).toHaveValue(/ফ্রেশ দুধ/);
  const link = page.getByTestId("share-whatsapp");
  await expect(link).toContainText("01711000001");
  const href = (await link.getAttribute("href")) ?? "";
  expect(href).toMatch(/^https:\/\/wa\.me\/8801711000001\?text=/);
  expect(decodeURIComponent(href)).toContain("ফ্রেশ দুধ");
  await expect(page.getByTestId("share-copy")).toBeVisible();
});

test("an invoice can be shared again from the sale's own page", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
  });
  await sellOne(page, `shr3${Date.now()}${testInfo.project.name}`);
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();
  await page.goto("/sales");
  await page.getByTestId("sale-row").first().click();
  await page.getByTestId("share-receipt").click();
  await expect(page.getByTestId("share-text")).toHaveValue(/ফ্রেশ দুধ/);
});
