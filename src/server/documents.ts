import { chat } from "@tanstack/ai";
import { createOpenaiChatCompletions } from "@tanstack/ai-openai";
import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  AI_MODEL,
  createOpenRouterHeaders,
  OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL,
} from "#/lib/ai-config";
import { authMiddleware } from "./middleware";
import {
  createReaderAnnotation,
  deleteOwnedDocument,
  deleteReaderAnnotation,
  getDocumentMarkdown,
  getOwnedDocument,
  listDocumentAnnotations,
  listOwnedDocuments,
  type AnnotationSelector,
  type Db,
} from "#/lib/document-service";
import { readingProgress, reviewAttempts, reviewQuestions } from "#/lib/schema";

const generatedReviewQuestionSchema = z.object({
  question: z.string().min(1).max(500),
  expectedAnswer: z.string().min(1).max(2_000),
  sourceHint: z.string().max(500).optional(),
  discipline: z.string().min(1).max(80).optional(),
  evaluationMode: z.enum(["objective", "flexible"]).optional(),
});

const documentIdInputSchema = z.object({
  documentId: z.string().min(1),
});

const annotationDeleteInputSchema = z.object({
  documentId: z.string().min(1),
  annotationId: z.string().min(1),
});

const reviewStateInputSchema = documentIdInputSchema;

const pageReviewInputSchema = z.object({
  documentId: z.string().min(1),
  pageNumber: z.number().int().positive(),
  pageText: z.string().max(18_000).optional(),
  annotationContext: z.string().max(8_000).optional(),
});

const gradeReviewInputSchema = z.object({
  documentId: z.string().min(1),
  questionId: z.string().min(1),
  answer: z.string().min(1).max(4_000),
});

const revealReviewInputSchema = z.object({
  documentId: z.string().min(1),
  questionId: z.string().min(1),
});

const gradeSchema = z.object({
  grade: z.enum(["correct", "partial", "incorrect"]),
  feedback: z.string().max(1_000),
  retryQuestion: z.string().max(500).optional(),
});

const annotationInputSchema = z.object({
  documentId: z.string().min(1),
  versionId: z.string().min(1),
  kind: z.enum(["highlight", "note", "question", "global"]),
  scope: z.enum(["inline", "page", "block", "document"]),
  color: z.string().min(1).max(24).optional(),
  selectedText: z.string().max(20_000).nullable().optional(),
  body: z.string().max(20_000).nullable().optional(),
  selector: z.object({
    type: z.literal("TextQuoteSelector"),
    exact: z.string(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    rects: z
      .array(
        z.object({
          page: z.number().int().positive(),
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        }),
      )
      .optional(),
    markdown: z.object({ blockId: z.string().nullable().optional() }).optional(),
  }),
});

export const getDocuments = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const ctx = context as { session: { sub: string } | null };
    if (!ctx.session) return [];

    const { getDb } = await import("#/lib/db");
    const db = await getDb();
    return listOwnedDocuments(db, ctx.session.sub);
  });

export const getReaderDocument = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data: { documentId: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as { session: { sub: string } | null };
    if (!ctx.session) throw new Error("Unauthorized");

    const { getDb } = await import("#/lib/db");
    const db = await getDb();
    const document = await getOwnedDocument(db, ctx.session.sub, data.documentId);
    if (!document || !document.currentVersionId) return null;

    const [annotations, markdown] = await Promise.all([
      listDocumentAnnotations(db, ctx.session.sub, document.id),
      document.kind === "markdown" || document.kind === "text"
        ? getDocumentMarkdown(db, document.id, document.currentVersionId)
        : Promise.resolve(""),
    ]);

    return {
      document,
      annotations,
      markdown,
      fileUrl: `/api/documents/${document.id}/file`,
    };
  });

function createModelAdapter() {
  return createOpenaiChatCompletions(AI_MODEL as never, OPENROUTER_API_KEY, {
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: createOpenRouterHeaders(),
  }) as any;
}

function extractJson(raw: string) {
  return raw.match(/```json\s*([\s\S]*?)```/i)?.[1] ?? raw.match(/[[{][\s\S]*[\]}]/)?.[0] ?? raw;
}

async function ensureReadingProgress(
  db: Db,
  args: { ownerUserId: string; documentId: string; versionId: string },
) {
  const [existing] = await db
    .select()
    .from(readingProgress)
    .where(
      and(
        eq(readingProgress.ownerUserId, args.ownerUserId),
        eq(readingProgress.documentId, args.documentId),
        eq(readingProgress.versionId, args.versionId),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const now = new Date();
  const id = crypto.randomUUID();
  await db.insert(readingProgress).values({
    id,
    ownerUserId: args.ownerUserId,
    documentId: args.documentId,
    versionId: args.versionId,
    currentPage: 1,
    unlockedPage: 1,
    createdAt: now,
    updatedAt: now,
  });

  const [created] = await db.select().from(readingProgress).where(eq(readingProgress.id, id));
  return created!;
}

async function unlockNextPageIfReady(
  db: Db,
  args: { ownerUserId: string; documentId: string; versionId: string; pageNumber: number },
) {
  const pageQuestions = await db
    .select()
    .from(reviewQuestions)
    .where(
      and(
        eq(reviewQuestions.ownerUserId, args.ownerUserId),
        eq(reviewQuestions.documentId, args.documentId),
        eq(reviewQuestions.versionId, args.versionId),
        eq(reviewQuestions.pageNumber, args.pageNumber),
      ),
    );
  const correctCount = pageQuestions.filter((question) => question.status === "correct").length;
  if (correctCount < Math.min(2, pageQuestions.length || 2)) return;

  const progress = await ensureReadingProgress(db, args);
  if (progress.unlockedPage > args.pageNumber) return;

  await db
    .update(readingProgress)
    .set({ unlockedPage: args.pageNumber + 1, updatedAt: new Date() })
    .where(eq(readingProgress.id, progress.id));
}

export const getReviewState = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => reviewStateInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const ctx = context as { session: { sub: string } | null };
    if (!ctx.session) throw new Error("Unauthorized");

    const { getDb } = await import("#/lib/db");
    const db = await getDb();
    const document = await getOwnedDocument(db, ctx.session.sub, data.documentId);
    if (!document?.currentVersionId) throw new Error("Document not found");

    const progress = await ensureReadingProgress(db, {
      ownerUserId: ctx.session.sub,
      documentId: document.id,
      versionId: document.currentVersionId,
    });
    const questions = await db
      .select()
      .from(reviewQuestions)
      .where(
        and(
          eq(reviewQuestions.ownerUserId, ctx.session.sub),
          eq(reviewQuestions.documentId, document.id),
          eq(reviewQuestions.versionId, document.currentVersionId),
        ),
      )
      .orderBy(asc(reviewQuestions.pageNumber), asc(reviewQuestions.createdAt));

    return { progress, questions };
  });

export const ensurePageReviewQuestions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => pageReviewInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const ctx = context as { session: { sub: string } | null };
    if (!ctx.session) throw new Error("Unauthorized");

    const { getDb } = await import("#/lib/db");
    const db = await getDb();
    const document = await getOwnedDocument(db, ctx.session.sub, data.documentId);
    if (!document?.currentVersionId) throw new Error("Document not found");

    const existing = await db
      .select()
      .from(reviewQuestions)
      .where(
        and(
          eq(reviewQuestions.ownerUserId, ctx.session.sub),
          eq(reviewQuestions.documentId, document.id),
          eq(reviewQuestions.versionId, document.currentVersionId),
          eq(reviewQuestions.pageNumber, data.pageNumber),
        ),
      )
      .orderBy(asc(reviewQuestions.createdAt));
    if (existing.length) return existing;

    const pageText = data.pageText?.trim();
    if (!pageText) return [];

    const result = await chat({
      adapter: createModelAdapter(),
      systemPrompts: [
        "You generate mastery questions for a reading tutor.",
        "First infer the discipline and choose an evaluation mode: objective for math, formal logic, factual recall, and technical procedures; flexible for literature, poetry, philosophy, history interpretation, and open-ended analysis.",
        "Generate questions only for this exact page. Do not use learner notes as questions; notes are optional hints about what the learner noticed.",
        "For objective disciplines, ask questions with determinate answers. For flexible disciplines, ask interpretive questions that can be answered in multiple grounded ways.",
        "Return only JSON: an array of exactly 3 objects with question, expectedAnswer, sourceHint, discipline, and evaluationMode fields.",
      ],
      messages: [
        {
          role: "user",
          content: `Document: ${document.title}\nPage: ${data.pageNumber}\n\nPage text:\n${pageText}\n\nOptional notes/highlights:\n${data.annotationContext ?? ""}`,
        },
      ],
      stream: false,
      maxTokens: 1_500,
    });

    const parsed = z
      .array(generatedReviewQuestionSchema)
      .parse(JSON.parse(extractJson(typeof result === "string" ? result : String(result ?? ""))))
      .slice(0, 3);

    const now = new Date();
    const rows = parsed.map((question) => ({
      id: crypto.randomUUID(),
      ownerUserId: ctx.session!.sub,
      documentId: document.id,
      versionId: document.currentVersionId!,
      pageNumber: data.pageNumber,
      question: question.question,
      expectedAnswer: question.expectedAnswer,
      sourceHint: question.sourceHint ?? null,
      discipline: question.discipline ?? "general",
      evaluationMode: question.evaluationMode ?? "flexible",
      status: "pending" as const,
      correctCount: 0,
      incorrectCount: 0,
      model: AI_MODEL,
      createdAt: now,
      updatedAt: now,
    }));

    if (rows.length) await db.insert(reviewQuestions).values(rows);
    return db
      .select()
      .from(reviewQuestions)
      .where(
        and(
          eq(reviewQuestions.ownerUserId, ctx.session.sub),
          eq(reviewQuestions.documentId, document.id),
          eq(reviewQuestions.versionId, document.currentVersionId),
          eq(reviewQuestions.pageNumber, data.pageNumber),
        ),
      )
      .orderBy(asc(reviewQuestions.createdAt));
  });

export const markReviewAnswerRevealed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => revealReviewInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const ctx = context as { session: { sub: string } | null };
    if (!ctx.session) throw new Error("Unauthorized");

    const { getDb } = await import("#/lib/db");
    const db = await getDb();
    const document = await getOwnedDocument(db, ctx.session.sub, data.documentId);
    if (!document?.currentVersionId) throw new Error("Document not found");

    const [question] = await db
      .select()
      .from(reviewQuestions)
      .where(
        and(
          eq(reviewQuestions.id, data.questionId),
          eq(reviewQuestions.ownerUserId, ctx.session.sub),
          eq(reviewQuestions.documentId, document.id),
        ),
      )
      .limit(1);
    if (!question) throw new Error("Question not found");

    const now = new Date();
    const feedback = `Not in memory yet. Expected answer: ${question.expectedAnswer}`;
    await db.insert(reviewAttempts).values({
      id: crypto.randomUUID(),
      questionId: question.id,
      ownerUserId: ctx.session.sub,
      answer: "[revealed expected answer]",
      grade: "incorrect",
      feedback,
      createdAt: now,
    });
    await db
      .update(reviewQuestions)
      .set({
        status: "incorrect",
        incorrectCount: question.incorrectCount + 1,
        updatedAt: now,
      })
      .where(eq(reviewQuestions.id, question.id));

    const [updatedQuestion] = await db
      .select()
      .from(reviewQuestions)
      .where(eq(reviewQuestions.id, question.id));
    return { feedback, question: updatedQuestion! };
  });

export const gradeReviewAnswer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => gradeReviewInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const ctx = context as { session: { sub: string } | null };
    if (!ctx.session) throw new Error("Unauthorized");

    const { getDb } = await import("#/lib/db");
    const db = await getDb();
    const document = await getOwnedDocument(db, ctx.session.sub, data.documentId);
    if (!document?.currentVersionId) throw new Error("Document not found");

    const [question] = await db
      .select()
      .from(reviewQuestions)
      .where(
        and(
          eq(reviewQuestions.id, data.questionId),
          eq(reviewQuestions.ownerUserId, ctx.session.sub),
          eq(reviewQuestions.documentId, document.id),
        ),
      )
      .limit(1);
    if (!question) throw new Error("Question not found");

    const result = await chat({
      adapter: createModelAdapter(),
      systemPrompts: [
        "You grade active-recall answers for a reading tutor.",
        "Use the question's evaluation mode. Objective mode requires correctness. Flexible mode accepts multiple grounded interpretations, especially for literature, poetry, philosophy, and historical interpretation.",
        "Grade as correct when the learner captures a defensible important meaning. Use partial when the answer is promising but incomplete or from a narrow angle.",
        "For partial or incorrect answers, provide retryQuestion that asks from a different angle instead of repeating the same prompt. For flexible disciplines, make retryQuestion exploratory rather than punitive.",
        "Return only JSON with grade, feedback, and optional retryQuestion fields.",
      ],
      messages: [
        {
          role: "user",
          content: `Discipline: ${question.discipline}\nEvaluation mode: ${question.evaluationMode}\nQuestion: ${question.question}\nExpected answer: ${question.expectedAnswer}\nLearner answer: ${data.answer}`,
        },
      ],
      stream: false,
      maxTokens: 600,
    });

    const grade = gradeSchema.parse(
      JSON.parse(extractJson(typeof result === "string" ? result : String(result ?? ""))),
    );
    const now = new Date();
    await db.insert(reviewAttempts).values({
      id: crypto.randomUUID(),
      questionId: question.id,
      ownerUserId: ctx.session.sub,
      answer: data.answer,
      grade: grade.grade,
      feedback: grade.feedback,
      createdAt: now,
    });

    const nextStatus = grade.grade === "correct" ? "correct" : "incorrect";
    await db
      .update(reviewQuestions)
      .set({
        question:
          grade.grade === "correct" || !grade.retryQuestion?.trim()
            ? question.question
            : grade.retryQuestion.trim(),
        status: nextStatus,
        correctCount: question.correctCount + (grade.grade === "correct" ? 1 : 0),
        incorrectCount: question.incorrectCount + (grade.grade === "correct" ? 0 : 1),
        updatedAt: now,
      })
      .where(eq(reviewQuestions.id, question.id));

    if (grade.grade === "correct") {
      await unlockNextPageIfReady(db, {
        ownerUserId: ctx.session.sub,
        documentId: document.id,
        versionId: document.currentVersionId,
        pageNumber: question.pageNumber,
      });
    }

    const [updatedProgress] = await db
      .select()
      .from(readingProgress)
      .where(
        and(
          eq(readingProgress.ownerUserId, ctx.session.sub),
          eq(readingProgress.documentId, document.id),
          eq(readingProgress.versionId, document.currentVersionId),
        ),
      )
      .limit(1);
    const [updatedQuestion] = await db
      .select()
      .from(reviewQuestions)
      .where(eq(reviewQuestions.id, question.id));

    return { grade, question: updatedQuestion!, progress: updatedProgress! };
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => documentIdInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const ctx = context as { session: { sub: string } | null };
    if (!ctx.session) throw new Error("Unauthorized");

    const { getDb } = await import("#/lib/db");
    const db = await getDb();
    const deleted = await deleteOwnedDocument(db, ctx.session.sub, data.documentId);
    if (!deleted) throw new Error("Document not found");
    return { ok: true };
  });

export const deleteAnnotation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => annotationDeleteInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const ctx = context as { session: { sub: string } | null };
    if (!ctx.session) throw new Error("Unauthorized");

    const { getDb } = await import("#/lib/db");
    const db = await getDb();
    const deleted = await deleteReaderAnnotation(db, {
      ownerUserId: ctx.session.sub,
      documentId: data.documentId,
      annotationId: data.annotationId,
    });
    if (!deleted) throw new Error("Annotation not found");
    return { ok: true };
  });

export const addAnnotation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => annotationInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const ctx = context as { session: { sub: string } | null };
    if (!ctx.session) throw new Error("Unauthorized");

    const { getDb } = await import("#/lib/db");
    const db = await getDb();
    const document = await getOwnedDocument(db, ctx.session.sub, data.documentId);
    if (!document || document.currentVersionId !== data.versionId)
      throw new Error("Document not found");

    return createReaderAnnotation(db, {
      ownerUserId: ctx.session.sub,
      documentId: data.documentId,
      versionId: data.versionId,
      kind: data.kind,
      scope: data.scope,
      color: data.color,
      selectedText: data.selectedText,
      body: data.body,
      selector: data.selector as AnnotationSelector,
    });
  });
