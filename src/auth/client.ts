"use client";

import {
  inferAdditionalFields,
  usernameClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [
    usernameClient(),
    inferAdditionalFields({
      user: {
        storeId: { type: "string" },
        role: { type: "string" },
        isActive: { type: "boolean" },
      },
    }),
  ],
});
