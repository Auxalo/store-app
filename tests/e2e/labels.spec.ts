import { expect, type Page, test } from "@playwright/test";
import { scan } from "../../src/lib/labels/__tests__/scan-helpers";
import { addCategory, createProduct, signUp } from "./helpers";

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

  // The sticker is 40 x 30 mm, drawn three times finer than the printer's 8 dots a millimetre so
  // it is sharp on the screen, and a scanner reads it.
  const read = await scanPreview(page);
  expect(read?.size).toEqual({ w: 960, h: 720 });
  expect(read?.read?.text).toBe(EAN_A);
  expect(read?.read?.format).toBe("EAN_13");

  // Another size gives another picture that still scans.
  await page.getByTestId("label-size-38x25").click();
  await expect
    .poll(async () => (await scanPreview(page))?.size)
    .toEqual({ w: 912, h: 600 });
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
  expect(read?.read?.format).toBe("CODE_128");
  const made = read?.read?.text ?? "";
  // 7 digits, never starting with 2 (a till would read a price from it) or 0.
  expect(made).toMatch(/^[13-9]\d{6}$/);

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

/** The pages of the PDF the print window would make, with their size in mm. */
async function pdfPages(page: Page) {
  const pdf = await page.pdf({ preferCSSPageSize: true });
  const text = pdf.toString("latin1");
  const media =
    /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(
      text,
    );
  return {
    pages: (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length,
    images: (text.match(/\/Subtype\s*\/Image/g) ?? []).length,
    widthMm: media ? (Number(media[3]) - Number(media[1])) / 2.8346 : 0,
    heightMm: media ? (Number(media[4]) - Number(media[2])) / 2.8346 : 0,
  };
}

test("on A4 paper: as many labels as fit on a sheet, in rows, and more sheets when needed; the choice is remembered", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await signUp(page, `lab4${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Alpha Soap",
    price: "90",
    stock: "10",
    barcode: EAN_A,
  });

  await openProduct(page, "Alpha Soap");
  await page.getByTestId("open-labels").click();
  // No receipt printer on this device: it starts on a sticker roll.
  await expect(page.getByTestId("label-paper-label")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("label-paper-a4").click();
  await page.getByTestId("copies-input").fill("40");

  // 40 x 30 mm: 4 across, 9 down = 36 to a sheet, so 40 labels are 2 sheets.
  const hint = page.getByTestId("label-paper-hint");
  await expect(hint).toContainText(/36|৩৬/);
  await expect(hint).toContainText(/2|২/);
  await expect(page.getByTestId("label-sheet-map").locator("span")).toHaveCount(
    36,
  );

  await page.getByTestId("print-labels").click();
  await expect(page.locator("#print-root .print-sheet-cell")).toHaveCount(40);
  const made = await page.evaluate(() => {
    const sheets = [...document.querySelectorAll("#print-root .print-sheet")];
    const cell = document.querySelector<HTMLElement>(
      "#print-root .print-sheet-cell",
    );
    const img = cell?.querySelector("img");
    return {
      perSheet: sheets.map(
        (s) => s.querySelectorAll(".print-sheet-cell").length,
      ),
      columns: (sheets[0]?.firstElementChild as HTMLElement | null)?.style
        .gridTemplateColumns,
      pageRule:
        document.querySelector("#print-root style")?.textContent?.trim() ?? "",
      // Drawn three times finer than a thermal label (960 dots across 40 mm).
      picture: img?.naturalWidth,
    };
  });
  expect(made.perSheet).toEqual([36, 4]);
  expect(made.columns).toBe("repeat(4, 40mm)");
  expect(made.pageRule).toContain("size: A4");
  expect(made.pageRule).toContain("margin: 0");
  expect(made.picture).toBe(960);
  const pdf = await pdfPages(page);
  expect(pdf.pages).toBe(2);
  expect(pdf.images).toBeGreaterThanOrEqual(1);
  expect(Math.abs(pdf.widthMm - 210)).toBeLessThan(0.6);
  expect(Math.abs(pdf.heightMm - 297)).toBeLessThan(0.6);

  // The same sheets as a PDF download.
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("label-download").click(),
  ]);
  expect(file.suggestedFilename()).toMatch(/.pdf$/);
  const saved = await file.path();
  const bytes = (await import("node:fs"))
    .readFileSync(saved)
    .toString("latin1");
  expect(bytes.startsWith("%PDF")).toBe(true);
  expect(bytes).toContain("/Count 2");
  expect(bytes).toContain("/MediaBox [0 0 595.276 841.89]");

  // Kept on this device.
  await page.reload();
  await page.getByTestId("open-labels").click();
  await expect(page.getByTestId("label-paper-a4")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("on a receipt roll: the labels one under another, as wide as the roll prints, with cut lines; a label too wide for the roll is red", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await signUp(page, `lab5${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Alpha Soap",
    price: "90",
    stock: "10",
    barcode: EAN_A,
  });

  await openProduct(page, "Alpha Soap");
  await page.getByTestId("open-labels").click();
  await page.getByTestId("label-paper-80mm").click();
  await page.getByTestId("copies-plus").click();
  await page.getByTestId("copies-plus").click();
  await expect(page.getByTestId("label-paper-hint")).toContainText(/10|১০/);
  // The receipt printer is where the one-tap icon prints: no "use the normal window" note.
  await expect(page.getByTestId("label-windows-note")).toHaveCount(0);

  await page.getByTestId("print-labels").click();
  // Three labels and the closing cut line.
  await expect(page.locator("#print-root .print-strip")).toHaveCount(4);
  const strip = await page.evaluate(async () => {
    const images = [
      ...document.querySelectorAll<HTMLImageElement>(
        "#print-root .print-strip img",
      ),
    ];
    const img = images[0];
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
    return {
      width: canvas.width,
      height: canvas.height,
      gray,
      shown: img.style.width,
      tail: images.at(-1)?.naturalHeight,
      root: document.getElementById("print-root")?.style.width,
      pageRule:
        document.querySelector("#print-root style")?.textContent?.trim() ?? "",
    };
  });
  if (!strip) throw new Error("no strip");
  // 576 dots = the 72 mm an 80 mm roll prints; a 30 mm label and 3 mm to the next.
  expect(strip.width).toBe(576);
  expect(strip.height).toBe(264);
  expect(strip.shown).toBe("72mm");
  expect(strip.root).toBe("80mm");
  expect(strip.tail).toBe(24);
  expect(strip.pageRule).toBe("@page { margin: 0; }");
  expect(
    scan({
      data: Uint8ClampedArray.from(strip.gray),
      width: strip.width,
      height: strip.height,
    })?.text,
  ).toBe(EAN_A);
  const pdf = await pdfPages(page);
  expect(pdf.images).toBeGreaterThanOrEqual(1);
  await expect(page.locator("#print-root .print-strip")).toHaveCount(0);

  // A 50 mm label does not fit the 48 mm a 58 mm roll prints.
  await page.getByTestId("label-paper-58mm").click();
  await expect(page.getByTestId("print-labels")).toBeEnabled();
  await page.getByTestId("label-size-50x30").click();
  await expect(page.getByTestId("label-paper-wide")).toBeVisible();
  await expect(page.getByTestId("print-labels")).toBeDisabled();
  await page.getByTestId("label-size-40x30").click();
  await expect(page.getByTestId("print-labels")).toBeEnabled();

  // A roll print is at most 200 labels.
  await page.getByTestId("copies-input").fill("201");
  await expect(page.getByTestId("label-limit")).toBeVisible();
  await expect(page.getByTestId("print-labels")).toBeDisabled();
});

test("labels for many products start on the category the Products page is showing", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await signUp(page, `lab6${Date.now()}${testInfo.project.name}`);
  await page.goto("/categories");
  await addCategory(page, "Dairy", "দুগ্ধজাত");
  await expect(
    page.getByTestId("category-row").filter({ hasText: "দুগ্ধজাত" }),
  ).toBeVisible();

  await createProduct(page, {
    name: "Alpha Soap",
    price: "90",
    stock: "10",
    barcode: EAN_A,
  });
  // A second product, in the category.
  await page.goto("/products/new");
  await page.getByLabel("পণ্যের নাম").fill("Fresh Milk");
  await page.getByLabel("বিক্রয়মূল্য (৳)").fill("60");
  await page.getByLabel(/এখন হাতে স্টক/).fill("10");
  await page.getByLabel("ক্রয়মূল্য (৳)", { exact: true }).fill("50");
  await page.getByLabel("বারকোড").fill(EAN_B);
  await page
    .getByText("ক্যাটাগরি", { exact: true })
    .locator("xpath=..")
    .getByRole("combobox")
    .click();
  await page.getByRole("option", { name: "দুগ্ধজাত" }).click();
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await expect(page).toHaveURL(/\/products$/);

  // No category chosen: every product, and no chip.
  await page.getByTestId("open-bulk-labels").click();
  const rows = page.getByTestId("bulk-row");
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId("bulk-category")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(rows).toHaveCount(0);

  // Show one category on the Products page, then print labels: only that category.
  await page.getByTestId("list-filters").click();
  await page.getByTestId("filter-category").click();
  await page.getByRole("option", { name: "দুগ্ধজাত" }).click();
  await page.getByTestId("filters-done").click();
  await page.getByTestId("open-bulk-labels").click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Fresh Milk");
  const chip = page.getByTestId("bulk-category");
  await expect(chip).toContainText("দুগ্ধজাত");

  // Select all takes the category's products only.
  await page.getByTestId("bulk-select-all").click();
  await expect(rows.first().getByTestId("bulk-check")).toBeChecked();

  // The chip takes the limit off; what was ticked stays ticked.
  await chip.click();
  await expect(rows).toHaveCount(2);
  await expect(chip).toHaveCount(0);
  await expect(
    rows.filter({ hasText: "Fresh Milk" }).getByTestId("bulk-check"),
  ).toBeChecked();
  await expect(
    rows.filter({ hasText: "Alpha Soap" }).getByTestId("bulk-check"),
  ).not.toBeChecked();
});

test("a code starting with 2 is flagged and can be swapped for a short code; the shop name can go on top", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await signUp(page, `lab7${Date.now()}${testInfo.project.name}`);
  // A code made by the app before (13 digits starting with 2): a till reads a price from it.
  const OLD = "2001234000000";
  await createProduct(page, {
    name: "Cashew Kernels",
    price: "90",
    stock: "10",
    barcode: OLD,
  });

  await openProduct(page, "Cashew Kernels");
  await page.getByTestId("open-labels").click();
  await expect(page.getByTestId("label-price-code")).toBeVisible();
  await expect(page.getByTestId("print-labels")).toBeEnabled();

  // Asked first; cancelling keeps the old code.
  await page.getByTestId("replace-code").click();
  await expect(page.getByRole("alertdialog")).toContainText(OLD);
  await page.getByRole("alertdialog").getByRole("button").first().click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByTestId("label-price-code")).toBeVisible();

  await page.getByTestId("replace-code").click();
  await page.getByTestId("replace-code-confirm").click();
  await expect(page.getByTestId("label-price-code")).toHaveCount(0);
  const read = await scanPreview(page);
  expect(read?.read?.format).toBe("CODE_128");
  const made = read?.read?.text ?? "";
  expect(made).toMatch(/^[13-9]\d{6}$/);

  // The shop name on top: the label picture changes, still scans, and the switch is remembered.
  const before = await page
    .getByTestId("label-preview-image")
    .getAttribute("src");
  await page.getByTestId("label-show-shop").click();
  await expect
    .poll(() => page.getByTestId("label-preview-image").getAttribute("src"))
    .not.toBe(before);
  expect((await scanPreview(page))?.read?.text).toBe(made);
  await page.reload();
  await page.getByTestId("open-labels").click();
  await expect(page.getByTestId("label-show-shop")).toBeChecked();

  // Saved on the product.
  await openProduct(page, "Cashew Kernels");
  await expect(page.getByText(made).first()).toBeVisible();
});
