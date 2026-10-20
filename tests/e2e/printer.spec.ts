import fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { createProduct, openCart, signUp, tapProduct } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

/** A fake serial port that records every byte the app writes (and can be told to refuse). */
async function fakePrinter(page: Page, options: { refuse?: boolean } = {}) {
  await page.addInitScript((refuse) => {
    const written: number[][] = [];
    (window as unknown as { __written: number[][] }).__written = written;
    (window as unknown as { __prints: number }).__prints = 0;
    window.print = () => {
      (window as unknown as { __prints: number }).__prints += 1;
    };
    const port = {
      getInfo: () => ({}),
      open: async () => {
        if (refuse) throw new Error("not reachable");
      },
      close: async () => undefined,
      writable: new WritableStream<Uint8Array>({
        write(chunk) {
          written.push(Array.from(chunk));
        },
      }),
    };
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        requestPort: async () => port,
        getPorts: async () => [port],
      },
    });
  }, options.refuse ?? false);
}

const written = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __written: number[][] }).__written.flat(),
  );

/** Where a GS v 0 raster command starts, and the bytes-per-row it declares. */
function rasterHeader(bytes: number[]) {
  for (let i = 0; i < bytes.length - 8; i++)
    if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30)
      return { at: i, rowBytes: bytes[i + 4] + bytes[i + 5] * 256 };
  return null;
}

async function sellOne(page: Page) {
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  await page.getByTestId("complete-sale").click();
  await expect(page.locator("#print-receipt")).toBeVisible();
}

test("setup then Test print: the receipt goes out as a 58 mm black-and-white picture, no print window", async ({
  page,
}, testInfo) => {
  await fakePrinter(page);
  await signUp(page, `prn${Date.now()}${testInfo.project.name}`);
  await page.goto("/settings/printer");
  await page.getByTestId("kind-58mm").click();
  await page.getByTestId("way-serial").click();
  await expect(page.getByTestId("printer-status")).toContainText("৫৮");
  await page.getByTestId("printer-test").click();
  await expect(page.getByTestId("printer-message")).toContainText("পাঠানো হয়েছে");

  const bytes = await written(page);
  // Reset first, the cut last.
  expect(bytes.slice(0, 2)).toEqual([0x1b, 0x40]);
  expect(bytes.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]);
  // 58 mm = 384 dots = 48 bytes a row.
  expect(rasterHeader(bytes)?.rowBytes).toBe(48);
  // It really has ink on it (Bangla included), and is more than blank paper.
  const ink = bytes.filter((b) => b !== 0 && b !== 0xff).length;
  expect(bytes.length).toBeGreaterThan(2000);
  expect(ink).toBeGreaterThan(50);
  // The normal print window was not used.
  expect(
    await page.evaluate(
      () => (window as unknown as { __prints: number }).__prints,
    ),
  ).toBe(0);
  // A copy for trying on a real printer (see the printing notes), only when asked for.
  if (process.env.PRINT_DUMP && testInfo.project.name === "desktop")
    fs.writeFileSync(process.env.PRINT_DUMP, Buffer.from(bytes));
});

test("after a sale, one tap prints the real receipt at 80 mm", async ({
  page,
}, testInfo) => {
  await fakePrinter(page);
  await signUp(page, `prn2${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "10",
  });
  await page.goto("/settings/printer");
  await page.getByTestId("kind-80mm").click();
  await page.getByTestId("way-serial").click();

  await sellOne(page);
  await page.getByTestId("print-receipt").click();
  await expect(page.getByText("প্রিন্টারে পাঠানো হয়েছে")).toBeVisible();
  const bytes = await written(page);
  expect(rasterHeader(bytes)?.rowBytes).toBe(72); // 576 dots
  expect(bytes.slice(0, 2)).toEqual([0x1b, 0x40]);
  // One tap, no problem window.
  await expect(page.getByTestId("print-problem")).toHaveCount(0);
});

test("when the printer cannot be reached the person is told in plain words and can retry, share or use the print window", async ({
  page,
}, testInfo) => {
  await fakePrinter(page, { refuse: true });
  await signUp(page, `prn3${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "10",
  });
  await page.goto("/settings/printer");
  await page.getByTestId("kind-58mm").click();
  await page.getByTestId("way-serial").click();

  await sellOne(page);
  await page.getByTestId("print-receipt").click();
  const problem = page.getByTestId("print-problem");
  await expect(problem).toContainText("প্রিন্টারের সাথে যোগাযোগ হয়নি");
  await expect(problem).toContainText("প্রিন্টার চালু আছে?");
  await expect(page.getByTestId("print-retry")).toBeVisible();
  await expect(problem.getByTestId("share-receipt")).toBeVisible();
  // The normal print window is the way out.
  await page.getByTestId("print-system").click();
  expect(
    await page.evaluate(
      () => (window as unknown as { __prints: number }).__prints,
    ),
  ).toBe(1);
  // The sale itself is saved either way.
  await page.goto("/sales");
  await expect(page.getByTestId("sale-row")).toHaveCount(1);
});

test("with no printer chosen yet, Print asks to set one up (or use the print window)", async ({
  page,
}, testInfo) => {
  await fakePrinter(page);
  await signUp(page, `prn4${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "10",
  });
  await sellOne(page);
  await page.getByTestId("print-receipt").click();
  await expect(page.getByTestId("print-problem")).toContainText(
    "প্রিন্টার একবার বেছে নিন",
  );
  await page.getByTestId("print-go-setup").click();
  await expect(page).toHaveURL(/\/settings\/printer$/);
});

test("A4 paper uses the normal print window", async ({ page }, testInfo) => {
  await fakePrinter(page);
  await signUp(page, `prn5${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "10",
  });
  await page.goto("/settings/printer");
  await page.getByTestId("kind-a4").click();
  await expect(page.getByTestId("printer-status")).toContainText(
    "সাধারণ প্রিন্ট উইন্ডো",
  );
  await sellOne(page);
  await page.getByTestId("print-receipt").click();
  expect(
    await page.evaluate(
      () => (window as unknown as { __prints: number }).__prints,
    ),
  ).toBe(1);
  expect(await written(page)).toHaveLength(0);
});

test("auto-print sends the receipt right after the sale, without pressing Print", async ({
  page,
}, testInfo) => {
  await fakePrinter(page);
  await signUp(page, `prn6${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "10",
  });
  await page.goto("/settings/printer");
  await page.getByTestId("kind-58mm").click();
  await page.getByTestId("way-serial").click();
  await page.getByTestId("auto-print").click();
  await sellOne(page);
  await expect(page.getByText("প্রিন্টারে পাঠানো হয়েছে")).toBeVisible();
  expect((await written(page)).length).toBeGreaterThan(2000);
});
