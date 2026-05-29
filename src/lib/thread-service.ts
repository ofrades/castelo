import { and, desc, eq } from "drizzle-orm";
import type { getDb } from "./db";
import {
  annotations,
  annotationThreads,
  documentChunks,
  threadMessages,
  usageLog,
  user,
} from "./schema";

export type Db = Awaited<ReturnType<typeof getDb>>;

export type ThreadWithMessages = Awaited<ReturnType<typeof getThreadWithMessages>>;

export async function getOrCreateAnnotationThread(
  db: Db,
  args: {
    ownerUserId: string;
    documentId: string;
    annotationId: string | null;
    scope: "annotation" | "page" | "document";
    title?: string;
  },
) {
  const existing = await db
    .select()
    .from(annotationThreads)
    .where(
      and(
        eq(annotationThreads.ownerUserId, args.ownerUserId),
        eq(annotationThreads.documentId, args.documentId),
        args.annotationId
          ? eq(annotationThreads.annotationId, args.annotationId)
          : eq(annotationThreads.annotationId, ""),
        eq(annotationThreads.scope, args.scope),
      ),
    )
    .limit(1);

  if (existing[0]) return existing[0];

  const now = new Date();
  const id = crypto.randomUUID();
  await db.insert(annotationThreads).values({
    id,
    ownerUserId: args.ownerUserId,
    documentId: args.documentId,
    annotationId: args.annotationId,
    scope: args.scope,
    title: args.title ?? (args.scope === "annotation" ? "Annotation thread" : "Document thread"),
    status: "open",
    createdAt: now,
    updatedAt: now,
  });

  const [row] = await db
    .select()
    .from(annotationThreads)
    .where(eq(annotationThreads.id, id))
    .limit(1);
  return row!;
}

export async function getThreadWithMessages(db: Db, ownerUserId: string, threadId: string) {
  const [thread] = await db
    .select()
    .from(annotationThreads)
    .where(and(eq(annotationThreads.id, threadId), eq(annotationThreads.ownerUserId, ownerUserId)))
    .limit(1);

  if (!thread) return null;

  const messages = await db
    .select()
    .from(threadMessages)
    .where(eq(threadMessages.threadId, threadId))
    .orderBy(threadMessages.createdAt);

  return { thread, messages };
}

export async function listThreadsForDocument(db: Db, ownerUserId: string, documentId: string) {
  return db
    .select()
    .from(annotationThreads)
    .where(
      and(
        eq(annotationThreads.ownerUserId, ownerUserId),
        eq(annotationThreads.documentId, documentId),
      ),
    )
    .orderBy(desc(annotationThreads.updatedAt));
}

export async function addThreadMessage(
  db: Db,
  args: {
    threadId: string;
    role: "user" | "assistant" | "system";
    content: string;
    citationsJson?: unknown[];
    model?: string;
  },
) {
  const now = new Date();
  const id = crypto.randomUUID();
  await db.insert(threadMessages).values({
    id,
    threadId: args.threadId,
    role: args.role,
    content: args.content,
    citationsJson: args.citationsJson ?? [],
    model: args.model ?? null,
    createdAt: now,
  });

  await db
    .update(annotationThreads)
    .set({ updatedAt: now })
    .where(eq(annotationThreads.id, args.threadId));

  const [row] = await db.select().from(threadMessages).where(eq(threadMessages.id, id)).limit(1);
  return row!;
}

export async function getAnnotationContext(db: Db, annotationId: string) {
  const [annotation] = await db
    .select()
    .from(annotations)
    .where(eq(annotations.id, annotationId))
    .limit(1);

  if (!annotation) return null;

  const chunks = await db
    .select()
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.documentId, annotation.documentId),
        eq(documentChunks.versionId, annotation.versionId),
      ),
    )
    .orderBy(documentChunks.ordinal)
    .limit(20);

  return { annotation, chunks };
}

export async function getDocumentContext(db: Db, documentId: string, versionId: string) {
  return db
    .select()
    .from(documentChunks)
    .where(and(eq(documentChunks.documentId, documentId), eq(documentChunks.versionId, versionId)))
    .orderBy(documentChunks.ordinal)
    .limit(50);
}

export async function deductWalletBalance(db: Db, userId: string, cents: number) {
  const [u] = await db
    .select({ balance: user.walletBalance })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!u || u.balance < cents) return false;

  await db
    .update(user)
    .set({ walletBalance: u.balance - cents })
    .where(eq(user.id, userId));

  return true;
}

export async function logUsage(
  db: Db,
  args: {
    userId: string;
    source: string;
    model: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    providerCostUsd?: number;
    costCents: number;
  },
) {
  await db.insert(usageLog).values({
    id: crypto.randomUUID(),
    userId: args.userId,
    source: args.source,
    model: args.model,
    promptTokens: args.promptTokens ?? 0,
    completionTokens: args.completionTokens ?? 0,
    totalTokens: args.totalTokens ?? 0,
    providerCostUsd: args.providerCostUsd ?? 0,
    costCents: args.costCents,
    createdAt: new Date(),
  });
}
