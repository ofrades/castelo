import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { getSessionFromRequest } from "#/lib/session";
import type { SessionPayload } from "#/lib/jwt";

export const getSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<(SessionPayload & { walletBalance: number }) | null> => {
    const session = await getSessionFromRequest(getRequest());
    if (!session) return null;

    const { getDb } = await import("#/lib/db");
    const { user } = await import("#/lib/schema");
    const { ensureDefaultDocumentsForUser } = await import("#/lib/document-service");
    const db = await getDb();
    await ensureDefaultDocumentsForUser(db, session.sub);
    const [row] = await db
      .select({ walletBalance: user.walletBalance })
      .from(user)
      .where(eq(user.id, session.sub));

    return { ...session, walletBalance: row?.walletBalance ?? 0 };
  },
);
