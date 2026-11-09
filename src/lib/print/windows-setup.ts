/**
 * One-tap printing on a Windows PC with a USB receipt printer.
 *
 * Such a printer is installed as a Windows printer, and its driver holds it: a web page cannot
 * reach it directly (it is not a COM port, and USB access is refused). Windows' own printing does
 * work, but shows the print window every time. Chrome and Edge skip that window and print straight
 * to the main (default) printer when started with `--kiosk-printing`.
 *
 * So the setup, done once:
 *  1. make the receipt printer the computer's main printer (and stop Windows from changing it);
 *  2. put a "Trade Hishab" icon on the desktop that opens the app with `--kiosk-printing`, in its
 *     own browser profile. Its own profile is what makes it last: the switch only works when the
 *     browser starts, and an already open Chrome window would otherwise swallow it.
 *
 * Both are done by a small setup file the person downloads and opens (setupScript), or by hand
 * (shortcutLine). Nothing here runs in the browser itself.
 */

import { type OneTapPaper, oneTapHash } from "./one-tap-link";

export type { OneTapPaper } from "./one-tap-link";
export { oneTapHash, oneTapPaperFromHash } from "./one-tap-link";

/** The browser profile folder the desktop icon uses (under %LOCALAPPDATA%). */
export const PROFILE_FOLDER = "TradeHishab";

export const SETUP_FILE_NAME = "Trade-Hishab-printer-setup.bat";

const FLAGS =
  "--kiosk-printing --no-first-run --no-default-browser-check --app=";

/** The page the desktop icon opens: the selling counter, where receipts are printed. */
export const appStartUrl = (origin: string, paper: OneTapPaper) =>
  `${origin}/pos${oneTapHash(paper)}`;

/**
 * Only a plain web address may go into the file: nothing the Windows command line would read as
 * a command or a variable (no spaces, quotes, %, &, =, | ...).
 */
export function safeUrl(url: string): string {
  if (
    !/^https?:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9/_-]*)?(#[A-Za-z0-9-]+)?$/.test(
      url,
    )
  )
    throw new Error("UNSAFE_URL");
  return url;
}

/**
 * The setup file (a Windows batch file, CRLF line ends, plain ASCII). It lists the printers and
 * asks for the receipt printer's number, makes that the main printer, makes the desktop icon
 * (Chrome, or Edge when there is no Chrome) and opens the app from it.
 */
export function setupScript(url: string): string {
  const target = safeUrl(url);
  // PowerShell, written with no double quotes and no percent signs inside, so the batch file passes
  // it on untouched (except %TH_N%: the batch file fills in the number typed).
  const listPrinters =
    "$i = 0; Get-CimInstance Win32_Printer | Sort-Object Name | ForEach-Object { $i++; '      ' + $i + '.  ' + $_.Name }";
  const setDefault = [
    "$p = @(Get-CimInstance Win32_Printer | Sort-Object Name)[%TH_N% - 1]",
    "if (-not $p) { '  No printer has that number, so the main printer was not changed.'; exit }",
    "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows' -Name LegacyDefaultPrinterMode -Value 1 -Type DWord",
    "Invoke-CimMethod -InputObject $p -MethodName SetDefaultPrinter | Out-Null",
    "'  Main printer is now: ' + $p.Name",
  ].join("; ");
  const makeIcon = [
    "$b = ''",
    "foreach ($n in 'chrome.exe','msedge.exe') { foreach ($h in 'HKLM:\\SOFTWARE','HKLM:\\SOFTWARE\\WOW6432Node','HKCU:\\SOFTWARE') { if (-not $b) { $v = (Get-ItemProperty -Path ($h + '\\Microsoft\\Windows\\CurrentVersion\\App Paths\\' + $n) -ErrorAction SilentlyContinue).'(default)'; if ($v) { $v = $v.Trim([char]34); if (Test-Path -LiteralPath $v) { $b = $v } } } } }",
    "$x86 = [Environment]::GetFolderPath('ProgramFilesX86')",
    "foreach ($v in @(($env:ProgramFiles + '\\Google\\Chrome\\Application\\chrome.exe'), ($x86 + '\\Google\\Chrome\\Application\\chrome.exe'), ($env:LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'), ($x86 + '\\Microsoft\\Edge\\Application\\msedge.exe'), ($env:ProgramFiles + '\\Microsoft\\Edge\\Application\\msedge.exe'))) { if (-not $b -and (Test-Path -LiteralPath $v)) { $b = $v } }",
    "if (-not $b) { '  Google Chrome or Microsoft Edge was not found. Install Google Chrome, then open this file again.'; exit 2 }",
    `$a = '--user-data-dir=' + [char]34 + $env:TH_PROFILE + [char]34 + ' ${FLAGS}' + $env:TH_URL`,
    "$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Trade Hishab.lnk'))",
    "$s.TargetPath = $b",
    "$s.Arguments = $a",
    "$s.IconLocation = $b + ',0'",
    "$s.Description = 'Trade Hishab - prints receipts straight away'",
    "$s.Save()",
    "'  Desktop icon made: Trade Hishab'",
    "Start-Process -FilePath $b -ArgumentList $a",
  ].join("; ");

  return [
    "@echo off",
    "setlocal",
    "title Trade Hishab - receipt printer setup",
    `set "TH_URL=${target}"`,
    `set "TH_PROFILE=%LOCALAPPDATA%\\${PROFILE_FOLDER}"`,
    "echo.",
    "echo   Trade Hishab - one-tap receipt printing",
    "echo   =======================================",
    "echo.",
    "echo   This sets up two things, once:",
    "echo     1. Your receipt printer becomes the main printer of this computer.",
    'echo     2. A "Trade Hishab" icon is put on the desktop. When the app is opened',
    "echo        from it, Print prints straight away, with no print window.",
    "echo.",
    "echo   Printers on this computer:",
    "echo.",
    `powershell -NoProfile -Command "${listPrinters}"`,
    "echo.",
    'set "TH_PICK="',
    'set /p "TH_PICK=  Type the number of your RECEIPT printer and press Enter: "',
    "set /a TH_N=0",
    'set /a "TH_N=TH_PICK" 2>nul',
    "if %TH_N% LEQ 0 goto icon",
    `powershell -NoProfile -Command "${setDefault}"`,
    ":icon",
    "echo.",
    `powershell -NoProfile -Command "${makeIcon}"`,
    "if errorlevel 1 goto failed",
    "echo.",
    "echo   Done. Trade Hishab is opening now: sign in once in that window.",
    'echo   From now on, open the app from the "Trade Hishab" icon on the desktop.',
    "echo.",
    "pause",
    "exit /b 0",
    ":failed",
    "echo.",
    "echo   The desktop icon could not be made. Ask Trade Hishab for help.",
    "echo.",
    "pause",
    "exit /b 1",
    "",
  ].join("\r\n");
}

/**
 * The same desktop icon, made by hand (right-click the desktop, New, Shortcut, paste this). Uses
 * Chrome, found wherever it is installed.
 */
export function shortcutLine(url: string): string {
  return `C:\\Windows\\System32\\cmd.exe /c start "" chrome --user-data-dir="%LOCALAPPDATA%\\${PROFILE_FOLDER}" ${FLAGS}${safeUrl(url)}`;
}
