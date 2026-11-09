import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseUsb,
  PrintError,
  printSupport,
  sendToPrinter,
  type UsbDeviceLike,
  usbKey,
  usbOutput,
} from "../transports";

interface FakeOptions {
  /** What claimInterface throws (Windows: the printer driver holds it). */
  claimError?: string;
  /** Interfaces: [class, has a bulk OUT endpoint]. */
  interfaces?: Array<[number, boolean]>;
  serial?: string;
}

function fakeDevice(options: FakeOptions = {}) {
  const writes: number[][] = [];
  const calls: string[] = [];
  const interfaces = (options.interfaces ?? [[7, true]]).map(
    ([interfaceClass, out], n) => ({
      interfaceNumber: n,
      alternates: [
        {
          alternateSetting: 0,
          interfaceClass,
          endpoints: [
            {
              endpointNumber: 1,
              direction: "in" as const,
              type: "bulk" as const,
            },
            ...(out
              ? [
                  {
                    endpointNumber: 2 + n,
                    direction: "out" as const,
                    type: "bulk" as const,
                  },
                ]
              : []),
          ],
        },
      ],
    }),
  );
  const config = { configurationValue: 1, interfaces };
  const device: UsbDeviceLike = {
    vendorId: 0x04b8,
    productId: 0x0e28,
    serialNumber: options.serial ?? "X1",
    manufacturerName: "EPSON",
    productName: "TM-T20III",
    opened: false,
    configuration: null,
    configurations: [config],
    async open() {
      calls.push("open");
      device.opened = true;
    },
    async close() {
      calls.push("close");
      device.opened = false;
    },
    async selectConfiguration(v) {
      calls.push(`config ${v}`);
      device.configuration = config;
    },
    async claimInterface(n) {
      calls.push(`claim ${n}`);
      if (options.claimError) {
        const error = new Error("Unable to claim interface.");
        error.name = options.claimError;
        throw error;
      }
    },
    async releaseInterface(n) {
      calls.push(`release ${n}`);
    },
    async selectAlternateInterface() {},
    async transferOut(endpoint, data) {
      calls.push(`out ${endpoint}`);
      writes.push(Array.from(new Uint8Array(data as ArrayBuffer)));
      return { status: "ok" };
    },
  };
  return { device, writes, calls };
}

function stubUsb(devices: UsbDeviceLike[], picked?: UsbDeviceLike | "cancel") {
  const requestDevice = vi.fn(async (_options: { filters: unknown[] }) => {
    if (picked === "cancel") {
      const error = new Error("No device selected.");
      error.name = "NotFoundError";
      throw error;
    }
    return picked ?? devices[0];
  });
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7)",
    usb: { requestDevice, getDevices: async () => devices },
  });
  return requestDevice;
}

afterEach(() => vi.unstubAllGlobals());

describe("USB receipt printers", () => {
  it("lists printers (USB class 7) and the receipt printer makers, then checks the printer can be used", async () => {
    const { device, calls } = fakeDevice();
    const request = stubUsb([device]);
    const chosen = await chooseUsb();
    expect(chosen).toEqual({ name: "EPSON TM-T20III", id: "4b8:e28:X1" });
    const filters = request.mock.calls[0]?.[0]?.filters as Array<{
      classCode?: number;
      vendorId?: number;
    }>;
    expect(filters).toContainEqual({ classCode: 7 });
    expect(filters).toContainEqual({ vendorId: 0x04b8 });
    // Opened, configured, claimed, then let go again.
    expect(calls).toEqual([
      "open",
      "config 1",
      "claim 0",
      "release 0",
      "close",
    ]);
  });

  it("closing the chooser is not an error to show", async () => {
    stubUsb([], "cancel");
    await expect(chooseUsb()).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("says so at setup when the computer's printer driver holds the printer (Windows)", async () => {
    for (const name of ["SecurityError", "NetworkError"]) {
      const { device, calls } = fakeDevice({ claimError: name });
      stubUsb([device]);
      const error = await chooseUsb().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PrintError);
      expect((error as PrintError).code).toBe("BLOCKED");
      expect(calls.at(-1)).toBe("close");
    }
  });

  it("refuses a USB device that cannot take print data", async () => {
    const { device } = fakeDevice({ interfaces: [[3, false]] });
    stubUsb([device]);
    await expect(chooseUsb()).rejects.toMatchObject({ code: "NO_OUTPUT" });
  });

  it("sends the whole job to the printer interface, in parts, and lets the printer go after", async () => {
    // A vendor-specific interface first, then the printer interface: the printer one is used.
    const other = fakeDevice({ serial: "OTHER" });
    const { device, writes, calls } = fakeDevice({
      interfaces: [
        [0xff, true],
        [7, true],
      ],
    });
    stubUsb([other.device, device]);
    expect(usbOutput(device)).toEqual({ iface: 1, alt: 0, endpoint: 3 });
    const job = Uint8Array.from({ length: 40_000 }, (_, i) => i % 256);
    await sendToPrinter({ via: "usb", id: usbKey(device) }, job);
    expect(writes.flat()).toEqual(Array.from(job));
    expect(writes.length).toBe(3); // 16 KB parts
    expect(other.writes).toHaveLength(0);
    expect(calls.slice(-2)).toEqual(["release 1", "close"]);
  });

  it("asks to choose again when no printer was allowed on this device", async () => {
    stubUsb([]);
    await expect(
      sendToPrinter({ via: "usb", id: "4b8:e28:X1" }, Uint8Array.of(1)),
    ).rejects.toMatchObject({ code: "NOT_CHOSEN" });
  });
});

describe("what this device can do", () => {
  it("knows a Windows PC, where a USB printer prints through Windows", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0",
      usb: {},
      serial: {},
    });
    expect(printSupport()).toMatchObject({
      windows: true,
      android: false,
      usb: true,
      serial: true,
      ble: false,
    });
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/131.0",
    });
    expect(printSupport()).toMatchObject({ windows: false, android: true });
  });
});
