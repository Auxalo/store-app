import { getAuth } from "@/auth/server";

export const dynamic = "force-dynamic";
// A small request: stop it early rather than let it hold a function instance.
export const maxDuration = 10;

async function handle(request: Request) {
  const auth = await getAuth();
  return auth.handler(request);
}

export { handle as GET, handle as POST };
