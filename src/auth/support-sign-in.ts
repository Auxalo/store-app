import "server-only";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { Db } from "mongodb";
import { z } from "zod";
import { logAdminAction } from "@/server/admin-shops";

const refused = () =>
  new APIError("UNAUTHORIZED", { message: "Invalid username or password" });

/**
 * Support sign-in: the operator (platform admin) opens a shop's account to check its data when the
 * shop asks, from the normal sign-in page, with the shop's username and an operator's password.
 *
 * - The password must be the password of an operator account (`platformAdmin: true`, active).
 * - An operator account is never opened this way, nor a deactivated person.
 * - The session does not stay: it ends when the browser is closed, and after a day at most
 *   (Better Auth's "don't remember me" session, which is never extended).
 * - Every support sign-in is written to the operator log (Admin → activity), with who and which shop.
 *
 * The sign-in page tries this only after the normal sign-in was refused.
 */
export function supportSignIn(db: Db) {
  return {
    id: "support-sign-in",
    endpoints: {
      supportSignIn: createAuthEndpoint(
        "/support/sign-in",
        {
          method: "POST",
          body: z.object({
            username: z.string().trim().toLowerCase().min(3).max(30),
            password: z.string().min(1).max(128),
          }),
        },
        async (ctx) => {
          const { username, password } = ctx.body;
          const users = db.collection("user");

          // Which operator's password this is. There are only a few operators; checking a password
          // is slow on purpose, so the newest 20 at most (a wrong password on the sign-in page
          // comes here too, and must not wait long).
          const operators = await users
            .find({ platformAdmin: true, isActive: { $ne: false } })
            .sort({ createdAt: -1 })
            .limit(20)
            .project<{ _id: unknown; name?: string }>({ _id: 1, name: 1 })
            .toArray();
          let operator: { id: string; name: string } | null = null;
          for (const o of operators) {
            const account =
              await ctx.context.internalAdapter.findCredentialAccount(
                String(o._id),
              );
            if (
              account?.password &&
              (await ctx.context.password.verify({
                hash: account.password,
                password,
              }))
            ) {
              operator = { id: String(o._id), name: String(o.name ?? "") };
              break;
            }
          }
          if (!operator) throw refused();

          const raw = await users.findOne({ username });
          if (!raw || raw.platformAdmin === true || raw.isActive === false)
            throw refused();
          const user = await ctx.context.adapter.findOne<{
            id: string;
            storeId?: string;
          }>({
            model: "user",
            where: [{ field: "username", value: username }],
          });
          if (!user) throw refused();

          // "Don't remember me": a browser-session cookie, and a session that is never extended.
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
            true,
          );
          if (!session)
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Could not sign in",
            });
          await setSessionCookie(ctx, { session, user: user as never }, true);
          await logAdminAction(
            db,
            operator,
            "support.sign_in",
            user.storeId ?? null,
            `@${username}`,
          );
          return ctx.json({ ok: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
