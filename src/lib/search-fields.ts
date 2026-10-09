import { normalizeSearch, searchWords } from "./search";

/**
 * The words each kind of record is found by, in ONE place, so the device (IndexedDB) and the server
 * (MongoDB) can never disagree about what a search matches. Both store the result with the record
 * (`searchWords`, plus `nameKey` for a stable A-Z order) and both search it the same way.
 */
export type SearchableCollection =
  | "products"
  | "customers"
  | "suppliers"
  | "sales"
  | "purchases";

export const SEARCHABLE: readonly SearchableCollection[] = [
  "products",
  "customers",
  "suppliers",
  "sales",
  "purchases",
];

export type DerivedSearchFields = {
  searchWords: string[];
  /** Normalised name, for sorting A-Z the same way everywhere. Only for records that have a name. */
  nameKey?: string;
};

const str = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Document numbers are found by their parts and without the leading zeros people skip:
 * "A-2610-0042" is found by "a", "2610", "0042" and "42".
 */
function numberWords(no: string): string[] {
  const words = searchWords(no);
  const bare = words
    .filter((w) => /^\d+$/.test(w) && w.startsWith("0"))
    .map((w) => w.replace(/^0+/, "") || "0");
  return [...new Set([...words, ...bare])];
}

export function derivedSearchFields(
  collection: SearchableCollection,
  doc: Record<string, unknown>,
): DerivedSearchFields {
  switch (collection) {
    case "products":
      return {
        searchWords: searchWords(str(doc.name), str(doc.sku), str(doc.barcode)),
        nameKey: normalizeSearch(str(doc.name)),
      };
    case "customers":
      return {
        searchWords: searchWords(str(doc.name), str(doc.phone)),
        nameKey: normalizeSearch(str(doc.name)),
      };
    case "suppliers":
      return {
        searchWords: searchWords(
          str(doc.name),
          str(doc.phone),
          str(doc.contactPerson),
        ),
        nameKey: normalizeSearch(str(doc.name)),
      };
    case "sales":
      return {
        searchWords: [
          ...new Set([
            ...numberWords(str(doc.invoiceNo)),
            ...searchWords(str(doc.customerName), str(doc.customerPhone)),
          ]),
        ],
      };
    case "purchases":
      return {
        searchWords: [
          ...new Set([
            ...numberWords(str(doc.purchaseNo)),
            ...searchWords(str(doc.invoiceRef), str(doc.supplierName)),
          ]),
        ],
      };
  }
}

/** Splits what a person typed into the tokens a search has to match (all of them, as prefixes). */
export function queryTokens(query: string): string[] {
  return searchWords(query);
}
