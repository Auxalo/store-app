/**
 * Printing through the computer's own print window (a printer installed in Windows, A4, iPhone).
 *
 * The receipt is not printed where it sits on the page. Printing the page itself went wrong:
 * - a receipt inside a dialog (right after a sale) is "fixed" on the screen, and Chrome prints a
 *   fixed element on every page, so a long page behind it printed the receipt twice;
 * - a receipt inside the page (an old sale) was placed against its own column, not the paper, and
 *   stretched to the page width, so its edges fell off the printable part of the roll.
 *
 * Instead the receipt is put into its own spot, `#print-root`, right under <body>, and while that
 * prints everything else is left out (globals.css, `html.th-print-root`). There it is alone, at the
 * top of the paper, once.
 *
 * On a receipt printer (58 / 80 mm) it is printed as a picture: the same black-and-white picture
 * Bluetooth printers get (render-receipt.ts), exactly as wide as the part of the roll the printer
 * can print (48 / 72 mm), and centred. So it is bold and readable, Bangla included, and nothing is
 * cut off whatever paper width the printer's driver says. A4 prints the receipt's page layout.
 */

const ROOT_ID = "print-root";
/** On <html> while #print-root is what prints. */
export const PRINT_ROOT_CLASS = "th-print-root";

function printRoot(): HTMLElement {
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("aria-hidden", "true");
    document.body.append(root);
  }
  return root;
}

/**
 * Prints what is in #print-root. Stays set until the print window is done ("afterprint"), not
 * just until window.print() returns: the root is never emptied early, so the print cannot come
 * out blank. A later print replaces the root's content.
 */
function printRootNow(after?: () => void) {
  const html = document.documentElement;
  html.classList.add(PRINT_ROOT_CLASS);
  const done = () => {
    html.classList.remove(PRINT_ROOT_CLASS);
    window.removeEventListener("afterprint", done);
    after?.();
  };
  window.addEventListener("afterprint", done);
  window.print();
}

/**
 * Prints a picture of the receipt, `widthMm` wide and centred on paper `paperMm` wide, with no page
 * margins (no date / web address header or footer in the print). The spot is given the paper
 * width: with no width Chrome left the picture out of the print, and against the left edge it
 * falls on the part of the roll the printer cannot print. A driver whose paper is narrower than
 * that (only the printable part) gets it slightly scaled down, never cut off.
 */
export async function printImageInWindow(
  src: string,
  widthMm: number,
  paperMm: number,
) {
  const root = printRoot();
  root.style.width = `${paperMm}mm`;
  const page = document.createElement("style");
  page.textContent = "@page { margin: 0; }";
  const img = document.createElement("img");
  img.className = "print-root-img";
  img.alt = "";
  img.style.width = `${widthMm}mm`;
  img.src = src;
  root.replaceChildren(page, img);
  // Never print before the picture is ready and drawn (off the screen): Chrome leaves a picture that
  // was never drawn out of the print.
  await img.decode().catch(() => undefined);
  await new Promise((done) =>
    requestAnimationFrame(() => requestAnimationFrame(done)),
  );
  printRootNow();
}

/**
 * Prints the receipt shown on the page (the element with id "print-receipt"), on its own. When
 * there is none, the page is printed as before.
 */
export function printPageReceiptInWindow() {
  const shown = document.getElementById("print-receipt");
  if (!shown) {
    window.print();
    return;
  }
  const root = printRoot();
  root.style.width = "";
  root.replaceChildren(shown.cloneNode(true));
  printRootNow();
}

/** Most labels one print may hold (a print window with thousands of pages freezes the browser). */
export const MAX_LABELS_PER_PRINT = 1000;

/**
 * Prints stickers through the print window: one page per label, each page exactly `w` x `h` mm
 * (the page size is set to the label), with no margins. `labels` are pictures drawn to the label's
 * own size (src/lib/labels/render-label.ts); each is printed `copies` times.
 *
 * Unlike a receipt, the spot is emptied when the print window is done: a leftover "@page" of
 * label size would otherwise stay in the page.
 */
export async function printLabelsInWindow(
  labels: Array<{ src: string; copies: number }>,
  size: { w: number; h: number },
) {
  const root = printRoot();
  root.style.width = `${size.w}mm`;
  const page = document.createElement("style");
  page.textContent = `@page { size: ${size.w}mm ${size.h}mm; margin: 0; }`;
  const nodes: HTMLElement[] = [page];
  const images: HTMLImageElement[] = [];
  let total = 0;
  for (const label of labels) {
    for (let i = 0; i < label.copies && total < MAX_LABELS_PER_PRINT; i++) {
      const box = document.createElement("div");
      box.className = "print-label";
      box.style.width = `${size.w}mm`;
      box.style.height = `${size.h}mm`;
      const img = document.createElement("img");
      img.alt = "";
      img.src = label.src;
      images.push(img);
      box.append(img);
      nodes.push(box);
      total++;
    }
  }
  root.replaceChildren(...nodes);
  await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
  await new Promise((done) =>
    requestAnimationFrame(() => requestAnimationFrame(done)),
  );
  printRootNow(() => root.replaceChildren());
  return total;
}
