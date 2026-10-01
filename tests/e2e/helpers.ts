import { expect, type Page } from "@playwright/test";

export async function signUp(
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
