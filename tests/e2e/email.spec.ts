import { expect, type Page, test } from "@playwright/test";
import { MongoClient } from "mongodb";
import { signUp, signUpToSetup } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

const dbPort = process.env.E2E_DB_PORT ?? "27018";
const uri =
  process.env.E2E_MONGODB_URI ??
  `mongodb://127.0.0.1:${dbPort}/?replicaSet=rs0`;
const dbName = process.env.E2E_MONGODB_DB ?? "store_app_e2e";

/** The latest mail the app "sent" to an address (the e2e server keeps mails in a collection). */
async function mailTo(to: string, timeoutMs = 15_000) {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const mails = client.db(dbName).collection("mailOutbox");
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const mail = await mails.findOne({ to }, { sort: { createdAt: -1 } });
      if (mail) return mail as unknown as { subject: string; text: string };
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  } finally {
    await client.close();
  }
}

async function noMailTo(to: string) {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    return (
      (await client
        .db(dbName)
        .collection("mailOutbox")
        .countDocuments({ to })) === 0
    );
  } finally {
    await client.close();
  }
}

/** A page with nobody signed in (the signed-in one would be sent away from the sign-in pages). */
async function visitor(
  browser: import("@playwright/test").Browser,
  baseURL: string | undefined,
): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  return context.newPage();
}

test("forgot password: a mailed link sets a new password, and the old one stops working", async ({
  page,
  browser,
}, testInfo) => {
  const username = `fp${Date.now()}${testInfo.project.name}`;
  const email = `${username}@example.test`;
  await signUp(page, username);

  // The owner changes the address in Settings (it is shown, and saved).
  await page.goto("/settings");
  await expect(page.getByTestId("account-email-input")).toHaveValue(email);
  const newEmail = `${username}.new@example.test`;
  await page.getByTestId("account-email-input").fill(newEmail);
  await page.getByTestId("account-email-save").click();
  await expect(page.getByText("ইমেইল সংরক্ষিত")).toBeVisible();

  // The welcome mail went to the first address and never contains a password.
  const welcome = await mailTo(email);
  expect(welcome?.text).toContain(username);
  expect(welcome?.text).not.toContain("password123");

  // Someone who forgot the password asks for a link.
  const other = await visitor(browser, testInfo.project.use.baseURL);
  await other.goto("/login");
  await other.getByTestId("forgot-link").click();
  await expect(other).toHaveURL(/\/forgot-password$/);
  await expect(other.getByTestId("forgot-help")).toContainText("Sohel Ashik");
  await other.getByLabel("ইমেইল").fill(newEmail);
  await other.getByRole("button", { name: "লিংক পাঠান" }).click();
  await expect(other.getByTestId("forgot-sent")).toBeVisible();

  const mail = await mailTo(newEmail);
  expect(mail).not.toBeNull();
  const link = mail?.text.match(/https?:\/\/\S*reset-password\S*/)?.[0];
  expect(link).toBeTruthy();

  await other.goto(link as string);
  await expect(other).toHaveURL(/\/reset-password\?token=/);
  await other.getByLabel("নতুন পাসওয়ার্ড").fill("brandnew456");
  await other.getByLabel("আবার লিখুন").fill("different789");
  await other.getByRole("button", { name: "পাসওয়ার্ড বদলান" }).click();
  await expect(other.getByText("দুটি পাসওয়ার্ড মিলছে না")).toBeVisible();
  await other.getByLabel("আবার লিখুন").fill("brandnew456");
  await other.getByRole("button", { name: "পাসওয়ার্ড বদলান" }).click();
  await expect(other.getByTestId("reset-done")).toBeVisible();

  // The same link works only once.
  await other.goto(link as string);
  await expect(other.getByTestId("reset-invalid")).toBeVisible();

  // The old password is refused, the new one signs in.
  await other.goto("/login");
  await other.getByLabel("মোবাইল নম্বর বা ইউজারনেম").fill(username);
  await other.getByLabel("পাসওয়ার্ড").fill("password123");
  await other.getByRole("button", { name: "সাইন ইন" }).click();
  await expect(other.getByText("ইউজারনেম বা পাসওয়ার্ড ভুল")).toBeVisible();
  await other.getByLabel("পাসওয়ার্ড").fill("brandnew456");
  await other.getByRole("button", { name: "সাইন ইন" }).click();
  await expect(other).toHaveURL(/\/dashboard$/);
  await other.context().close();
});

test("forgot password gives the same answer for an address with no account, and sends nothing", async ({
  browser,
}, testInfo) => {
  const nobody = `nobody${Date.now()}${testInfo.project.name}@example.test`;
  const other = await visitor(browser, testInfo.project.use.baseURL);
  await other.goto("/forgot-password");
  await other.getByLabel("ইমেইল").fill(nobody);
  await other.getByRole("button", { name: "লিংক পাঠান" }).click();
  await expect(other.getByTestId("forgot-sent")).toBeVisible();
  // Give a (wrongly) sent mail time to appear before checking that none did.
  await other.waitForTimeout(1_500);
  expect(await noMailTo(nobody)).toBe(true);
  await other.context().close();
});

test("sign-up asks for an email, refuses a used one, and says the developer can help", async ({
  page,
  browser,
}, testInfo) => {
  const username = `em${Date.now()}${testInfo.project.name}`;
  await page.goto("/signup");
  await expect(page.getByTestId("signup-dev-note")).toContainText(
    "Sohel Ashik",
  );

  // A wrong address is caught in the form.
  await page.getByLabel("দোকানের নাম").fill("রহিম স্টোর");
  await page.getByLabel("আপনার নাম").fill("রহিম উদ্দিন");
  await page.getByLabel("মোবাইল নম্বর বা ইউজারনেম").fill(username);
  await page.getByLabel("ইমেইল").fill("not-an-email");
  await page.getByLabel("পাসওয়ার্ড").fill("password123");
  await page.getByRole("button", { name: "দোকান তৈরি করুন" }).click();
  await expect(page.getByText("সঠিক ইমেইল ঠিকানা দিন")).toBeVisible();

  // The first shop takes the address; a second shop cannot use it.
  await signUpToSetup(page, `${username}a`);
  const second = await visitor(browser, testInfo.project.use.baseURL);
  await second.goto("/signup");
  await second.getByLabel("দোকানের নাম").fill("করিম স্টোর");
  await second.getByLabel("আপনার নাম").fill("করিম");
  await second.getByLabel("মোবাইল নম্বর বা ইউজারনেম").fill(`${username}b`);
  await second.getByLabel("ইমেইল").fill(`${username}a@example.test`);
  await second.getByLabel("পাসওয়ার্ড").fill("password123");
  await second.getByRole("button", { name: "দোকান তৈরি করুন" }).click();
  await expect(
    second.getByText("এই ইমেইল আরেকটি অ্যাকাউন্টে আগেই ব্যবহার হয়েছে"),
  ).toBeVisible();
  await second.context().close();
});
