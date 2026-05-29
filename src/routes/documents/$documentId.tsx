import { createFileRoute, notFound } from "@tanstack/react-router";
import { Button } from "#/components/ui/button";
import { PageFrame } from "#/components/ui/app-shell";
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
    <PageFrame className="flex items-center justify-center px-6">
      <div className="quiet-panel max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold tracking-tight">Document not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been removed or belongs to another workspace.
        </p>
        <Button asChild className="mt-5" variant="outline">
          <a href="/dashboard">Back to library</a>
        </Button>
      </div>
    </PageFrame>
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
