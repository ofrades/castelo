import * as schema from "./schema";

let _db: Awaited<ReturnType<typeof buildDb>> | null = null;

function resolveDbPath() {
  const raw = process.env.DB_PATH || process.env.DATABASE_URL || "./data/castelo.sqlite";
  return raw.startsWith("file:") ? raw.slice("file:".length) : raw;
}

// Lightweight cold-start migrations keep early product iteration fast.
// Drizzle schema remains the source of table shape for application code.
function runMigrations(sqlite: { exec: (sql: string) => void }) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      image text,
      wallet_balance integer NOT NULL DEFAULT 0,
      stripe_customer_id text,
      created_at integer NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_state (
      state text PRIMARY KEY NOT NULL,
      code_verifier text NOT NULL,
      created_at integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_state_created ON oauth_state (created_at);

    CREATE TABLE IF NOT EXISTS wallet_top_up (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      stripe_checkout_session_id text NOT NULL,
      stripe_event_id text,
      amount_cents integer NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE cascade
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_top_up_checkout_session ON wallet_top_up (stripe_checkout_session_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_top_up_user ON wallet_top_up (user_id);

    CREATE TABLE IF NOT EXISTS usage_log (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      source text NOT NULL,
      model text NOT NULL,
      prompt_tokens integer,
      completion_tokens integer,
      total_tokens integer,
      provider_cost_usd real,
      cost_cents integer NOT NULL,
      created_at integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_log_user ON usage_log (user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_log_source ON usage_log (source);

    CREATE TABLE IF NOT EXISTS documents (
      id text PRIMARY KEY NOT NULL,
      owner_user_id text NOT NULL,
      title text NOT NULL,
      kind text NOT NULL,
      mime_type text NOT NULL,
      status text NOT NULL DEFAULT 'ready',
      current_version_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES user(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS idx_documents_owner_updated ON documents (owner_user_id, updated_at);

    CREATE TABLE IF NOT EXISTS document_versions (
      id text PRIMARY KEY NOT NULL,
      document_id text NOT NULL,
      version_number integer NOT NULL DEFAULT 1,
      source_sha256 text,
      created_at integer NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS idx_document_versions_document ON document_versions (document_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_document_version_number ON document_versions (document_id, version_number);

    CREATE TABLE IF NOT EXISTS document_files (
      id text PRIMARY KEY NOT NULL,
      document_id text NOT NULL,
      version_id text NOT NULL,
      file_name text NOT NULL,
      mime_type text NOT NULL,
      size_bytes integer NOT NULL,
      storage_provider text NOT NULL DEFAULT 'local',
      local_path text,
      object_key text,
      created_at integer NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE cascade,
      FOREIGN KEY (version_id) REFERENCES document_versions(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS idx_document_files_document ON document_files (document_id);
    CREATE INDEX IF NOT EXISTS idx_document_files_version ON document_files (version_id);

    CREATE TABLE IF NOT EXISTS document_chunks (
      id text PRIMARY KEY NOT NULL,
      document_id text NOT NULL,
      version_id text NOT NULL,
      ordinal integer NOT NULL,
      page_number integer,
      block_id text,
      text text NOT NULL,
      char_start integer,
      char_end integer,
      created_at integer NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE cascade,
      FOREIGN KEY (version_id) REFERENCES document_versions(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS idx_document_chunks_document ON document_chunks (document_id, ordinal);
    CREATE INDEX IF NOT EXISTS idx_document_chunks_version ON document_chunks (version_id, ordinal);

    CREATE TABLE IF NOT EXISTS annotations (
      id text PRIMARY KEY NOT NULL,
      owner_user_id text NOT NULL,
      document_id text NOT NULL,
      version_id text NOT NULL,
      kind text NOT NULL,
      scope text NOT NULL,
      color text NOT NULL DEFAULT 'amber',
      selected_text text,
      body text NOT NULL DEFAULT '',
      selector_json text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES user(id) ON DELETE cascade,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE cascade,
      FOREIGN KEY (version_id) REFERENCES document_versions(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS idx_annotations_document_updated ON annotations (document_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_annotations_owner_document ON annotations (owner_user_id, document_id);

    CREATE TABLE IF NOT EXISTS annotation_threads (
      id text PRIMARY KEY NOT NULL,
      owner_user_id text NOT NULL,
      document_id text NOT NULL,
      annotation_id text,
      scope text NOT NULL,
      title text NOT NULL,
      status text NOT NULL DEFAULT 'open',
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES user(id) ON DELETE cascade,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE cascade,
      FOREIGN KEY (annotation_id) REFERENCES annotations(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS idx_annotation_threads_document ON annotation_threads (document_id, updated_at);

    CREATE TABLE IF NOT EXISTS thread_messages (
      id text PRIMARY KEY NOT NULL,
      thread_id text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      citations_json text NOT NULL DEFAULT '[]',
      model text,
      created_at integer NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES annotation_threads(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS idx_thread_messages_thread ON thread_messages (thread_id, created_at);

    CREATE TABLE IF NOT EXISTS learning_artifacts (
      id text PRIMARY KEY NOT NULL,
      owner_user_id text NOT NULL,
      document_id text NOT NULL,
      version_id text,
      annotation_id text,
      kind text NOT NULL,
      page_number integer,
      prompt text NOT NULL DEFAULT '',
      content text NOT NULL,
      model text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES user(id) ON DELETE cascade,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE cascade,
      FOREIGN KEY (version_id) REFERENCES document_versions(id) ON DELETE cascade,
      FOREIGN KEY (annotation_id) REFERENCES annotations(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS idx_learning_artifacts_document ON learning_artifacts (owner_user_id, document_id, kind);
    CREATE INDEX IF NOT EXISTS idx_learning_artifacts_annotation ON learning_artifacts (annotation_id);

    CREATE TABLE IF NOT EXISTS reading_progress (
      id text PRIMARY KEY NOT NULL,
      owner_user_id text NOT NULL,
      document_id text NOT NULL,
      version_id text NOT NULL,
      current_page integer NOT NULL DEFAULT 1,
      unlocked_page integer NOT NULL DEFAULT 1,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES user(id) ON DELETE cascade,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE cascade,
      FOREIGN KEY (version_id) REFERENCES document_versions(id) ON DELETE cascade
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_reading_progress_document ON reading_progress (owner_user_id, document_id, version_id);
    CREATE INDEX IF NOT EXISTS idx_reading_progress_document ON reading_progress (owner_user_id, document_id);

    CREATE TABLE IF NOT EXISTS review_questions (
      id text PRIMARY KEY NOT NULL,
      owner_user_id text NOT NULL,
      document_id text NOT NULL,
      version_id text NOT NULL,
      page_number integer NOT NULL,
      question text NOT NULL,
      expected_answer text NOT NULL,
      source_hint text,
      discipline text NOT NULL DEFAULT 'general',
      evaluation_mode text NOT NULL DEFAULT 'flexible',
      status text NOT NULL DEFAULT 'pending',
      correct_count integer NOT NULL DEFAULT 0,
      incorrect_count integer NOT NULL DEFAULT 0,
      model text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES user(id) ON DELETE cascade,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE cascade,
      FOREIGN KEY (version_id) REFERENCES document_versions(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS idx_review_questions_document ON review_questions (owner_user_id, document_id, page_number);
    CREATE INDEX IF NOT EXISTS idx_review_questions_status ON review_questions (owner_user_id, document_id, status);

    CREATE TABLE IF NOT EXISTS review_attempts (
      id text PRIMARY KEY NOT NULL,
      question_id text NOT NULL,
      owner_user_id text NOT NULL,
      answer text NOT NULL,
      grade text NOT NULL,
      feedback text NOT NULL DEFAULT '',
      created_at integer NOT NULL,
      FOREIGN KEY (question_id) REFERENCES review_questions(id) ON DELETE cascade,
      FOREIGN KEY (owner_user_id) REFERENCES user(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS idx_review_attempts_question ON review_attempts (question_id, created_at);

    CREATE TABLE IF NOT EXISTS ingestion_jobs (
      id text PRIMARY KEY NOT NULL,
      document_id text NOT NULL,
      version_id text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      last_error text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE cascade,
      FOREIGN KEY (version_id) REFERENCES document_versions(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON ingestion_jobs (status, created_at);
  `);

  for (const statement of [
    "ALTER TABLE review_questions ADD COLUMN discipline text NOT NULL DEFAULT 'general'",
    "ALTER TABLE review_questions ADD COLUMN evaluation_mode text NOT NULL DEFAULT 'flexible'",
  ]) {
    try {
      sqlite.exec(statement);
    } catch (err) {
      if (!String((err as Error).message).includes("duplicate column name")) throw err;
    }
  }
}

async function buildDb() {
  const [{ default: Database }, { drizzle }, fs, path] = await Promise.all([
    import("better-sqlite3"),
    import("drizzle-orm/better-sqlite3"),
    import("node:fs/promises"),
    import("node:path"),
  ]);

  const dbPath = resolveDbPath();
  await fs.mkdir(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  runMigrations(sqlite);

  return drizzle(sqlite, { schema });
}

export async function getDb() {
  if (!_db) _db = await buildDb();
  return _db;
}

export function getDbPath() {
  return resolveDbPath();
}
