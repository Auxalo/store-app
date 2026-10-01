import { z } from "zod";

/** Entity ids are client-generated uuid v7 strings (also the Mongo _id). */
export const idSchema = z.string().min(1).max(64);

/** Normalizes any ISO-8601 timestamp to canonical UTC form so strings sort chronologically. */
export const isoDateSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
