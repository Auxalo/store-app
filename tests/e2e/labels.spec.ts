import { expect, type Page, test } from "@playwright/test";
import { scan } from "../../src/lib/labels/__tests__/scan-helpers";
import { createProduct, signUp } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

const EAN_A = "5901234123457";
const EAN_B = "4006381333931";

/** The picture in the preview, read back the way a scanner would. */
async function scanPreview(page: Page) {
  const picture = await page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>(
      '[data-testid="label-preview-image"]',
    );
    if (!img) return null;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const gray: number[] = [];
    for (let i = 0; i < data.length; i += 4) gray.push(data[i]);
    return { width: canvas.width, height: canvas.height, gray };
  });
  if (!picture) return null;
  return {
    size: { w: picture.width, h: picture.height },
    read: scan({
      data: Uint8ClampedArray.from(picture.gray),
      width: picture.width,
      height: picture.height,
    }),
  };
}

/** What the print window would print: pages, their size in mm, and whether the pictures are in it. */
async function printedPages(page: Page) {
  const labels = await page.evaluate(() => ({
    count: document.querySelectorAll("#print-root .print-label").length,
    box: (
      document.querySelector("#print-root .print-label") as HTMLElement | null
    )?.style.width,
    pageRule:
      document.querySelector("#print-root style")?.textContent?.trim() ?? "",
  }));
  const pdf = await page.pdf({ preferCSSPageSize: true });
  const text = pdf.toString("latin1");
  const media =
    /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(
      text,
    );
  return {
    ...labels,
    pages: (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length,
    images: (text.match(/\/Subtype\s*\/Image/g) ?? []).length,
    widthMm: media ? (Number(media[3]) - Number(media[1])) / 2.8346 : 0,
    heightMm: media ? (Number(media[4]) - Number(media[2])) / 2.8346 : 0,
  };
}

async function openProduct(page: Page, name: string) {
  await page.goto("/products");
  await page.getByTestId("product-row").filter({ hasText: name }).click();
  await expect(page.getByTestId("open-labels")).toBeVisible();
}

test("one product: the label is a real barcode that scans, and N labels come out one per page at the label size", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await signUp(page, `lab${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Alpha Soap",
    price: "90",
    stock: "10",
    barcode: EAN_A,
  });

  await openProduct(page, "Alpha Soap");
  await page.getByTestId("open-labels").click();
  const dialog = page.getByTestId("label-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("label-preview-image")).toBeVisible();
  await expect(page.getByTestId("label-no-barcode")).toHaveCount(0);

  // The sticker is 40 x 30 mm at 8 dots a millimetre, and a scanner reads it.
  const read = await scanPreview(page);
  expect(read?.size).toEqual({ w: 320, h: 240 });
  expect(read?.read?.text).toBe(EAN_A);
  expect(read?.read?.format).toBe("EAN_13");

  // Another size gives another picture that still scans.
  await page.getByTestId("label-size-38x25").click();
  await expect
    .poll(async () => (await scanPreview(page))?.size)
    .toEqual({ w: 304, h: 200 });
  expect((await scanPreview(page))?.read?.text).toBe(EAN_A);
  await page.getByTestId("label-size-40x30").click();

  // Three labels: one page each, exactly the label size.
  await page.getByTestId("copies-plus").click();
  await page.getByTestId("copies-plus").click();
  await expect(page.getByTestId("copies-input")).toHaveValue("3");
  await page.getByTestId("print-labels").click();
  await expect(page.locator("#print-root .print-label")).toHaveCount(3);
  const printed = await printedPages(page);
  expect(printed).toMatchObject({ count: 3, box: "40mm", pages: 3 });
  expect(printed.pageRule).toContain("size: 40mm 30mm");
  expect(printed.images).toBeGreaterThanOrEqual(1);
  expect(Math.abs(printed.widthMm - 40)).toBeLessThan(0.6);
  expect(Math.abs(printed.heightMm - 30)).toBeLessThan(0.6);

  // When the print window is done the spot is emptied, so the label page size does not linger.
  await expect(page.locator("#print-root .print-label")).toHaveCount(0);
});

test("a product with no barcode is red; Create barcode gives it one of the shop's own that then scans", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await signUp(page, `lab2${Date.now()}${testInfo.project.name}`);
  await createProduct(page, { name: "Beta Rice", price: "50", stock: "10" });

  await openProduct(page, "Beta Rice");
  await page.getByTestId("open-labels").click();
  const warning = page.getByTestId("label-no-barcode");
  await expect(warning).toBeVisible();
  await expect(page.getByTestId("label-preview-problem")).toBeVisible();
  await expect(page.getByTestId("print-labels")).toBeDisabled();

  await page.getByTestId("create-barcode").click();
  await expect(warning).toHaveCount(0);
  await expect(page.getByTestId("label-preview-image")).toBeVisible();
  await expect(page.getByTestId("print-labels")).toBeEnabled();
  const read = await scanPreview(page);
  expect(read?.read?.format).toBe("EAN_13");
  const made = read?.read?.text ?? "";
  expect(made).toMatch(/^2\d{12}$/);

  // It is saved on the product: still there after a reload (and at the counter, by the same search).
  await page.reload();
  await expect(page.getByText(made).first()).toBeVisible();
});

test("many products at once: search, tick, set how many each; a product with no barcode is red and cannot be ticked", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await signUp(page, `lab3${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Alpha Soap",
    price: "90",
    stock: "10",
    barcode: EAN_A,
  });
  await createProduct(page, {
    name: "Beta Soap",
    price: "60",
    stock: "10",
    barcode: EAN_B,
  });
  await createProduct(page, { name: "Gamma Soap", price: "40", stock: "10" });

  await page.goto("/products");
  await page.getByTestId("open-bulk-labels").click();
  const rows = page.getByTestId("bulk-row");
  await expect(rows).toHaveCount(3);

  // The one with no barcode is red and cannot be ticked.
  const gamma = rows.filter({ hasText: "Gamma Soap" });
  await expect(gamma).toHaveAttribute("data-state", "none");
  await expect(gamma.getByTestId("bulk-check")).toBeDisabled();
  await expect(gamma.getByTestId("bulk-create-barcode")).toBeVisible();
  await expect(rows.filter({ hasText: "Alpha Soap" })).toHaveAttribute(
    "data-state",
    "ok",
  );

  // Search narrows the list.
  await page.getByTestId("bulk-search").fill("Beta");
  await expect(rows).toHaveCount(1);
  await page.getByTestId("bulk-search").fill("");
  await expect(rows).toHaveCount(3);

  // Tick two; Alpha gets 2 labels, Beta 1: 3 labels.
  await rows
    .filter({ hasText: "Alpha Soap" })
    .getByTestId("bulk-check")
    .click();
  await rows.filter({ hasText: "Beta Soap" }).getByTestId("bulk-check").click();
  await rows
    .filter({ hasText: "Alpha Soap" })
    .getByTestId("copies-plus")
    .click();
  await expect(page.getByTestId("bulk-summary")).toContainText(/[2২].*[3৩]/);
  // The preview shows a label that scans.
  await expect(page.getByTestId("label-preview-image")).toBeVisible();
  expect((await scanPreview(page))?.read?.text).toBeTruthy();

  // Give Gamma a barcode: it is no longer red and can be ticked.
  await gamma.getByTestId("bulk-create-barcode").click();
  await expect(gamma).toHaveAttribute("data-state", "ok");
  await gamma.getByTestId("bulk-check").click();
  await expect(page.getByTestId("bulk-summary")).toContainText(/[3৩].*[4৪]/);

  await page.getByTestId("bulk-print").click();
  await expect(page.locator("#print-root .print-label")).toHaveCount(4);
  const printed = await printedPages(page);
  expect(printed).toMatchObject({ count: 4, pages: 4, box: "40mm" });
});
