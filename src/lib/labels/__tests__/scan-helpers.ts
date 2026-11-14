import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from "@zxing/library";

/** A black-and-white picture of the bars, with blank space round it, as luminance values. */ export function barsImage(
  modules: string,
  quiet: number,
  scale: number,
  height = 60,
) {
  const width = (modules.length + quiet * 2) * scale;
  const data = new Uint8ClampedArray(width * height).fill(255);
  for (let m = 0; m < modules.length; m++) {
    if (modules[m] !== "1") continue;
    for (let y = 0; y < height; y++)
      for (let s = 0; s < scale; s++)
        data[y * width + (quiet + m) * scale + s] = 0;
  }
  return { data, width, height };
}

/** What a scanner would read from the picture, or null when it can not. */
export function scan(img: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}) {
  const reader = new MultiFormatReader();
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.UPC_A,
    BarcodeFormat.EAN_8,
    BarcodeFormat.CODE_128,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);
  try {
    const source = new RGBLuminanceSource(img.data, img.width, img.height);
    const result = reader.decode(new BinaryBitmap(new HybridBinarizer(source)));
    return {
      text: result.getText(),
      format: BarcodeFormat[result.getBarcodeFormat()],
    };
  } catch {
    return null;
  }
}
