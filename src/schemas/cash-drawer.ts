import { z } from "zod";
import { idSchema } from "./common";

/**
 * The cash in the drawer at the start of a day. Entries are only ever added: the first one for a
 * day is the opening, a later one (the owner's correction) replaces it as the day's figure, and
 * every one stays in the day's log.
 */
export const drawerSetInput = z.object({
  id: idSchema,
  /** The shop's day, yyyy-mm-dd. */
  day: z.iso.date(),
  /** Poisha. */
  amount: z
    .number()
    .int({ error: "invalidNumber" })
    .min(0, { error: "invalidNumber" })
    .max(10_000_000_000),
  note: z.string().trim().max(200).default(""),
  /** Who set it, as shown in the day's log. */
  byName: z.string().trim().max(80).default(""),
});
/** The device says whether this was the opening or a correction; the server decides for itself. */
export const drawerSetPayload = drawerSetInput.extend({
  kind: z.enum(["open", "correct"]).default("open"),
});
