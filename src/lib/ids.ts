import { v7 as uuidv7 } from "uuid";

/** Time-sortable UUID (RFC 9562 v7). Safe to generate offline; used as the Mongo _id too. */
export function newId(): string {
  return uuidv7();
}
