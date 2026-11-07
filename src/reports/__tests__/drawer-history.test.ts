import { describe, expect, it } from "vitest";
import { buildCash, type CashEntryRow, DRAWER_HISTORY_DAYS } from "../cash";

const none = {
  sales: [],
  payments: [],
  expenses: [],
  purchases: [],
  returns: [],
};
const entry = (day: string): CashEntryRow => ({
  id: day,
  day,
  amount: 100_000,
  kind: "open",
  note: "",
  byName: "Owner",
  createdAt: `${day}T04:00:00.000Z`,
});

describe("the cash drawer's earlier days", () => {
  it("shows at most the last 7 earlier days, newest first", () => {
    expect(DRAWER_HISTORY_DAYS).toBe(7);
    // Today is 2026-11-20; entries for each of the 12 days before it.
    const days = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 10, 19 - i));
      return d.toISOString().slice(0, 10);
    });
    const report = buildCash("2026-11-20", "Asia/Dhaka", none, [
      entry("2026-11-20"),
      ...days.map(entry),
    ]);
    expect(report.history).toHaveLength(7);
    expect(report.history[0].day).toBe("2026-11-19");
    expect(report.history[6].day).toBe("2026-11-13");
    // Today is the figure itself, never part of the history.
    expect(report.entries).toHaveLength(1);
  });

  it("keeps all of them when there are fewer", () => {
    const report = buildCash("2026-11-20", "Asia/Dhaka", none, [
      entry("2026-11-18"),
      entry("2026-11-15"),
    ]);
    expect(report.history.map((h) => h.day)).toEqual([
      "2026-11-18",
      "2026-11-15",
    ]);
  });
});
