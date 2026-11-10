/**
 * One-tap printing on a Windows PC with a USB receipt printer.
 *
 * Such a printer is installed as a Windows printer, and its driver holds it: a web page cannot
 * reach it directly (it is not a COM port, and USB access is refused). Windows' own printing does
 * work, but shows the print window every time. Chrome and Edge skip that window and print straight
 * to the main (default) printer when started with `--kiosk-printing`.
 *
 * So the setup, done once:
 *  1. find the receipt printer and PROVE it with paper: a small test slip is printed and the person
 *     says whether it came out. Windows keeps dead copies of a printer (one for every USB socket it
 *     was ever plugged into: "EPSON (Copy 2)" ...), and printing with no window to a dead copy
 *     just hangs, so nobody is asked to pick from a list. Nothing is changed until a slip came out;
 *  2. make that printer the computer's main printer (and stop Windows from changing it);
 *  3. put a "Trade Hishab" icon on the desktop that opens the app with `--kiosk-printing`, in its
 *     own browser profile. Its own profile is what makes it last: the switch only works when the
 *     browser starts, and an already open Chrome window would otherwise swallow it.
 *
 * All of it is done by a small setup file the person downloads and opens (setupScript); the icon
 * can also be made by hand (shortcutLine). Nothing here runs in the browser itself.
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

// The PowerShell below is written with no double quotes and no percent signs inside, so the batch
// file passes it on untouched.

/** A Trade Hishab window left stuck by an earlier try (printing to a dead printer) is closed first. */
const CLOSE_STUCK = [
  "if ($env:TH_PROFILE -and $env:TH_PROFILE.Length -gt 10) { Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and $_.CommandLine -like ('*' + $env:TH_PROFILE + '*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }",
].join("; ");

/**
 * Finds the receipt printer by printing a test slip and asking whether it came out.
 * Tried in this order: connected before not connected (Windows marks an unplugged USB printer
 * offline), receipt-printer names first, USB ports first. Printers that are not paper (PDF, XPS,
 * OneNote, fax) are never tried. Ends with exit code 3, having changed nothing, when no slip came out.
 */
const FIND_PRINTER = [
  "$notPaper = 'PDF|XPS|OneNote|Fax|Send To|Microsoft Print|AnyDesk|Snagit'",
  "$all = @(Get-CimInstance Win32_Printer)",
  "$real = @($all | Where-Object { $_.Name -notmatch $notPaper -and $_.PortName -notmatch '^(nul:|PORTPROMPT:|SHRFAX:|FILE:|XPSPort:)' })",
  "$cands = @($real | Sort-Object @{ Expression = { [int][bool]$_.WorkOffline } }, @{ Expression = { if ($_.Name -match 'EPSON|TM-|Receipt|Thermal|XP-|Xprinter|Bixolon|Rongta|POS-?(58|80)') { 0 } else { 1 } } }, @{ Expression = { if ($_.PortName -match '^(USB|ESDPRT|TMUSB)') { 0 } else { 1 } } }, Name)",
  "if ($cands.Count -eq 0) { '  No printer was found on this computer. Install the printer first'; '  (its driver is in the box or on the maker website), then open this file again.'; exit 3 }",
  "$ok = $null",
  "foreach ($p in $cands) { ''; '  Printing a small test paper on: ' + $p.Name; try { @('', 'Trade Hishab', 'Printer test: OK', (Get-Date).ToString('yyyy-MM-dd HH:mm'), '', '') | Out-Printer -Name $p.Name } catch { '  (this one could not be used)'; continue }; $a = ''; $n = 0; while ($a -notmatch '^\\s*[yYnN]' -and $n -lt 5) { $n++; $a = [string](Read-Host '  Did the test paper come out of your receipt printer? Type Y (yes) or N (no) and press Enter') }; if ($a -match '^\\s*[yY]') { $ok = $p; break }; try { Get-PrintJob -PrinterName $p.Name -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue } catch { } }",
  "if (-not $ok) { ''; '  No test paper came out, so NOTHING was changed.'; '  You can keep printing from the normal print window as before.'; '  Check that the printer is on and its cable is in, then open this file again.'; exit 3 }",
  "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows' -Name LegacyDefaultPrinterMode -Value 1 -Type DWord",
  "Invoke-CimMethod -InputObject $ok -MethodName SetDefaultPrinter | Out-Null",
  "''; '  Receipt printer: ' + $ok.Name",
].join("; ");

/** Makes the desktop icon (Chrome, or Edge when there is no Chrome) and opens the app from it. */
const MAKE_ICON = [
  "$b = ''",
  "foreach ($n in 'chrome.exe','msedge.exe') { foreach ($h in 'HKLM:\\SOFTWARE','HKLM:\\SOFTWARE\\WOW6432Node','HKCU:\\SOFTWARE') { if (-not $b) { $v = (Get-ItemProperty -Path ($h + '\\Microsoft\\Windows\\CurrentVersion\\App Paths\\' + $n) -ErrorAction SilentlyContinue).'(default)'; if ($v) { $v = $v.Trim([char]34); if (Test-Path -LiteralPath $v) { $b = $v } } } } }",
  "$x86 = [Environment]::GetFolderPath('ProgramFilesX86')",
  "foreach ($v in @(($env:ProgramFiles + '\\Google\\Chrome\\Application\\chrome.exe'), ($x86 + '\\Google\\Chrome\\Application\\chrome.exe'), ($env:LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'), ($x86 + '\\Microsoft\\Edge\\Application\\msedge.exe'), ($env:ProgramFiles + '\\Microsoft\\Edge\\Application\\msedge.exe'))) { if (-not $b -and (Test-Path -LiteralPath $v)) { $b = $v } }",
  "if (-not $b) { '  Google Chrome or Microsoft Edge was not found. Install Google Chrome, then open this file again.'; exit 2 }",
  `$a = '--user-data-dir=' + [char]34 + $env:TH_PROFILE + [char]34 + ' ${FLAGS}' + $env:TH_URL`,
  // The app's own logo: taken from the installed app (its shortcut's icon file), else fetched
  // from the app's address; Chrome's logo only when both fail.
  "$w = New-Object -ComObject WScript.Shell",
  "$desk = [Environment]::GetFolderPath('Desktop')",
  "New-Item -ItemType Directory -Force -Path $env:TH_PROFILE | Out-Null",
  "$ico = Join-Path $env:TH_PROFILE 'trade-hishab.ico'",
  "$apps = Join-Path ([Environment]::GetFolderPath('Programs')) 'Chrome Apps'",
  // The installed app's desktop icon is replaced by this one, so there is one Trade Hishab icon.
  "$old = 0; foreach ($d in @($apps, $desk)) { foreach ($f in @(Get-ChildItem -LiteralPath $d -Filter '*Hishab*.lnk' -ErrorAction SilentlyContinue)) { $o = $w.CreateShortcut($f.FullName); if ($o.Arguments -like '*--app-id=*') { $src = ($o.IconLocation -split ',')[0]; if ($src -and -not (Test-Path -LiteralPath $ico) -and (Test-Path -LiteralPath $src)) { Copy-Item -LiteralPath $src -Destination $ico -Force }; if ($d -eq $desk) { Remove-Item -LiteralPath $f.FullName -Force; $old++ } } } }",
  "if (-not (Test-Path -LiteralPath $ico)) { try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri (($env:TH_URL -replace '^(https?://[^/#]+).*$', '$1') + '/favicon.ico') -OutFile $ico } catch { } }",
  "$s = $w.CreateShortcut((Join-Path $desk 'Trade Hishab.lnk'))",
  "$s.TargetPath = $b",
  "$s.Arguments = $a",
  "if (Test-Path -LiteralPath $ico) { $s.IconLocation = $ico + ',0' } else { $s.IconLocation = $b + ',0' }",
  "$s.Description = 'Trade Hishab - prints receipts straight away'",
  "$s.Save()",
  "if ($old -gt 0) { '  The old Trade Hishab desktop icon was replaced by the new one.' }",
  "'  Desktop icon made: Trade Hishab'",
  "Start-Process -FilePath $b -ArgumentList $a",
].join("; ");

/**
 * The setup file (a Windows batch file, CRLF line ends, plain ASCII). It proves the receipt
 * printer with a test slip, makes it the main printer, makes the desktop icon and opens the app
 * from it. When no slip comes out it changes nothing.
 */
export function setupScript(url: string): string {
  const target = safeUrl(url);
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
    "echo   Keep the receipt printer ON, with paper in it.",
    "echo   A small test paper is printed now, to find your printer.",
    `powershell -NoProfile -Command "${CLOSE_STUCK}"`,
    `powershell -NoProfile -Command "${FIND_PRINTER}"`,
    "if errorlevel 1 goto noprinter",
    "echo.",
    `powershell -NoProfile -Command "${MAKE_ICON}"`,
    "if errorlevel 1 goto failed",
    "echo.",
    "echo   Done. Trade Hishab is opening now: sign in once in that window.",
    'echo   From now on, open the app from the "Trade Hishab" icon on the desktop:',
    "echo   Print prints straight away, with no print window.",
    "echo.",
    "pause",
    "exit /b 0",
    ":noprinter",
    "echo.",
    "echo   Need help? Send a photo of this window to Trade Hishab.",
    "echo.",
    "pause",
    "exit /b 3",
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
