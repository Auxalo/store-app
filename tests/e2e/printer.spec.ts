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
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __prints: number }).__prints),
    )
    .toBe(1);
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
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __prints: number }).__prints),
    )
    .toBe(1);
  expect(await written(page)).toHaveLength(0);
  // The receipt is printed on its own (a copy in the print spot), so a dialog prints it once.
  await expect(page.locator("#print-root #print-receipt")).toHaveCount(1);
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

test("a customer's payment slip: this payment and what is still due, then an advance; it prints in one tap", async ({
  page,
}, testInfo) => {
  await fakePrinter(page);
  await signUp(page, `prn7${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "10",
  });
  await page.goto("/settings/printer");
  await page.getByTestId("kind-58mm").click();
  await page.getByTestId("way-serial").click();

  // A credit sale of ৳50 to a new customer: ৳50 is owed.
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  await cart.getByTestId("received-input").fill("0");
  await cart.getByTestId("customer-button").click();
  await page.getByRole("button", { name: "নতুন ক্রেতা" }).click();
  await page.getByLabel("নাম", { exact: true }).fill("রহিম");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await cart.getByTestId("complete-sale").click();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  // No payment yet, so no "last payment" slip.
  await page.goto("/customers");
  await page.getByTestId("party-row").filter({ hasText: "রহিম" }).click();
  await expect(page.getByTestId("last-payment-slip")).toHaveCount(0);

  // The customer pays ৳20: the slip opens with the payment and ৳30 still due.
  await page.getByTestId("record-payment").click();
  await page.getByTestId("payment-amount").fill("20");
  await page.getByTestId("save-payment").click();
  const paper = page.getByTestId("slip-paper");
  await expect(paper).toContainText("পেমেন্ট রসিদ");
  await expect(paper).toContainText("রহিম");
  await expect(paper).toContainText("৳২০.০০");
  const standing = page.getByTestId("slip-standing");
  await expect(standing).toContainText("আগের জের");
  await expect(standing).toContainText("এখন বাকি");
  await expect(standing).toContainText("৳৩০.০০");

  // One tap sends it to the printer as a 58 mm picture.
  await page.getByTestId("print-receipt").click();
  await expect(page.getByText("প্রিন্টারে পাঠানো হয়েছে")).toBeVisible();
  const bytes = await written(page);
  expect(rasterHeader(bytes)?.rowBytes).toBe(48);
  expect(bytes.length).toBeGreaterThan(1500);
  await page.getByTestId("slip-close").click();

  // Later, the customer pays ৳100 (৳70 more than owed): the slip for the last payment shows an advance.
  await page.getByTestId("record-payment").click();
  await page.getByTestId("payment-amount").fill("100");
  await page.getByTestId("save-payment").click();
  await expect(page.getByTestId("slip-standing")).toContainText("জমা");
  await expect(page.getByTestId("slip-standing")).toContainText("৳৭০.০০");
  await page.getByTestId("slip-close").click();

  // Any earlier payment can be printed again from the statement, and the card has a last-payment button.
  await expect(page.getByTestId("payment-slip")).toHaveCount(2);
  await page.getByTestId("payment-slip").last().click();
  await expect(page.getByTestId("slip-paper")).toContainText("৳২০.০০");
  await page.getByTestId("slip-close").click();
  await page.getByTestId("last-payment-slip").click();
  await expect(page.getByTestId("slip-paper")).toContainText("৳১০০.০০");
  await expect(page.getByTestId("slip-standing")).toContainText("৳৭০.০০");
});

/** A fake USB receipt printer (Android with an OTG cable): records what the app sends. */
async function fakeUsbPrinter(page: Page, options: { blocked?: boolean } = {}) {
  await page.addInitScript((blocked) => {
    const written: number[][] = [];
    (window as unknown as { __usbWritten: number[][] }).__usbWritten = written;
    const config = {
      configurationValue: 1,
      interfaces: [
        {
          interfaceNumber: 0,
          alternates: [
            {
              alternateSetting: 0,
              interfaceClass: 7,
              endpoints: [
                { endpointNumber: 1, direction: "out", type: "bulk" },
              ],
            },
          ],
        },
      ],
    };
    const device = {
      vendorId: 0x0416,
      productId: 0x5011,
      serialNumber: "P1",
      manufacturerName: "POS",
      productName: "58 Printer",
      opened: false,
      configuration: null as typeof config | null,
      configurations: [config],
      async open() {
        device.opened = true;
      },
      async close() {
        device.opened = false;
      },
      async selectConfiguration() {
        device.configuration = config;
      },
      async claimInterface() {
        if (!blocked) return;
        const error = new Error("Unable to claim interface.");
        error.name = "NetworkError";
        throw error;
      },
      async releaseInterface() {},
      async selectAlternateInterface() {},
      async transferOut(_endpoint: number, data: Uint8Array) {
        written.push(Array.from(data));
        return { status: "ok" };
      },
    };
    Object.defineProperty(navigator, "usb", {
      configurable: true,
      value: {
        requestDevice: async () => device,
        getDevices: async () => [device],
      },
    });
  }, options.blocked ?? false);
}

test("the choices grow with their text: nothing spills out of a button, on phone and computer", async ({
  page,
}, testInfo) => {
  await fakePrinter(page);
  await signUp(page, `prn8${Date.now()}${testInfo.project.name}`);
  await page.goto("/settings/printer");
  await page.getByTestId("kind-80mm").click();
  await expect(page.getByTestId("way-system")).toBeVisible();
  const spilled = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid^="way-"], [data-testid^="kind-"]',
      ),
    ]
      .filter(
        (el) =>
          el.scrollHeight > el.clientHeight + 1 ||
          el.scrollWidth > el.clientWidth + 1,
      )
      .map((el) => el.getAttribute("data-testid")),
  );
  expect(spilled).toEqual([]);
});

test("on a phone, a USB (OTG) printer is chosen once and Test print sends the receipt over USB", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "a phone");
  await fakePrinter(page);
  await fakeUsbPrinter(page);
  await signUp(page, `prn9${Date.now()}${testInfo.project.name}`);
  await page.goto("/settings/printer");
  await page.getByTestId("kind-58mm").click();
  await page.getByTestId("way-usb").click();
  await expect(page.getByTestId("printer-status")).toContainText("58 Printer");
  await page.getByTestId("printer-test").click();
  await expect(page.getByTestId("printer-message")).toContainText("পাঠানো হয়েছে");
  const bytes = await page.evaluate(() =>
    (window as unknown as { __usbWritten: number[][] }).__usbWritten.flat(),
  );
  expect(bytes.slice(0, 2)).toEqual([0x1b, 0x40]);
  expect(rasterHeader(bytes)?.rowBytes).toBe(48);
  expect(bytes.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]);
});

test("a USB printer held by the system's own printing is explained at setup, not at the first sale", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "a phone");
  await fakeUsbPrinter(page, { blocked: true });
  await signUp(page, `prn10${Date.now()}${testInfo.project.name}`);
  await page.goto("/settings/printer");
  await page.getByTestId("kind-58mm").click();
  await page.getByTestId("way-usb").click();
  await expect(page.getByTestId("printer-message")).toContainText("ধরে রেখেছে");
  await expect(page.getByTestId("printer-status")).toContainText(
    "এখনো কোনো প্রিন্টার বাছা হয়নি",
  );
});

test.describe("a Windows PC with a USB receipt printer", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });

  test("USB cable comes first and prints through Windows; the one-time setup gives a file and a line to paste", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "a computer");
    await fakePrinter(page);
    await signUp(page, `prn11${Date.now()}${testInfo.project.name}`);
    await page.goto("/settings/printer");
    await page.getByTestId("kind-80mm").click();
    const ways = page
      .getByTestId("printer-ways")
      .locator('[data-testid^="way-"]');
    await expect(ways.first()).toHaveAttribute("data-testid", "way-windows");
    await expect(ways.first()).toContainText("প্রস্তাবিত");
    // A Windows printer is not reached through the browser's USB access.
    await expect(page.getByTestId("way-usb")).toHaveCount(0);

    await page.getByTestId("way-windows").click();
    await expect(page.getByTestId("printer-status")).toContainText(
      "এই কম্পিউটারের প্রিন্টার",
    );
    const guide = page.getByTestId("windows-onetap");
    await expect(guide).toBeVisible();

    // The setup file: makes the icon that opens this app with no print window, 80 mm already set.
    const download = page.waitForEvent("download");
    await page.getByTestId("onetap-download").click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("Trade-Hishab-printer-setup.bat");
    const text = fs.readFileSync(await file.path(), "utf8");
    expect(text).toContain("--kiosk-printing");
    // The printer is proved with a test paper; nobody picks from a list of printers.
    expect(text).toContain("Printer test: OK");
    expect(text).not.toContain("set /p");
    expect(text).toMatch(/set "TH_URL=http:\/\/[^"]+\/pos#onetap-80mm"/);
    expect(text).toContain("\r\n");

    // Or by hand.
    await guide.getByText("অথবা নিজে হাতে করুন").click();
    await expect(page.getByTestId("onetap-line")).toContainText(
      "--kiosk-printing",
    );

    // Test print uses the print window, with the test receipt on the page for it.
    await page.getByTestId("printer-test").click();
    await expect(page.getByTestId("printer-message")).toContainText(
      "এককালীন সেটআপ",
    );
    expect(
      await page.evaluate(
        () => (window as unknown as { __prints: number }).__prints,
      ),
    ).toBe(1);
    await expect(page.locator("#print-receipt")).toContainText("TEST-0001");
    expect(await written(page)).toHaveLength(0);
  });

  test("the desktop icon's address sets the printer in its new browser profile", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "a computer");
    await fakePrinter(page);
    await signUp(page, `prn12${Date.now()}${testInfo.project.name}`);
    await page.goto("/pos#onetap-58mm");
    await expect(page).toHaveURL(/\/pos$/);
    await page.goto("/settings/printer");
    await expect(page.getByTestId("printer-status")).toContainText("৫৮");
    await expect(page.getByTestId("printer-status")).toContainText(
      "এই কম্পিউটারের প্রিন্টার",
    );
    await expect(page.getByTestId("way-windows")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

/** What the print window would print right now: pages in an 80 mm roll PDF, and the receipt picture. */
async function printedNow(page: Page) {
  await page.emulateMedia({ media: "print" });
  const picture = await page.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>(
      "#print-root img.print-root-img",
    );
    // Everything else on the page is left out of the print.
    const dialog = document.querySelector('[role="dialog"]');
    const r = img?.getBoundingClientRect();
    // The spot is as wide as the paper; the picture sits centred in it.
    const box = document.getElementById("print-root")?.getBoundingClientRect();
    return {
      src: img?.getAttribute("src")?.slice(0, 22) ?? null,
      width: img?.style.width ?? null,
      natural: img?.naturalWidth ?? 0,
      left: r && box ? r.left - box.left : -1,
      right: r && box ? box.right - r.right : -1,
      paperWidth: document.getElementById("print-root")?.style.width ?? null,
      dialogShown: dialog ? dialog.getClientRects().length > 0 : false,
      active: document.documentElement.classList.contains("th-print-root"),
    };
  });
  await page.emulateMedia({ media: null });
  // Last: making a PDF fires the browser's own "print done" event.
  const pdf = await page.pdf({ width: "80mm", height: "297mm" });
  // (the spot is the paper width; the picture is centred in it)
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [])
    .length;
  // The picture really is in the print (Chrome leaves out a picture never drawn on the screen).
  const images = (pdf.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? [])
    .length;
  return { pages, images, ...picture };
}

test.describe("through the print window (a printer installed in Windows)", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });

  test("a receipt prints once, as a sharp 72 mm picture centred on the roll: after a sale and from an old sale", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "a computer");
    test.setTimeout(180_000);
    await fakePrinter(page);
    await signUp(page, `prn13${Date.now()}${testInfo.project.name}`);
    await createProduct(page, {
      name: "ফ্রেশ দুধ",
      price: "50",
      cost: "40",
      stock: "10",
    });
    await page.goto("/settings/printer");
    await page.getByTestId("kind-80mm").click();
    await page.getByTestId("way-windows").click();

    // Right after a sale (the receipt is in a dialog): one page, the picture only.
    await sellOne(page);
    await page.getByTestId("print-receipt").click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __prints: number }).__prints,
        ),
      )
      .toBe(1);
    const afterSale = await printedNow(page);
    expect(afterSale).toMatchObject({
      pages: 1,
      images: 1,
      src: "data:image/png;base64,",
      width: "72mm",
      paperWidth: "80mm",
      natural: 576,
      dialogShown: false,
      active: true,
    });
    // Centred, so nothing falls off either edge.
    expect(Math.abs(afterSale.left - afterSale.right)).toBeLessThan(2);
    // Nothing went to a direct (Bluetooth / USB) printer.
    expect(await written(page)).toHaveLength(0);
    await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

    // An old sale (the receipt is in the page): the same.
    await page.goto("/sales");
    await page.getByTestId("sale-row").first().click();
    await page.getByTestId("print-receipt").click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __prints: number }).__prints,
        ),
      )
      .toBe(1); // a new page load counts from 0
    const oldSale = await printedNow(page);
    expect(oldSale).toMatchObject({
      pages: 1,
      images: 1,
      width: "72mm",
      natural: 576,
      active: true,
    });
    expect(Math.abs(oldSale.left - oldSale.right)).toBeLessThan(2);

    // Once the print window is done (making the PDF counts), the page prints as a page again.
    expect(
      await page.evaluate(() =>
        document.documentElement.classList.contains("th-print-root"),
      ),
    ).toBe(false);
  });
});
