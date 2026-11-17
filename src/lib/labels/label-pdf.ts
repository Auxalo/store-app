import type { Bitmap } from "../print/escpos";

/** A picture placed on a page; everything in mm, measured from the page's top left corner. */
export interface PdfPlacement {
  /** Index into the pictures given to `makePdf`. */
  image: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfPage {
  /** Page size in mm. */
  w: number;
  h: number;
  place: PdfPlacement[];
  /** Thin dashed grey boxes to cut along (mm, from the top left). */
  cuts?: Array<{ x: number; y: number; w: number; h: number }>;
}

const PT_PER_MM = 72 / 25.4;
const enc = new TextEncoder();
const n = (v: number) => {
  const s = (v * PT_PER_MM).toFixed(3);
  return s.replace(/\.?0+$/, "") || "0";
};

/** zlib-deflated bytes (what a PDF's FlateDecode reads), or null when the browser cannot compress. */
async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A PDF of black-and-white pictures (printer dots: 1 = black) placed on pages. Each picture is
 * stored once however often it is placed, so a thousand copies of one label stay a small file.
 * The dots are kept as they are (no smoothing), so the bars stay sharp and scan.
 */
export async function makePdf(
  images: Bitmap[],
  pages: PdfPage[],
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: Array<Uint8Array | string>) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    for (const b of body) push(b);
    push("\nendobj\n");
  };

  // 1: catalog, 2: page tree, then the pictures, then a page and its drawing for each page.
  const firstImage = 3;
  const firstPage = firstImage + images.length;
  const pageId = (i: number) => firstPage + i * 2;

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  object(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  object(2, [
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages
      .map((_, i) => `${pageId(i)} 0 R`)
      .join(" ")}] >>`,
  ]);

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const packed = await deflate(img.data);
    const data = packed ?? img.data;
    object(firstImage + i, [
      `<< /Type /XObject /Subtype /Image /Width ${img.widthPx} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 1 /Decode [1 0] /Interpolate false${
        packed ? " /Filter /FlateDecode" : ""
      } /Length ${data.length} >>\nstream\n`,
      data,
      "\nendstream",
    ]);
  }

  const xobjects = images
    .map((_, i) => `/Im${i} ${firstImage + i} 0 R`)
    .join(" ");
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    const ops: string[] = [];
    for (const pl of page.place)
      ops.push(
        `q ${n(pl.w)} 0 0 ${n(pl.h)} ${n(pl.x)} ${n(page.h - pl.y - pl.h)} cm /Im${pl.image} Do Q`,
      );
    if (page.cuts?.length) {
      ops.push("q 0.47 G 0.57 w [2 2] 0 d");
      for (const c of page.cuts)
        ops.push(`${n(c.x)} ${n(page.h - c.y - c.h)} ${n(c.w)} ${n(c.h)} re S`);
      ops.push("Q");
    }
    const content = enc.encode(ops.join("\n"));
    object(pageId(p), [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.w)} ${n(page.h)}] /Resources << /XObject << ${xobjects} >> >> /Contents ${pageId(p) + 1} 0 R >>`,
    ]);
    object(pageId(p) + 1, [
      `<< /Length ${content.length} >>\nstream\n`,
      content,
      "\nendstream",
    ]);
  }

  const count = firstPage + pages.length * 2;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++)
    push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(
    `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );

  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Hands the PDF to the browser as a download. */
export function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
