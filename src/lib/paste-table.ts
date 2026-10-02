import { normalizeSearch } from "./search";

/**
 * Turns text copied from Excel or Google Sheets (cells separated by tabs) or pasted CSV (commas)
 * into rows of cells. Handles quoted cells, including ones with commas, tabs or line breaks inside,
 * and ignores completely empty lines. Nothing is uploaded: this only reads text from the clipboard.
 */
export function parsePastedTable(text: string): string[][] {
  const input = text.replace(/^﻿/, "");
  // Spreadsheets copy with tabs. Without a single tab, treat it as comma-separated.
  const delimiter = input.includes("\t") ? "\t" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let cellStarted = false;

  const endCell = () => {
    row.push(cell.trim());
    cell = "";
    cellStarted = false;
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && !cellStarted) {
      quoted = true;
      cellStarted = true;
    } else if (ch === delimiter) endCell();
    else if (ch === "\r") {
      if (input[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") endRow();
    else {
      cell += ch;
      cellStarted = true;
    }
  }
  if (cell !== "" || row.length > 0 || cellStarted) endRow();
  return rows;
}

/**
 * True when a pasted row is the column titles rather than data, for example "Name  Phone  Due"
 * copied together with the cells. `titles` are the words each column may be called, in any language.
 */
export function isHeaderRow(row: string[], titles: string[][]): boolean {
  const known = new Set(titles.flat().map(normalizeSearch));
  const hits = row.filter((cell) => known.has(normalizeSearch(cell))).length;
  return hits >= Math.min(2, titles.length) && hits >= row.length / 2;
}
