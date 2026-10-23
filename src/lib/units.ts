/**
 * Selling units. The ones below come with the app; a shop can rename or remove any of them and add
 * its own (see src/hooks/use-units.ts). `decimals` is how many decimal places a quantity may have
 * (pieces: none, kilograms: three). Quantities are stored in milli-units, so this only limits what
 * can be typed.
 */
export const DEFAULT_UNITS = [
  { code: "pcs", decimals: 0 },
  { code: "dozen", decimals: 0 },
  { code: "packet", decimals: 0 },
  { code: "box", decimals: 0 },
  { code: "bottle", decimals: 0 },
  { code: "kg", decimals: 3 },
  { code: "g", decimals: 0 },
  { code: "litre", decimals: 3 },
  { code: "ml", decimals: 0 },
  { code: "meter", decimals: 2 },
] as const;

/** A unit is named by its code. The built-in ones use the codes above; a shop's own are "u_<id>". */
export type UnitCode = string;

export type Decimals = 0 | 1 | 2 | 3;

export const DEFAULT_UNIT_CODES: readonly string[] = DEFAULT_UNITS.map(
  (u) => u.code,
);

export const isDefaultUnit = (code: string) =>
  DEFAULT_UNIT_CODES.includes(code);

/** A shop's settings key for one unit. */
export const unitSettingKey = (code: string) => `unit.${code}`;
export const UNIT_KEY_PREFIX = "unit.";

/** What the shop saved about one unit (a shop setting, so it syncs to every device). */
export interface UnitRecordValue {
  /** The shop's own name. Empty for a built-in unit means: use the translated default name. */
  name: string;
  decimals: Decimals;
  /** Hidden from every picker; old records keep showing its name. */
  removed: boolean;
}

export interface UnitRecord {
  code: string;
  value: UnitRecordValue;
  createdAt: string;
}

export interface UnitDef {
  code: string;
  builtin: boolean;
  /** The shop's own name; "" when the translated default applies. */
  customName: string;
  decimals: Decimals;
  removed: boolean;
}

/**
 * The shop's units: the built-in ones (as saved, or as shipped), then the shop's own in the order
 * they were added. Pure, so it is the same on every screen and in tests.
 */
export function mergeUnits(records: readonly UnitRecord[]): UnitDef[] {
  const byCode = new Map(records.map((r) => [r.code, r]));
  const builtin: UnitDef[] = DEFAULT_UNITS.map((u) => {
    const saved = byCode.get(u.code)?.value;
    return {
      code: u.code,
      builtin: true,
      customName: saved?.name ?? "",
      decimals: saved?.decimals ?? u.decimals,
      removed: saved?.removed ?? false,
    };
  });
  const own: UnitDef[] = records
    .filter((r) => !isDefaultUnit(r.code))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((r) => ({
      code: r.code,
      builtin: false,
      customName: r.value.name,
      decimals: r.value.decimals,
      removed: r.value.removed,
    }));
  return [...builtin, ...own];
}

/** How many decimals a quantity of this unit may have. An unknown unit allows whole numbers. */
export function unitDecimals(
  code: string,
  units: readonly UnitDef[] = mergeUnits([]),
): Decimals {
  return units.find((u) => u.code === code)?.decimals ?? 0;
}

/** The shop's units as a screen needs them: pickers, names, and how many decimals a quantity may have. */
export function makeUnitHelpers(
  records: readonly UnitRecord[],
  /** The translated default name of a built-in unit. */
  defaultName: (code: string) => string,
) {
  const all = mergeUnits(records);
  const byCode = new Map(all.map((u) => [u.code, u]));
  return {
    /** Every unit, removed ones included (old records still name them). */
    all,
    /** What a picker offers. */
    active: all.filter((u) => !u.removed),
    /** The name to show for a code: the shop's own, else the default; an unknown code shows as itself. */
    name(code: string): string {
      const unit = byCode.get(code);
      if (!unit) return code;
      if (unit.customName) return unit.customName;
      return unit.builtin ? defaultName(code) : code;
    },
    decimals: (code: string): Decimals => unitDecimals(code, all),
  };
}

export type UnitHelpers = ReturnType<typeof makeUnitHelpers>;

/** Reads the shop's saved units out of its settings records (ignores anything that is not one). */
export function unitRecordsFromSettings(
  rows: ReadonlyArray<{
    key: string;
    value: unknown;
    createdAt: string;
    deletedAt?: string | null;
  }>,
): UnitRecord[] {
  const records: UnitRecord[] = [];
  for (const row of rows) {
    if (row.deletedAt || !row.key.startsWith(UNIT_KEY_PREFIX)) continue;
    const v = row.value as Partial<UnitRecordValue> | null;
    if (
      !v ||
      typeof v.name !== "string" ||
      typeof v.removed !== "boolean" ||
      ![0, 1, 2, 3].includes(v.decimals as number)
    )
      continue;
    records.push({
      code: row.key.slice(UNIT_KEY_PREFIX.length),
      value: v as UnitRecordValue,
      createdAt: row.createdAt,
    });
  }
  return records;
}
