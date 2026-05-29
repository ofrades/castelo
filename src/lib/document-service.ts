import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import type { getDb } from "./db";
import {
  annotations,
  documentChunks,
  documentFiles,
  documents,
  documentVersions,
  type Annotation,
} from "./schema";
import {
  guessContentType,
  guessDocumentKind,
  deleteBackedUpDocuments,
  getDocumentVersionDir,
  storeDocumentOriginal,
  titleFromFileName,
  type UploadedBinary,
} from "./storage";

export type Db = Awaited<ReturnType<typeof getDb>>;

export type AnnotationSelector = {
  type: "TextQuoteSelector";
  exact: string;
  prefix?: string;
  suffix?: string;
  rects?: Array<{
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  markdown?: {
    blockId?: string | null;
  };
};

export type ReaderAnnotation = Omit<Annotation, "selectorJson"> & {
  selectorJson: AnnotationSelector;
};

function normalizeTitle(title: string) {
  return title.trim().replace(/\s+/g, " ").slice(0, 180) || "Untitled document";
}

const DEFAULT_DOCUMENT_FILE = "Familia Romana Cap I.pdf";
const DEFAULT_DOCUMENT_TITLE = titleFromFileName(DEFAULT_DOCUMENT_FILE);

export async function ensureDefaultDocumentsForUser(db: Db, ownerUserId: string) {
  const [existing] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.ownerUserId, ownerUserId), eq(documents.title, DEFAULT_DOCUMENT_TITLE)))
    .limit(1);
  if (existing) return;

  const buffer = await readFile(join(process.cwd(), DEFAULT_DOCUMENT_FILE));
  await createDocumentFromUpload(db, {
    ownerUserId,
    file: {
      fileName: DEFAULT_DOCUMENT_FILE,
      fileType: "application/pdf",
      arrayBuffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    },
    title: DEFAULT_DOCUMENT_TITLE,
  });
}

function chunkText(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const chunks: Array<{ text: string; charStart: number; charEnd: number; blockId: string }> = [];
  const blocks = normalized.split(/\n{2,}/g);
  let cursor = 0;

  for (const [index, block] of blocks.entries()) {
    const trimmed = block.trim();
    if (!trimmed) {
      cursor += block.length + 2;
      continue;
    }

    let start = normalized.indexOf(trimmed, cursor);
    if (start === -1) start = cursor;
    const end = start + trimmed.length;
    chunks.push({
      text: trimmed,
      charStart: start,
      charEnd: end,
      blockId: `block-${index + 1}`,
    });
    cursor = end;
  }

  return chunks;
}

export async function createDocumentFromUpload(
  db: Db,
  args: {
    ownerUserId: string;
    file: UploadedBinary;
    title?: string | null;
  },
) {
  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const mimeType = guessContentType(args.file.fileName, args.file.fileType);
  const kind = guessDocumentKind(args.file.fileName, mimeType);
  const title = normalizeTitle(args.title || titleFromFileName(args.file.fileName));
  const stored = await storeDocumentOriginal({
    ownerUserId: args.ownerUserId,
    documentId,
    versionId,
    file: args.file,
  });
  const now = new Date();

  await db.insert(documents).values({
    id: documentId,
    ownerUserId: args.ownerUserId,
    title,
    kind,
    mimeType,
    status: "ready",
    currentVersionId: versionId,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(documentVersions).values({
    id: versionId,
    documentId,
    versionNumber: 1,
    sourceSha256: stored.file.sha256,
    createdAt: now,
  });

  await db.insert(documentFiles).values({
    id: fileId,
    documentId,
    versionId,
    fileName: stored.file.fileName,
    mimeType: stored.file.fileType,
    sizeBytes: stored.file.sizeBytes,
    storageProvider: stored.storageProvider,
    localPath: stored.file.localPath,
    objectKey: stored.file.objectKey,
    createdAt: now,
  });

  if (kind === "markdown" || kind === "text") {
    const text = new TextDecoder().decode(args.file.arrayBuffer);
    const chunks = chunkText(text);
    if (chunks.length) {
      await db.insert(documentChunks).values(
        chunks.map((chunk, index) => ({
          id: crypto.randomUUID(),
          documentId,
          versionId,
          ordinal: index,
          pageNumber: null,
          blockId: chunk.blockId,
          text: chunk.text,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          createdAt: now,
        })),
      );
    }
  }

  return {
    documentId,
    versionId,
    fileId,
    title,
    kind,
    backupStatus: stored.backupStatus,
    storageProvider: stored.storageProvider,
  };
}

export async function getOwnedDocument(db: Db, ownerUserId: string, documentId: string) {
  const [document] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.ownerUserId, ownerUserId)))
    .limit(1);
  return document ?? null;
}

export async function getCurrentDocumentFile(db: Db, documentId: string, versionId: string) {
  const [file] = await db
    .select()
    .from(documentFiles)
    .where(and(eq(documentFiles.documentId, documentId), eq(documentFiles.versionId, versionId)))
    .limit(1);
  return file ?? null;
}

export async function getDocumentMarkdown(db: Db, documentId: string, versionId: string) {
  const rows = await db
    .select({ text: documentChunks.text })
    .from(documentChunks)
    .where(and(eq(documentChunks.documentId, documentId), eq(documentChunks.versionId, versionId)))
    .orderBy(documentChunks.ordinal);
  return rows.map((row) => row.text).join("\n\n");
}

export async function listOwnedDocuments(db: Db, ownerUserId: string) {
  return db
    .select()
    .from(documents)
    .where(eq(documents.ownerUserId, ownerUserId))
    .orderBy(desc(documents.updatedAt), desc(documents.createdAt));
}

export async function listDocumentAnnotations(
  db: Db,
  ownerUserId: string,
  documentId: string,
): Promise<ReaderAnnotation[]> {
  const rows = await db
    .select()
    .from(annotations)
    .where(and(eq(annotations.ownerUserId, ownerUserId), eq(annotations.documentId, documentId)))
    .orderBy(desc(annotations.updatedAt), desc(annotations.createdAt));

  return rows.map((row) => ({
    ...row,
    selectorJson: row.selectorJson as AnnotationSelector,
  }));
}

export async function deleteOwnedDocument(db: Db, ownerUserId: string, documentId: string) {
  const document = await getOwnedDocument(db, ownerUserId, documentId);
  if (!document) return false;

  const [files, versions] = await Promise.all([
    db.select().from(documentFiles).where(eq(documentFiles.documentId, documentId)),
    db.select().from(documentVersions).where(eq(documentVersions.documentId, documentId)),
  ]);

  await db
    .delete(documents)
    .where(and(eq(documents.id, documentId), eq(documents.ownerUserId, ownerUserId)));

  await deleteBackedUpDocuments(
    files.map((file) => file.objectKey).filter((key): key is string => Boolean(key)),
  );

  await Promise.all(
    versions.map((version) =>
      import("node:fs/promises")
        .then((fs) =>
          fs.rm(getDocumentVersionDir(ownerUserId, documentId, version.id), {
            recursive: true,
            force: true,
          }),
        )
        .catch(() => undefined),
    ),
  );

  return true;
}

export async function deleteReaderAnnotation(
  db: Db,
  args: { ownerUserId: string; documentId: string; annotationId: string },
) {
  const result = await db
    .delete(annotations)
    .where(
      and(
        eq(annotations.id, args.annotationId),
        eq(annotations.ownerUserId, args.ownerUserId),
        eq(annotations.documentId, args.documentId),
      ),
    );

  return result.changes > 0;
}

export async function createReaderAnnotation(
  db: Db,
  args: {
    ownerUserId: string;
    documentId: string;
    versionId: string;
    kind: "highlight" | "note" | "question" | "global";
    scope: "inline" | "page" | "block" | "document";
    color?: string;
    selectedText?: string | null;
    body?: string | null;
    selector: AnnotationSelector;
  },
): Promise<ReaderAnnotation> {
  const now = new Date();
  const id = crypto.randomUUID();
  await db.insert(annotations).values({
    id,
    ownerUserId: args.ownerUserId,
    documentId: args.documentId,
    versionId: args.versionId,
    kind: args.kind,
    scope: args.scope,
    color: args.color ?? "amber",
    selectedText: args.selectedText ?? null,
    body: args.body ?? "",
    selectorJson: args.selector,
    createdAt: now,
    updatedAt: now,
  });

  const [row] = await db.select().from(annotations).where(eq(annotations.id, id)).limit(1);
  return { ...row!, selectorJson: row!.selectorJson as AnnotationSelector };
}
