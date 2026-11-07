/**
 * The ways money can be paid. Cash, bank and card are always there; bKash, Nagad and Rocket can be
 * hidden; a shop can add its own (e.g. a local wallet). Records keep the method's code, so hiding or
 * renaming one never changes old sales: they still show its name.
 */
export const BUILTIN_METHODS = [
  { code: "cash", fixed: true },
  { code: "bkash", fixed: false },
  { code: "nagad", fixed: false },
  { code: "rocket", fixed: false },
  { code: "card", fixed: true },
  { code: "bank", fixed: true },
] as const;

/** A method is named by its code: a built-in one ("bkash") or one the shop added ("m_<id>"). */
export type PaymentMethodCode = string;

export const BUILTIN_METHOD_CODES: readonly string[] = BUILTIN_METHODS.map(
  (m) => m.code,
);

export const isBuiltinMethod = (code: string) =>
  BUILTIN_METHOD_CODES.includes(code);

/** Cash, bank and card: always shown, never removed. */
export const isFixedMethod = (code: string) =>
  BUILTIN_METHODS.some((m) => m.code === code && m.fixed);

export const METHOD_KEY_PREFIX = "payment.";
/** A shop's settings key for one method. */
export const methodSettingKey = (code: string) => `${METHOD_KEY_PREFIX}${code}`;

/** What the shop saved about one method (a shop setting, so it syncs to every device). */
export interface MethodRecordValue {
  /** The shop's own name. Empty for a built-in method means: use the translated default name. */
  name: string;
  /** Hidden from every picker; old records keep showing its name. */
  removed: boolean;
}

export interface MethodRecord {
  code: string;
  value: MethodRecordValue;
  createdAt: string;
}

export interface MethodDef {
  code: string;
  builtin: boolean;
  fixed: boolean;
  /** The shop's own name; "" when the translated default applies. */
  customName: string;
  removed: boolean;
}

/** The shop's methods: the built-in ones, then its own in the order they were added. */
export function mergeMethods(records: readonly MethodRecord[]): MethodDef[] {
  const byCode = new Map(records.map((r) => [r.code, r]));
  const builtin: MethodDef[] = BUILTIN_METHODS.map((m) => {
    const saved = byCode.get(m.code)?.value;
    return {
      code: m.code,
      builtin: true,
      fixed: m.fixed,
      customName: saved?.name ?? "",
      // Cash, bank and card cannot be hidden, whatever a record says.
      removed: m.fixed ? false : (saved?.removed ?? false),
    };
  });
  const own: MethodDef[] = records
    .filter((r) => !isBuiltinMethod(r.code))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((r) => ({
      code: r.code,
      builtin: false,
      fixed: false,
      customName: r.value.name,
      removed: r.value.removed,
    }));
  return [...builtin, ...own];
}

/** The shop's methods as a screen needs them: pickers and names. */
export function makeMethodHelpers(
  records: readonly MethodRecord[],
  /** The translated default name of a built-in method. */
  defaultName: (code: string) => string,
) {
  const all = mergeMethods(records);
  const byCode = new Map(all.map((m) => [m.code, m]));
  return {
    /** Every method, hidden ones included (old records still name them). */
    all,
    /** What a picker offers. */
    active: all.filter((m) => !m.removed),
    /** A picker's choices, plus the method already on a record even if it was hidden since. */
    pickable: (current?: string) =>
      all.filter((m) => !m.removed || m.code === current),
    /** The name to show for a code: the shop's own, else the default; an unknown code shows as itself. */
    name(code: string): string {
      const method = byCode.get(code);
      if (!method) return code;
      if (method.customName) return method.customName;
      return method.builtin ? defaultName(code) : code;
    },
  };
}

export type MethodHelpers = ReturnType<typeof makeMethodHelpers>;

/** Reads the shop's saved methods out of its settings records (ignores anything that is not one). */
export function methodRecordsFromSettings(
  rows: ReadonlyArray<{
    key: string;
    value: unknown;
    createdAt: string;
    deletedAt?: string | null;
  }>,
): MethodRecord[] {
  const records: MethodRecord[] = [];
  for (const row of rows) {
    if (row.deletedAt || !row.key.startsWith(METHOD_KEY_PREFIX)) continue;
    const v = row.value as Partial<MethodRecordValue> | null;
    if (!v || typeof v.name !== "string" || typeof v.removed !== "boolean")
      continue;
    records.push({
      code: row.key.slice(METHOD_KEY_PREFIX.length),
      value: v as MethodRecordValue,
      createdAt: row.createdAt,
    });
  }
  return records;
}
