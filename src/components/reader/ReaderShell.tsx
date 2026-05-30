import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Lock, Plus } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import { readableDocumentTitle } from "#/lib/document-title";
import { addAnnotation } from "#/server/documents";
import { AnnotationCard } from "./AnnotationCard";
import { DocumentSummary } from "./DocumentSummary";
import { MarkdownReader } from "./MarkdownReader";
import { PdfReader } from "./PdfReader";
import { ReviewQuestionnaire } from "./ReviewQuestionnaire";
import type { AnnotationSelector, ReaderAnnotation } from "#/lib/document-service";
import type { Document } from "#/lib/schema";

type PendingSelection = {
  exact: string;
  selector: AnnotationSelector;
};

const annotationKinds = ["highlight", "note", "question"] as const;

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function findPageForRect(root: HTMLElement, rect: DOMRect) {
  const direct = document
    .elementFromPoint(
      Math.min(rect.right - 1, rect.left + 2),
      Math.min(rect.bottom - 1, rect.top + 2),
    )
    ?.closest<HTMLElement>("[data-reader-page]");
  if (direct && root.contains(direct)) return direct;

  const pages = Array.from(root.querySelectorAll<HTMLElement>("[data-reader-page]"));
  return (
    pages.find((page) => {
      const bounds = page.getBoundingClientRect();
      return rect.bottom >= bounds.top && rect.top <= bounds.bottom;
    }) ?? null
  );
}

function selectionFromRoot(root: HTMLElement): PendingSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const exact = selection.toString().trim();
  if (!exact) return null;

  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;
  if (
    !root.contains(
      ancestor.nodeType === Node.ELEMENT_NODE ? (ancestor as Element) : ancestor.parentElement,
    )
  ) {
    return null;
  }

  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 1 && rect.height > 1)
    .map((rect) => {
      const page = findPageForRect(root, rect);
      if (!page) return null;
      const bounds = page.getBoundingClientRect();
      return {
        page: Number(page.dataset.pageNumber || 1),
        x: clamp01((rect.left - bounds.left) / bounds.width),
        y: clamp01((rect.top - bounds.top) / bounds.height),
        width: clamp01(rect.width / bounds.width),
        height: clamp01(rect.height / bounds.height),
      };
    })
    .filter((rect): rect is NonNullable<typeof rect> => Boolean(rect));

  if (!rects.length) return null;

  return {
    exact,
    selector: {
      type: "TextQuoteSelector",
      exact,
      rects,
    },
  };
}

export function ReaderShell({
  document,
  initialAnnotations,
  markdown,
  fileUrl,
}: {
  document: Document;
  initialAnnotations: ReaderAnnotation[];
  markdown: string;
  fileUrl: string;
}) {
  const [annotations, setAnnotations] = useState(initialAnnotations);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [kind, setKind] = useState<(typeof annotationKinds)[number]>("highlight");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"read" | "summary">("read");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [maxPageRead, setMaxPageRead] = useState(
    document.kind === "markdown" || document.kind === "text" ? 1 : 0,
  );
  const [pageTextByPage, setPageTextByPage] = useState<Record<number, string>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [unlockedPage, setUnlockedPage] = useState(1);

  const title = readableDocumentTitle(document.title);

  function captureSelection() {
    const root = window.document.querySelector<HTMLElement>("main");
    if (!root) return;
    const next = selectionFromRoot(root);
    if (!next) return;

    setPendingSelection(next);
    setNoteBody("");
    setKind("highlight");
    setActiveAnnotationId(null);
  }

  function focusAnnotation(annotation: ReaderAnnotation) {
    setActiveAnnotationId(annotation.id);
    if (annotation.scope === "document") return;

    const firstRect = annotation.selectorJson.rects?.[0];
    if (!firstRect) return;

    const page = window.document.querySelector<HTMLElement>(
      `[data-reader-page][data-page-number="${firstRect.page}"]`,
    );
    if (!page) return;

    page.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  useEffect(() => {
    if (document.kind === "markdown" || document.kind === "text") setMaxPageRead(1);
  }, [document.kind]);

  const markPageRead = useCallback((page: number) => {
    if (!Number.isFinite(page)) return;
    setMaxPageRead((current) => Math.max(current, page));
  }, []);

  const rememberPageText = useCallback((page: number, text: string) => {
    setPageTextByPage((current) => {
      if (current[page] === text) return current;
      return { ...current, [page]: text };
    });
  }, []);

  const updateProgressState = useCallback(
    ({ unlockedPage: nextUnlockedPage }: { unlockedPage: number }) => {
      setUnlockedPage(nextUnlockedPage);
    },
    [],
  );

  async function saveInlineAnnotation() {
    if (!pendingSelection || !document.currentVersionId) return;
    setSaving(true);
    try {
      const annotation = await addAnnotation({
        data: {
          documentId: document.id,
          versionId: document.currentVersionId,
          kind,
          scope: "inline",
          selectedText: pendingSelection.exact,
          body: noteBody,
          selector: pendingSelection.selector,
        },
      });
      setAnnotations((current) => [annotation, ...current]);
      focusAnnotation(annotation);
      setPendingSelection(null);
      setNoteBody("");
      window.getSelection()?.removeAllRanges();
    } finally {
      setSaving(false);
    }
  }

  const TabButton = useCallback(
    ({ tab, label }: { tab: "read" | "summary"; label: string }) => (
      <button
        type="button"
        onClick={() => setActiveTab(tab)}
        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${activeTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
      >
        {label}
      </button>
    ),
    [activeTab],
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="app-header flex h-12 shrink-0 items-center justify-between px-4 sm:px-5">
        <div className="flex items-center gap-3">
          <a
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">Bibliotheca</span>
          </a>
          <span className="max-w-[200px] truncate text-sm font-semibold tracking-tight sm:max-w-xs">
            {title}
          </span>
        </div>
        <div className="rounded-full border border-[var(--border-soft)] bg-card/55 p-0.5">
          <TabButton tab="read" label="Legere" />
          <TabButton tab="summary" label="Summa" />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-[240px] shrink-0 flex-col overflow-y-auto border-r border-[var(--border-soft)] bg-sidebar/55 px-5 py-6 xl:flex">
          <div className="space-y-3">
            <h1 className="break-words text-lg font-semibold leading-tight tracking-tight">
              {title}
            </h1>
            <div className="quiet-panel px-3 py-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Lock className="size-4" />
                Progressus
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">Pagina {unlockedPage}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={() => setReviewOpen(true)}
              >
                Quaestiones
              </Button>
            </div>
          </div>
          <div className="mt-auto pt-6">
            <Button asChild variant="outline" size="sm" className="w-full justify-between">
              <a href={fileUrl} target="_blank" rel="noreferrer">
                Originale
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          </div>
        </aside>

        <main data-reader-scroll-root="true" className="min-w-0 flex-1 overflow-auto">
          {activeTab === "read" ? (
            <div onMouseUp={captureSelection}>
              {document.kind === "pdf" ? (
                <PdfReader
                  fileUrl={fileUrl}
                  annotations={annotations}
                  activeAnnotationId={activeAnnotationId}
                  maxAllowedPage={unlockedPage}
                  onCurrentPageChange={setCurrentPage}
                  onPageRead={markPageRead}
                  onPageText={rememberPageText}
                />
              ) : document.kind === "markdown" || document.kind === "text" ? (
                <MarkdownReader
                  markdown={markdown}
                  annotations={annotations}
                  activeAnnotationId={activeAnnotationId}
                />
              ) : (
                <div className="quiet-panel m-8 p-6 text-sm text-muted-foreground">
                  This document type is stored, but the reader does not support it yet.
                </div>
              )}
            </div>
          ) : (
            <DocumentSummary document={document} markdown={markdown} />
          )}
        </main>

        <aside className="hidden w-[300px] shrink-0 flex-col overflow-hidden border-l border-[var(--border-soft)] bg-sidebar/55 lg:flex">
          <div className="flex-1 overflow-y-auto p-3">
            {pendingSelection ? (
              <div className="quiet-panel mb-3 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <Plus className="size-3" />
                  Nova
                </div>
                <blockquote className="mb-2 max-h-20 overflow-auto rounded-md bg-background/80 p-2 text-xs leading-relaxed text-muted-foreground">
                  {pendingSelection.exact}
                </blockquote>
                <div className="mb-2 grid grid-cols-3 gap-1">
                  {annotationKinds.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`rounded-full border px-2 py-0.5 text-[11px] capitalize transition-colors ${kind === value ? "border-primary bg-primary text-primary-foreground" : "border-[var(--border-soft)] bg-background text-muted-foreground hover:text-foreground"}`}
                      onClick={() => setKind(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <Textarea
                  value={noteBody}
                  onChange={(event) => setNoteBody(event.target.value)}
                  placeholder="Nota"
                  className="mb-2 min-h-16 bg-background/80 py-1.5 text-xs"
                />
                <div className="flex justify-end gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setPendingSelection(null)}
                  >
                    Nolle
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={saveInlineAnnotation}
                    disabled={saving}
                  >
                    Servare
                  </Button>
                </div>
              </div>
            ) : null}

            {annotations.length === 0 && !pendingSelection ? (
              <div className="quiet-panel p-3 text-xs leading-relaxed text-muted-foreground">
                Elige verba.
              </div>
            ) : (
              annotations.map((annotation) => (
                <AnnotationCard
                  key={annotation.id}
                  annotation={annotation}
                  document={document}
                  active={annotation.id === activeAnnotationId}
                  onFocus={() => focusAnnotation(annotation)}
                  onDelete={(annotationId) => {
                    setAnnotations((current) => current.filter((item) => item.id !== annotationId));
                    if (activeAnnotationId === annotationId) setActiveAnnotationId(null);
                  }}
                />
              ))
            )}
          </div>
        </aside>
      </div>

      {reviewOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <header className="app-header flex h-12 shrink-0 items-center justify-between px-4 sm:px-5">
            <div className="flex items-center gap-2">
              <Lock className="size-4" />
              <div>
                <p className="text-sm font-medium">Quaestiones</p>
                <p className="text-xs text-muted-foreground">{title}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setReviewOpen(false)}>
              Exire
            </Button>
          </header>
          <main className="min-h-0 flex-1 overflow-auto">
            <ReviewQuestionnaire
              document={document}
              annotations={annotations}
              markdown={markdown}
              maxPageRead={maxPageRead}
              currentPage={currentPage}
              pageTextByPage={pageTextByPage}
              onProgressStateChange={updateProgressState}
            />
          </main>
        </div>
      ) : null}
    </div>
  );
}
