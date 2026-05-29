import { createFileRoute } from "@tanstack/react-router";
import { getSessionFromRequest } from "#/lib/session";
import { getCurrentDocumentFile, getOwnedDocument } from "#/lib/document-service";
import { readStoredDocumentFile } from "#/lib/storage";

export const Route = createFileRoute("/api/documents/$documentId/file")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await getSessionFromRequest(request);
        if (!session) return new Response("Unauthorized", { status: 401 });

        const { getDb } = await import("#/lib/db");
        const db = await getDb();
        const document = await getOwnedDocument(db, session.sub, params.documentId);
        if (!document?.currentVersionId) return new Response("Not found", { status: 404 });

        const file = await getCurrentDocumentFile(db, document.id, document.currentVersionId);
        if (!file) return new Response("Not found", { status: 404 });

        const stored = await readStoredDocumentFile({
          localPath: file.localPath,
          fileName: file.fileName,
          objectKey: file.objectKey,
        });

        return new Response(new Uint8Array(stored.buffer), {
          headers: {
            "Content-Type": file.mimeType || stored.contentType,
            "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
            "Cache-Control": "private, max-age=60",
          },
        });
      },
    },
  },
});
