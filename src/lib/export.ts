/** Downloads a text file from the browser (nothing is uploaded anywhere). */
export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** CSV with a UTF-8 byte-order mark so Excel opens Bangla text correctly. */
export function toCsv(
  rows: Array<Record<string, unknown>>,
  columns: string[],
): string {
  const lines = [
    columns.join(","),
    ...rows.map((row) => columns.map((c) => cell(row[c])).join(",")),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
