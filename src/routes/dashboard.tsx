import { FormEvent, useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  BookMarked,
  CreditCard,
  FilePlus2,
  FileText,
  Loader2,
  LogOut,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { readableDocumentTitle } from "#/lib/document-title";
import { deleteDocument, getDocuments } from "#/server/documents";
import type { Document } from "#/lib/schema";

export const Route = createFileRoute("/dashboard")({
  loader: async () => ({ documents: await getDocuments() }),
  component: DashboardPage,
});

function formatEuro(cents: number) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function DashboardPage() {
  const { session, walletBalance } = Route.useRouteContext();
  const { documents: initialDocuments } = Route.useLoaderData();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState(initialDocuments);
  const [uploading, setUploading] = useState(false);
  const [fileSummary, setFileSummary] = useState("PDF, Markdown, text");
  const [error, setError] = useState<string | null>(null);
  const [balance] = useState(walletBalance);
  const [topupAmount, setTopupAmount] = useState("5");
  const [showTopupNotice, setShowTopupNotice] = useState(() =>
    typeof window === "undefined"
      ? false
      : new URL(window.location.href).searchParams.get("topup") === "1",
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("topup") === "1") {
      url.searchParams.delete("topup");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  async function startCheckout() {
    const amountEur = Math.max(1, Math.min(100, Number.parseInt(topupAmount, 10) || 5));
    const response = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountEur }),
    });
    const payload = (await response.json()) as { url?: string; error?: string };
    if (!response.ok || !payload.url) throw new Error(payload.error || "Checkout failed");
    window.location.href = payload.url;
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploading(true);
    setError(null);
    try {
      const form = event.currentTarget;
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: new FormData(form),
      });
      const payload = (await response.json().catch(() => null)) as null | {
        document?: { documentId: string };
        error?: string;
      };
      if (!response.ok || !payload?.document) {
        throw new Error(payload?.error || "Upload failed");
      }
      form.reset();
      setFileSummary("PDF, Markdown, text");
      await navigate({
        to: "/documents/$documentId",
        params: { documentId: payload.document.documentId },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <BookMarked className="mx-auto mb-4 size-8 text-primary" />
          <h1 className="text-xl font-semibold">Accede ad bibliothecam</h1>
          <div className="mt-5 flex justify-center gap-2">
            <Button asChild>
              <a href="/api/auth/google/start">Google</a>
            </Button>
            <form action="/api/auth/dev" method="post">
              <Button type="submit" variant="outline">
                Locus
              </Button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="quiet-edge bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <a href="/" className="flex items-center gap-2 text-sm font-semibold">
            <BookMarked className="size-4" />
            Castelo
          </a>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Badge variant="outline">{formatEuro(balance)}</Badge>
            <span className="hidden sm:inline">{session.email}</span>
            <form action="/api/auth/signout" method="post">
              <Button size="sm" variant="ghost" type="submit">
                <LogOut className="size-4" />
                Exire
              </Button>
            </form>
          </div>
        </div>
      </header>

      {showTopupNotice ? (
        <div className="quiet-panel fixed right-4 top-16 z-50 flex max-w-xs items-start gap-3 rounded-xl p-4 text-sm shadow-lg">
          <CreditCard className="mt-0.5 size-4 text-primary" />
          <div className="flex-1">
            <div className="font-medium">Solutio accepta</div>
            <div className="mt-1 text-muted-foreground">Pecunia parata est.</div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => setShowTopupNotice(false)}
            aria-label="Dismiss notice"
          >
            <X className="size-3" />
          </Button>
        </div>
      ) : null}

      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-12 lg:grid-cols-[320px_1fr]">
        <section className="quiet-panel h-fit p-5">
          <div className="mb-5 flex items-center gap-2 text-sm font-semibold">
            <FilePlus2 className="size-4 text-primary" />
            Addere
          </div>

          <form onSubmit={upload} className="space-y-4">
            <label className="quiet-edge block cursor-pointer py-8 text-center transition-colors hover:text-primary">
              <Upload className="mx-auto mb-2 size-5 text-muted-foreground" />
              <span className="block text-sm font-medium">Eligere</span>
              <span className="mt-1 block text-xs text-muted-foreground">{fileSummary}</span>
              <input
                name="files"
                type="file"
                multiple
                accept="application/pdf,text/markdown,text/plain,.md,.markdown,.mdx,.txt"
                className="sr-only"
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  if (!files.length) {
                    setFileSummary("PDF, Markdown, text");
                  } else if (files.length === 1) {
                    setFileSummary(files[0]!.name);
                  } else {
                    setFileSummary(`${files.length} files selected`);
                  }
                }}
              />
            </label>

            {error ? (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <Button type="submit" disabled={uploading} variant="outline" className="w-full">
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FilePlus2 className="size-4" />
              )}
              Aperire
            </Button>
          </form>

          <div className="mt-8 border-t border-border pt-6">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <CreditCard className="size-4 text-primary" />
              Stipendium
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">EUR</span>
              <input
                type="number"
                min={1}
                max={100}
                value={topupAmount}
                onChange={(event) => setTopupAmount(event.target.value)}
                className="h-9 w-20 rounded-md border border-input bg-background px-2 text-sm"
              />
              <Button type="button" variant="ghost" onClick={() => void startCheckout()}>
                Addere
              </Button>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Bibliotheca
              </div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Documenta</h1>
            </div>
            <div className="text-sm text-muted-foreground">{documents.length} tota</div>
          </div>

          {documents.length === 0 ? (
            <div className="quiet-panel p-10 text-center">
              <FileText className="mx-auto mb-3 size-8 text-muted-foreground/50" />
              <p className="font-medium">Nulla documenta</p>
            </div>
          ) : (
            <div className="quiet-panel overflow-hidden">
              {documents.map((document) => (
                <DocumentRow
                  key={document.id}
                  document={document}
                  onDeleted={(documentId) =>
                    setDocuments((current) => current.filter((item) => item.id !== documentId))
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function DocumentRow({
  document,
  onDeleted,
}: {
  document: Document;
  onDeleted: (documentId: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function removeDocument() {
    if (deleting) return;
    const confirmed = window.confirm(
      `Delete "${readableDocumentTitle(document.title)}"? This also deletes its notes and review progress.`,
    );
    if (!confirmed) return;
    setDeleting(true);
    try {
      await deleteDocument({ data: { documentId: document.id } });
      onDeleted(document.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="group flex items-center justify-between gap-4 border-b border-border/70 px-4 py-5 transition-colors last:border-b-0 hover:bg-accent/20">
      <a href={`/documents/${document.id}`} className="min-w-0 flex-1">
        <div className="truncate font-medium">{readableDocumentTitle(document.title)}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Added {new Date(document.createdAt).toLocaleDateString()}
        </div>
      </a>
      <div className="flex shrink-0 items-center gap-3">
        <Badge className="capitalize">{document.kind}</Badge>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          disabled={deleting}
          onClick={removeDocument}
          aria-label="Delete document"
        >
          {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </Button>
        <a href={`/documents/${document.id}`} aria-label="Open document">
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
        </a>
      </div>
    </div>
  );
}
