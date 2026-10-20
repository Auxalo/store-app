import { chunks } from "./escpos";

/** How the receipt reaches the printer. "system" is the phone's / PC's own print window. */
export type PrintVia = "serial" | "ble" | "rawbt" | "system";

export type PrintFailure =
  | "UNSUPPORTED" // this browser cannot do it
  | "NOT_CHOSEN" // no printer has been chosen on this device yet
  | "CANCELLED" // the person closed the chooser
  | "CONNECT" // could not reach the printer (off, away, Bluetooth off)
  | "WRITE"; // reached it, but sending failed (out of paper, link dropped)

export class PrintError extends Error {
  constructor(
    public readonly code: PrintFailure,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

// ---- the browser's serial and Bluetooth interfaces (not in TypeScript's own typings) ----

interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
  getInfo(): {
    usbVendorId?: number;
    usbProductId?: number;
    bluetoothServiceClassId?: number | string;
  };
}
interface SerialLike {
  requestPort(options?: unknown): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}
interface GattCharacteristicLike {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  writeValue?(value: BufferSource): Promise<void>;
}
interface GattServiceLike {
  getCharacteristics(): Promise<GattCharacteristicLike[]>;
}
interface GattServerLike {
  connected: boolean;
  getPrimaryServices(): Promise<GattServiceLike[]>;
  disconnect(): void;
}
interface BluetoothDeviceLike {
  id: string;
  name?: string;
  gatt?: { connect(): Promise<GattServerLike> };
}
interface BluetoothLike {
  requestDevice(options: unknown): Promise<BluetoothDeviceLike>;
  getDevices?(): Promise<BluetoothDeviceLike[]>;
}

const nav = () =>
  (typeof navigator === "undefined" ? {} : navigator) as {
    serial?: SerialLike;
    bluetooth?: BluetoothLike;
    userAgent?: string;
  };

/** Serial Port Profile: what "classic" Bluetooth receipt printers speak. */
const SPP = "00001101-0000-1000-8000-00805f9b34fb";
/** Service ids the cheap Bluetooth Low Energy receipt printers are known to use. */
const BLE_SERVICES = [
  0x18f0,
  0xff00,
  0xffe0,
  0xfee7,
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "000018f0-0000-1000-8000-00805f9b34fb",
];

export const RAWBT_PLAY_URL =
  "https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter";

/** What this browser can do (decides which choices the setup screen offers). */
export function printSupport() {
  const ua = nav().userAgent ?? "";
  return {
    serial: !!nav().serial,
    ble: !!nav().bluetooth,
    android: /Android/i.test(ua),
    ios: /iPhone|iPad|iPod/i.test(ua),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- serial: a Bluetooth COM port or USB printer on a PC, Bluetooth serial on Android Chrome ----

/** Opens the browser's chooser (needs a tap). Returns the name to show. */
export async function chooseSerial(): Promise<{ name: string }> {
  const serial = nav().serial;
  if (!serial) throw new PrintError("UNSUPPORTED");
  const android = printSupport().android;
  try {
    // On a phone, list Bluetooth printers (Serial Port Profile); on a PC, list every port.
    const port = await serial.requestPort(
      android
        ? {
            filters: [{ bluetoothServiceClassId: SPP }],
            allowedBluetoothServiceClassIds: [SPP],
          }
        : undefined,
    );
    const info = port.getInfo();
    return {
      name: info.usbVendorId
        ? "USB"
        : android
          ? "Bluetooth"
          : "Bluetooth / COM",
    };
  } catch (error) {
    if ((error as Error).name === "NotFoundError")
      throw new PrintError("CANCELLED");
    throw new PrintError("CONNECT", (error as Error).message);
  }
}

async function sendSerial(bytes: Uint8Array) {
  const serial = nav().serial;
  if (!serial) throw new PrintError("UNSUPPORTED");
  const ports = await serial.getPorts();
  // The browser remembers the ports the person allowed. Several can be remembered (a phone's
  // Bluetooth list, a PC's COM3 and COM4): the most recently chosen one is last.
  const port = ports[ports.length - 1];
  if (!port) throw new PrintError("NOT_CHOSEN");
  try {
    await port.open({ baudRate: 115200 });
  } catch (error) {
    throw new PrintError("CONNECT", (error as Error).message);
  }
  try {
    if (!port.writable) throw new PrintError("CONNECT", "not writable");
    const writer = port.writable.getWriter();
    try {
      for (const part of chunks(bytes, 512)) {
        await writer.write(part);
        await sleep(25);
      }
      // Let the printer take the last bytes before the link is closed.
      await sleep(400);
    } finally {
      writer.releaseLock();
    }
  } catch (error) {
    if (error instanceof PrintError) throw error;
    throw new PrintError("WRITE", (error as Error).message);
  } finally {
    await port.close().catch(() => undefined);
  }
}

// ---- Bluetooth Low Energy ----

let chosenBle: BluetoothDeviceLike | null = null;

export async function chooseBle(): Promise<{ name: string; id: string }> {
  const bluetooth = nav().bluetooth;
  if (!bluetooth) throw new PrintError("UNSUPPORTED");
  try {
    chosenBle = await bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLE_SERVICES,
    });
    return { name: chosenBle.name ?? "Bluetooth", id: chosenBle.id };
  } catch (error) {
    if ((error as Error).name === "NotFoundError")
      throw new PrintError("CANCELLED");
    throw new PrintError("CONNECT", (error as Error).message);
  }
}

async function sendBle(bytes: Uint8Array, id?: string) {
  const bluetooth = nav().bluetooth;
  if (!bluetooth) throw new PrintError("UNSUPPORTED");
  let device = chosenBle && (!id || chosenBle.id === id) ? chosenBle : null;
  if (!device && bluetooth.getDevices) {
    const known = await bluetooth.getDevices().catch(() => []);
    device = known.find((d) => d.id === id) ?? known[0] ?? null;
  }
  if (!device?.gatt) throw new PrintError("NOT_CHOSEN");
  let server: GattServerLike;
  try {
    server = await device.gatt.connect();
  } catch (error) {
    throw new PrintError("CONNECT", (error as Error).message);
  }
  try {
    let target: GattCharacteristicLike | null = null;
    for (const service of await server.getPrimaryServices()) {
      for (const c of await service.getCharacteristics()) {
        if (c.properties.write || c.properties.writeWithoutResponse) {
          target = c;
          break;
        }
      }
      if (target) break;
    }
    if (!target) throw new PrintError("CONNECT", "no writable channel");
    for (const part of chunks(bytes, 180)) {
      const view = new Uint8Array(part);
      if (
        target.properties.writeWithoutResponse &&
        target.writeValueWithoutResponse
      )
        await target.writeValueWithoutResponse(view);
      else if (target.writeValueWithResponse)
        await target.writeValueWithResponse(view);
      else await target.writeValue?.(view);
      await sleep(30);
    }
    await sleep(400);
  } catch (error) {
    if (error instanceof PrintError) throw error;
    throw new PrintError("WRITE", (error as Error).message);
  } finally {
    server.disconnect();
  }
}

// ---- RawBT (Android): hands the job to the free RawBT app, which owns the Bluetooth link ----

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const part of chunks(bytes, 0x8000))
    binary += String.fromCharCode(...part);
  return btoa(binary);
}

function sendRawBt(bytes: Uint8Array) {
  // RawBT registers the "rawbt:" address; opening it passes the bytes to the app.
  window.location.href = `rawbt:base64,${toBase64(bytes)}`;
}

/** The printer chosen on this device (kept in the device's preferences). */
export interface SavedPrinter {
  via: PrintVia;
  /** Shown to people ("Bluetooth", a Bluetooth device's name ...). */
  name?: string;
  /** A Bluetooth Low Energy device's id, to find it again. */
  id?: string;
}

/** Sends the finished ESC/POS job to the printer. Throws a PrintError. */
export async function sendToPrinter(printer: SavedPrinter, bytes: Uint8Array) {
  switch (printer.via) {
    case "serial":
      return sendSerial(bytes);
    case "ble":
      return sendBle(bytes, printer.id);
    case "rawbt":
      return sendRawBt(bytes);
    default:
      throw new PrintError("UNSUPPORTED");
  }
}
