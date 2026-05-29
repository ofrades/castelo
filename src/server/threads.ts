import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "./middleware";
import {
  addThreadMessage,
  getAnnotationContext,
  getDocumentContext,
  getOrCreateAnnotationThread,
  getThreadWithMessages,
  listThreadsForDocument,
} from "#/lib/thread-service";

export const getDocumentThreads = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data: { documentId: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as { session: { sub: string } | null };
    if (!ctx.session) return [];
    const { getDb } = await import("#/lib/db");
    const db = await getDb();
    return listThreadsForDocument(db, ctx.session.sub, data.documentId);
  });

export const getThread = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data: { threadId: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as { session: { sub: string } | null };
    if (!ctx.session) return null;
    const { getDb } = await import("#/lib/db");
    const db = await getDb();
    const result = await getThreadWithMessages(db, ctx.session.sub, data.threadId);
    if (!result) return null;
    return {
      thread: result.thread,
      messages: result.messages.map((m) => ({
        ...m,
        citationsJson: (m.citationsJson as any[]) ?? [],
      })) as any,
    } as any;
  });

export const createAnnotationThread = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) =>
    z
      .object({
        documentId: z.string().min(1),
        annotationId: z.string().min(1).nullable(),
        scope: z.enum(["annotation", "page", "document"]),
        title: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as { session: { sub: string } | null };
    if (!ctx.session) throw new Error("Unauthorized");
    const { getDb } = await import("#/lib/db");
    const db = await getDb();
    return getOrCreateAnnotationThread(db, {
      ownerUserId: ctx.session.sub,
      documentId: data.documentId,
      annotationId: data.annotationId,
      scope: data.scope,
      title: data.title,
    });
  });

export const sendThreadMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) =>
    z
      .object({
        threadId: z.string().min(1),
        content: z.string().min(1).max(10_000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as { session: { sub: string } | null };
    if (!ctx.session) throw new Error("Unauthorized");
    const { getDb } = await import("#/lib/db");
    const db = await getDb();
    const msg = await addThreadMessage(db, {
      threadId: data.threadId,
      role: "user",
      content: data.content,
    });
    return { ...msg, citationsJson: (msg.citationsJson as any[]) ?? [] } as any;
  });

export const getThreadContext = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data: { threadId: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as { session: { sub: string } | null };
    if (!ctx.session) return null;
    const { getDb } = await import("#/lib/db");
    const db = await getDb();

    const thread = await getThreadWithMessages(db, ctx.session.sub, data.threadId);
    if (!thread) return null;

    if (thread.thread.annotationId) {
      const ctxResult = await getAnnotationContext(db, thread.thread.annotationId);
      if (!ctxResult) return null;
      return {
        annotation: {
          ...ctxResult.annotation,
          selectorJson: ctxResult.annotation.selectorJson as any,
        } as any,
        chunks: ctxResult.chunks,
      } as any;
    }

    return getDocumentContext(db, thread.thread.documentId, thread.thread.id);
  });
