import { expect, type Page, test } from "@playwright/test";
import { addCategory, createProduct, signUp } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

const overflow = (page: Page) =>
  page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));

test("with many categories the counter never scrolls sideways: the cart stays on the screen", async ({
  page,
}, testInfo) => {
  await signUp(page, `lay${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ভূষি (৩০ কেজি)",
    price: "1180",
    cost: "900",
    stock: "12",
  });
  // Enough long category names to make the chip row much wider than the screen.
  await page.goto("/categories");
  const names = [
    "আটা, চিনি ও লবণ",
    "গৃহস্থালি পণ্য",
    "চাল ও ডাল সামগ্রী",
    "ডিম ও দুধ জাতীয়",
    "তেল ও ঘি ভোজ্য",
    "দুধ ও পানীয় সামগ্রী",
    "প্রসাধনী ও সাবান",
    "বিস্কুট ও চকলেট",
    "মসলা ও শুকনো মরিচ",
    "পশুখাদ্য ও ভূষি",
  ];
  for (const [i, name] of names.entries())
    await addCategory(page, name, `Category ${i}`);

  const desktop = testInfo.project.name === "desktop";
  const widths = desktop ? [1100, 1280, 1891] : [390];
  for (const width of widths) {
    await page.setViewportSize({ width, height: desktop ? 900 : 800 });
    await page.goto("/pos");
    await expect(page.getByTestId("picker-row").first()).toBeVisible();
    await page.waitForTimeout(300);
    const { scroll, inner } = await overflow(page);
    expect(
      scroll,
      `page is ${scroll}px wide in a ${inner}px window`,
    ).toBeLessThanOrEqual(inner);
    if (desktop && width >= 1024) {
      // The whole cart panel, including its Sell button, is inside the window.
      const cart = await page.getByTestId("cart-panel").boundingBox();
      expect(cart).not.toBeNull();
      expect((cart?.x ?? 0) + (cart?.width ?? 0)).toBeLessThanOrEqual(inner);
    }
  }
});
