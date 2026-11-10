import { describe, expect, it } from "vitest";
import {
  appStartUrl,
  oneTapHash,
  oneTapPaperFromHash,
  safeUrl,
  setupScript,
  shortcutLine,
} from "../windows-setup";

const URL_80 = appStartUrl("https://app.hishab.trade", "80mm");

describe("Windows one-tap printing setup", () => {
  it("opens the selling counter with the paper marked in the address", () => {
    expect(URL_80).toBe("https://app.hishab.trade/pos#onetap-80mm");
    expect(oneTapHash("58mm")).toBe("#onetap-58mm");
    expect(oneTapPaperFromHash("#onetap-80mm")).toBe("80mm");
    expect(oneTapPaperFromHash("#onetap-58mm")).toBe("58mm");
    expect(oneTapPaperFromHash("#onetap-a4")).toBeNull();
    expect(oneTapPaperFromHash("")).toBeNull();
    expect(oneTapPaperFromHash("#x#onetap-80mm")).toBeNull();
  });

  it("only lets a plain web address into the file", () => {
    expect(safeUrl("http://localhost:3000/pos#onetap-58mm")).toBeTruthy();
    for (const bad of [
      "https://a.com/pos&calc",
      "https://a.com/p%PATH%",
      'https://a.com/"x',
      "https://a.com/a b",
      "https://a.com/?x=1",
      "https://a.com/|x",
      "javascript:alert(1)",
      "file:///C:/x",
    ])
      expect(() => safeUrl(bad), bad).toThrow("UNSAFE_URL");
    expect(() => setupScript("https://a.com/x&y")).toThrow();
    expect(() => shortcutLine("https://a.com/x&y")).toThrow();
  });

  it("is a plain Windows batch file: CRLF line ends, ASCII only", () => {
    const bat = setupScript(URL_80);
    expect(bat.startsWith("@echo off\r\n")).toBe(true);
    expect(/[^\r]\n/.test(bat)).toBe(false);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: checking for ASCII only
    expect(/[^\x00-\x7f]/.test(bat)).toBe(false);
    expect(bat).toContain(`set "TH_URL=${URL_80}"`);
    expect(bat).toContain('set "TH_PROFILE=%LOCALAPPDATA%\\TradeHishab"');
  });

  it("passes PowerShell through the batch file untouched: no quotes or percent signs inside", () => {
    const lines = setupScript(URL_80)
      .split("\r\n")
      .filter((l) => l.startsWith("powershell "));
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      const code = line.slice(line.indexOf('"') + 1, -1);
      expect(line.endsWith('"')).toBe(true);
      expect(code).not.toContain('"');
      expect(code).not.toContain("%");
    }
  });

  it("proves the printer with a test paper before changing anything, and never asks to pick from a list", () => {
    const bat = setupScript(URL_80);
    const find = bat
      .split("\r\n")
      .find((l) => l.includes("Read-Host")) as string;
    // Printers that are not paper are never tried; connected ones are tried first.
    expect(find).toContain("PDF|XPS|OneNote|Fax");
    expect(find).toContain("WorkOffline");
    // The printer last used in the browser print window is tried first.
    expect(find).toContain("print_preview_sticky_settings");
    // The test paper is printed by a separate process that is stopped when the printer does not
    // answer (a dead Epson copy waits for ever), and the next printer is tried.
    expect(find).toContain("__test");
    expect(find).toContain("& $run '__test' 15000");
    // So is removing its job: Windows may not answer about a dead printer either.
    expect(find).toContain("& $run '__clean' 5000");
    expect(find).toContain("WaitForExit($ms)");
    expect(find).not.toContain("Remove-PrintJob");
    expect(find).toContain("taskkill /PID $pr.Id /T /F");
    expect(bat).toContain('if "%~1"=="__test" goto testprint');
    expect(bat).toContain("StandardPrintController");
    expect(bat).not.toContain("Out-Printer");
    // The yes/no question, and a stuck test job is removed after a "no".
    expect(find).toContain("Read-Host");
    expect(bat).toContain("Remove-PrintJob");
    // The main printer is set only after the question, and only on a yes.
    expect(find.indexOf("SetDefaultPrinter")).toBeGreaterThan(
      find.indexOf("Read-Host"),
    );
    expect(find.indexOf("exit 3")).toBeLessThan(
      find.indexOf("SetDefaultPrinter"),
    );
    expect(find).toContain("LegacyDefaultPrinterMode");
    // No slip came out: the icon is not made.
    const lines = bat.split("\r\n");
    expect(lines[lines.indexOf(find) + 1]).toBe(
      "if errorlevel 1 goto noprinter",
    );
    expect(bat).not.toContain("set /p");
  });

  it("closes a Trade Hishab window left stuck by an earlier try, and only that one", () => {
    const close = setupScript(URL_80)
      .split("\r\n")
      .find((l) => l.includes("Stop-Process")) as string;
    expect(close).toContain("$env:TH_PROFILE.Length -gt 10");
    expect(close).toContain(
      "$_.CommandLine -like ('*' + $env:TH_PROFILE + '*')",
    );
  });

  it("then makes a desktop icon that prints with no window, in its own profile", () => {
    const bat = setupScript(URL_80);
    expect(bat).toContain("--kiosk-printing");
    expect(bat).toContain("--user-data-dir=");
    expect(bat).toContain("--app=' + $env:TH_URL");
    expect(bat).toContain("'Trade Hishab.lnk'");
    expect(bat).toContain("chrome.exe");
    expect(bat).toContain("msedge.exe");
  });

  it("has the same icon as one line for doing it by hand", () => {
    expect(shortcutLine(URL_80)).toBe(
      'C:\\Windows\\System32\\cmd.exe /c start "" chrome --user-data-dir="%LOCALAPPDATA%\\TradeHishab" --kiosk-printing --no-first-run --no-default-browser-check --app=https://app.hishab.trade/pos#onetap-80mm',
    );
    // Windows' shortcut box takes at most 260 characters.
    expect(shortcutLine(URL_80).length).toBeLessThan(260);
  });
});
