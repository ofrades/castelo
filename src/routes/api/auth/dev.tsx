import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { createSessionToken } from "#/lib/jwt";
import { makeSessionCookie } from "#/lib/session";

export const Route = createFileRoute("/api/auth/dev")({
  server: {
    handlers: {
      POST: async () => {
        if (process.env.NODE_ENV === "production") {
          return new Response("Not found", { status: 404 });
        }

        const { getDb } = await import("#/lib/db");
        const { user } = await import("#/lib/schema");
        const db = await getDb();
        const email = "local@castelo.dev";
        let [row] = await db.select().from(user).where(eq(user.email, email)).limit(1);
        if (!row) {
          [row] = await db
            .insert(user)
            .values({
              id: "dev-user",
              name: "Local Learner",
              email,
              image: null,
              walletBalance: 500,
            })
            .returning();
        }

        const token = await createSessionToken({
          id: row.id,
          email: row.email,
          name: row.name,
          image: row.image,
        });

        return new Response(null, {
          status: 302,
          headers: { Location: "/dashboard", "Set-Cookie": makeSessionCookie(token) },
        });
      },
    },
  },
});
