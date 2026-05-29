import { index, integer, real, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

const now = () => new Date();

// Auth and billing mirror the Bursa foundation. Reader data below is product-owned.
export const user = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  image: text("image"),
  walletBalance: integer("wallet_balance").notNull().default(0),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
});

export const oauthState = sqliteTable(
  "oauth_state",
  {
    state: text("state").primaryKey(),
    codeVerifier: text("code_verifier").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("idx_oauth_state_created").on(t.createdAt)],
);

export const walletTopUp = sqliteTable(
  "wallet_top_up",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull(),
    stripeEventId: text("stripe_event_id"),
    amountCents: integer("amount_cents").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    unique("uq_wallet_top_up_checkout_session").on(t.stripeCheckoutSessionId),
    index("idx_wallet_top_up_user").on(t.userId),
  ],
);

export const usageLog = sqliteTable(
  "usage_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull(),
    source: text("source").notNull(),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    providerCostUsd: real("provider_cost_usd"),
    costCents: integer("cost_cents").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("idx_usage_log_user").on(t.userId), index("idx_usage_log_source").on(t.source)],
);

export const documents = sqliteTable(
  "documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind", { enum: ["pdf", "markdown", "text", "other"] }).notNull(),
    mimeType: text("mime_type").notNull(),
    status: text("status", { enum: ["processing", "ready", "failed"] })
      .notNull()
      .default("ready"),
    currentVersionId: text("current_version_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("idx_documents_owner_updated").on(t.ownerUserId, t.updatedAt)],
);

export const documentVersions = sqliteTable(
  "document_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull().default(1),
    sourceSha256: text("source_sha256"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("idx_document_versions_document").on(t.documentId),
    unique("uq_document_version_number").on(t.documentId, t.versionNumber),
  ],
);

export const documentFiles = sqliteTable(
  "document_files",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionId: text("version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageProvider: text("storage_provider", { enum: ["local", "r2"] })
      .notNull()
      .default("local"),
    localPath: text("local_path"),
    objectKey: text("object_key"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("idx_document_files_document").on(t.documentId),
    index("idx_document_files_version").on(t.versionId),
  ],
);

export const documentChunks = sqliteTable(
  "document_chunks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionId: text("version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    pageNumber: integer("page_number"),
    blockId: text("block_id"),
    text: text("text").notNull(),
    charStart: integer("char_start"),
    charEnd: integer("char_end"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("idx_document_chunks_document").on(t.documentId, t.ordinal),
    index("idx_document_chunks_version").on(t.versionId, t.ordinal),
  ],
);

export const annotations = sqliteTable(
  "annotations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionId: text("version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["highlight", "note", "question", "global"] }).notNull(),
    scope: text("scope", { enum: ["inline", "page", "block", "document"] }).notNull(),
    color: text("color").notNull().default("amber"),
    selectedText: text("selected_text"),
    body: text("body").notNull().default(""),
    selectorJson: text("selector_json", { mode: "json" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("idx_annotations_document_updated").on(t.documentId, t.updatedAt),
    index("idx_annotations_owner_document").on(t.ownerUserId, t.documentId),
  ],
);

export const annotationThreads = sqliteTable(
  "annotation_threads",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    annotationId: text("annotation_id").references(() => annotations.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: ["annotation", "page", "document"] }).notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: ["open", "archived"] })
      .notNull()
      .default("open"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("idx_annotation_threads_document").on(t.documentId, t.updatedAt)],
);

export const threadMessages = sqliteTable(
  "thread_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    threadId: text("thread_id")
      .notNull()
      .references(() => annotationThreads.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    citationsJson: text("citations_json", { mode: "json" }).notNull().default("[]"),
    model: text("model"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("idx_thread_messages_thread").on(t.threadId, t.createdAt)],
);

export const learningArtifacts = sqliteTable(
  "learning_artifacts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionId: text("version_id").references(() => documentVersions.id, { onDelete: "cascade" }),
    annotationId: text("annotation_id").references(() => annotations.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["inline_note", "page_summary", "overview_summary"] }).notNull(),
    pageNumber: integer("page_number"),
    prompt: text("prompt").notNull().default(""),
    content: text("content").notNull(),
    model: text("model"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("idx_learning_artifacts_document").on(t.ownerUserId, t.documentId, t.kind),
    index("idx_learning_artifacts_annotation").on(t.annotationId),
  ],
);

export const readingProgress = sqliteTable(
  "reading_progress",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionId: text("version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    currentPage: integer("current_page").notNull().default(1),
    unlockedPage: integer("unlocked_page").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    unique("uq_reading_progress_document").on(t.ownerUserId, t.documentId, t.versionId),
    index("idx_reading_progress_document").on(t.ownerUserId, t.documentId),
  ],
);

export const reviewQuestions = sqliteTable(
  "review_questions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionId: text("version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    question: text("question").notNull(),
    expectedAnswer: text("expected_answer").notNull(),
    sourceHint: text("source_hint"),
    discipline: text("discipline").notNull().default("general"),
    evaluationMode: text("evaluation_mode", { enum: ["objective", "flexible"] })
      .notNull()
      .default("flexible"),
    status: text("status", { enum: ["pending", "incorrect", "correct"] })
      .notNull()
      .default("pending"),
    correctCount: integer("correct_count").notNull().default(0),
    incorrectCount: integer("incorrect_count").notNull().default(0),
    model: text("model"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("idx_review_questions_document").on(t.ownerUserId, t.documentId, t.pageNumber),
    index("idx_review_questions_status").on(t.ownerUserId, t.documentId, t.status),
  ],
);

export const reviewAttempts = sqliteTable(
  "review_attempts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    questionId: text("question_id")
      .notNull()
      .references(() => reviewQuestions.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    answer: text("answer").notNull(),
    grade: text("grade", { enum: ["correct", "partial", "incorrect"] }).notNull(),
    feedback: text("feedback").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("idx_review_attempts_question").on(t.questionId, t.createdAt)],
);

export const ingestionJobs = sqliteTable(
  "ingestion_jobs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionId: text("version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["queued", "running", "completed", "failed"] })
      .notNull()
      .default("queued"),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("idx_ingestion_jobs_status").on(t.status, t.createdAt)],
);

export type User = typeof user.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type DocumentFile = typeof documentFiles.$inferSelect;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type Annotation = typeof annotations.$inferSelect;
export type LearningArtifact = typeof learningArtifacts.$inferSelect;
export type ReadingProgress = typeof readingProgress.$inferSelect;
export type ReviewQuestion = typeof reviewQuestions.$inferSelect;
export type ReviewAttempt = typeof reviewAttempts.$inferSelect;
