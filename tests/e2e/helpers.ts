import { expect, type Page } from "@playwright/test";

/** Creates a shop and lands on the first-time setup (the owner's next step). */
export async function signUpToSetup(
  page: Page,
  username: string,
  storeName = "রহিম স্টোর",
) {
  await page.goto("/signup");
  await page.getByLabel("দোকানের নাম").fill(storeName);
  await page.getByLabel("আপনার নাম").fill("রহিম উদ্দিন");
  await page.getByLabel("মোবাইল নম্বর বা ইউজারনেম").fill(username);
  await page.getByLabel("পাসওয়ার্ড").fill("password123");
  await page.getByRole("button", { name: "দোকান তৈরি করুন" }).click();
  await expect(page).toHaveURL(/\/settings\/setup$/);
}

/** Creates a shop, skips the first-time setup, and lands on the dashboard. */
export async function signUp(
  page: Page,
  username: string,
  storeName = "রহিম স্টোর",
) {
  await signUpToSetup(page, username, storeName);
  await page.getByTestId("setup-skip").click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function signIn(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("মোবাইল নম্বর বা ইউজারনেম").fill(username);
  await page.getByLabel("পাসওয়ার্ড").fill("password123");
  await page.getByRole("button", { name: "সাইন ইন", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** The global sync chip: synced | pending | syncing | offline | issue. */
export const indicator = (page: Page, state: string) =>
  page.locator(`[data-indicator="${state}"]`);

export async function addCategory(page: Page, name: string, nameBn: string) {
  await page.getByRole("button", { name: "ক্যাটাগরি যোগ করুন" }).click();
  await page.getByLabel("নাম", { exact: true }).fill(name);
  await page.getByLabel("বাংলা নাম").fill(nameBn);
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
}

export interface NewProduct {
  name: string;
  nameBn: string;
  price: string;
  stock: string;
  barcode?: string;
  /** Purchase price in taka (required by the form; defaults to 80% of the price). */
  cost?: string;
}

export async function createProduct(page: Page, p: NewProduct) {
  await page.goto("/products/new");
  await page.getByLabel("পণ্যের নাম").fill(p.name);
  await page.getByLabel("বাংলা নাম").fill(p.nameBn);
  await page.getByLabel("বিক্রয়মূল্য (৳)").fill(p.price);
  await page.getByLabel(/এখন হাতে স্টক/).fill(p.stock);
  await page
    .getByLabel("ক্রয়মূল্য (৳)", { exact: true })
    .fill(p.cost ?? String(Math.round(Number(p.price) * 0.8)));
  if (p.barcode) await page.getByLabel("বারকোড").fill(p.barcode);
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await expect(page).toHaveURL(/\/products$/);
}

export const search = (page: Page) =>
  page.getByPlaceholder("খুঁজুন বা বারকোড স্ক্যান করুন");
export const tapProduct = (page: Page, text: string) =>
  page.getByTestId("picker-row").filter({ hasText: text }).click();

/** On a phone the cart is a sheet behind the bottom bar; on a desktop it is always visible. */
export async function openCart(page: Page) {
  const bar = page.getByTestId("view-cart");
  if (await bar.isVisible()) await bar.click();
  await expect(page.getByTestId("cart-panel")).toBeVisible();
}

/** Owner adds a cashier (optionally with a PIN) on the staff screen. */
export async function addCashier(
  page: Page,
  name: string,
  username: string,
  pin?: string,
) {
  await page.goto("/settings/staff");
  await page.getByTestId("add-staff").click();
  await page.getByTestId("staff-name").fill(name);
  await page.getByTestId("staff-username").fill(username);
  await page.getByTestId("staff-password").fill("password123");
  if (pin) await page.getByTestId("staff-pin-input").fill(pin);
  await page.getByTestId("save-staff").click();
  await expect(
    page.getByTestId("staff-row").filter({ hasText: name }),
  ).toBeVisible();
}
