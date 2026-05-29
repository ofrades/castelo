import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReaderShell } from "#/components/reader/ReaderShell";
import { getReaderDocument } from "#/server/documents";

export const Route = createFileRoute("/documents/$documentId")({
  loader: async ({ params }) => {
    const data = await getReaderDocument({ data: { documentId: params.documentId } });
    if (!data) throw notFound();
    return data;
  },
  component: DocumentPage,
  notFoundComponent: () => (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Document not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been removed or belongs to another workspace.
        </p>
        <a href="/dashboard" className="mt-4 inline-flex text-sm font-medium text-primary">
          Back to library
        </a>
      </div>
    </main>
  ),
});

function DocumentPage() {
  const data = Route.useLoaderData();
  return (
    <ReaderShell
      document={data.document}
      initialAnnotations={data.annotations}
      markdown={data.markdown}
      fileUrl={data.fileUrl}
    />
  );
}
