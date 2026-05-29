import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { getSessionFromRequest } from "#/lib/session";

export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const session = await getSessionFromRequest(getRequest());
  if (!session) {
    return next({ context: { session: null, walletBalance: 0 } as any });
  }

  const { getDb } = await import("#/lib/db");
  const { user } = await import("#/lib/schema");
  const db = await getDb();

  const [existing] = await db
    .select({ walletBalance: user.walletBalance })
    .from(user)
    .where(eq(user.id, session.sub));

  if (!existing) {
    await db
      .insert(user)
      .values({
        id: session.sub,
        email: session.email,
        name: session.name,
        image: session.image ?? null,
        walletBalance: 0,
      })
      .onConflictDoNothing();
  }

  return next({
    context: {
      session,
      walletBalance: existing?.walletBalance ?? 0,
    } as any,
  });
});
