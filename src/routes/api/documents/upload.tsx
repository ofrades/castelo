import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { getSessionFromRequest } from "#/lib/session";
import { createDocumentFromUpload } from "#/lib/document-service";
import { guessDocumentKind } from "#/lib/storage";
import { MIN_WALLET_BALANCE_CENTS } from "#/lib/ai-config";

const MAX_UPLOAD_FILE_COUNT = 12;
const MAX_UPLOAD_SINGLE_FILE_BYTES = 50 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_UPLOAD_CONTENT_LENGTH_BYTES = 220 * 1024 * 1024;

function validateUploadEnvelope(req: Request) {
  const header = req.headers.get("content-length");
  const contentLength = header ? Number.parseInt(header, 10) : Number.NaN;
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_CONTENT_LENGTH_BYTES) {
    return `Upload exceeds the ${Math.round(MAX_UPLOAD_TOTAL_BYTES / (1024 * 1024))}MB batch limit.`;
  }
  return null;
}

function validateUploadedFiles(files: File[]) {
  if (files.length === 0) return "No file provided";
  if (files.length > MAX_UPLOAD_FILE_COUNT)
    return `Upload supports up to ${MAX_UPLOAD_FILE_COUNT} files.`;

  let totalBytes = 0;
  for (const file of files) {
    const size = Number.isFinite(file.size) ? file.size : 0;
    if (size > MAX_UPLOAD_SINGLE_FILE_BYTES) {
      return `${file.name || "A file"} exceeds the ${Math.round(MAX_UPLOAD_SINGLE_FILE_BYTES / (1024 * 1024))}MB per-file limit.`;
    }
    totalBytes += size;
    if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
      return `Upload exceeds the ${Math.round(MAX_UPLOAD_TOTAL_BYTES / (1024 * 1024))}MB batch limit.`;
    }

    const kind = guessDocumentKind(file.name, file.type);
    if (kind === "other") {
      return `${file.name || "A file"} is not supported yet. Upload PDF, Markdown, or text files.`;
    }
  }

  return null;
}

async function bufferUploadedFiles(files: File[]) {
  const buffered: Array<{ fileName: string; fileType: string; arrayBuffer: ArrayBuffer }> = [];
  let totalBytes = 0;
  for (const [index, file] of files.entries()) {
    const arrayBuffer = await file.arrayBuffer();
    totalBytes += arrayBuffer.byteLength;
    if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) throw new Error("Upload exceeds configured limits.");
    buffered.push({
      fileName: file.name || `document-${index + 1}`,
      fileType: file.type || "application/octet-stream",
      arrayBuffer,
    });
  }
  return buffered;
}

export const Route = createFileRoute("/api/documents/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getSessionFromRequest(request);
        if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

        const { getDb } = await import("#/lib/db");
        const { user } = await import("#/lib/schema");
        const db = await getDb();

        const [u] = await db
          .select({ walletBalance: user.walletBalance })
          .from(user)
          .where(eq(user.id, session.sub))
          .limit(1);

        const isAdmin = session.email === "mig.silva@gmail.com";
        if (!isAdmin && (u?.walletBalance ?? 0) < MIN_WALLET_BALANCE_CENTS) {
          return Response.json({ error: "INSUFFICIENT_FUNDS" }, { status: 402 });
        }

        const envelopeError = validateUploadEnvelope(request);
        if (envelopeError) return Response.json({ error: envelopeError }, { status: 413 });

        const formData = await request.formData();
        const files = [...formData.getAll("file"), ...formData.getAll("files")].filter(
          (entry): entry is File => entry instanceof File,
        );
        const validationError = validateUploadedFiles(files);
        if (validationError) return Response.json({ error: validationError }, { status: 413 });

        const title =
          typeof formData.get("title") === "string" ? String(formData.get("title")) : null;
        const buffered = await bufferUploadedFiles(files);
        await db
          .insert(user)
          .values({
            id: session.sub,
            email: session.email,
            name: session.name,
            image: session.image ?? null,
          })
          .onConflictDoNothing();

        const documents = [];
        for (const file of buffered) {
          documents.push(
            await createDocumentFromUpload(db, {
              ownerUserId: session.sub,
              file,
              title: buffered.length === 1 ? title : null,
            }),
          );
        }

        return Response.json({ success: true, documents, document: documents[0] });
      },
    },
  },
});
