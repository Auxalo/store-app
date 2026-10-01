import { z } from "zod";

export const settingKeySchema = z.string().min(1).max(100);

export const settingSetInput = z.object({
  key: settingKeySchema,
  value: z.json(),
});
export const settingSetPayload = settingSetInput.extend({
  baseVersion: z.number().int().min(0),
});
