import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { ChevronLeft, ChevronRight, Loader2, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { HighlightLayer } from "./HighlightLayer";
import type { ReaderAnnotation } from "#/lib/document-service";

type PdfModule = typeof import("pdfjs-dist");

type PdfPageSize = {
  width: number;
  height: number;
};

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.5;
const SCALE_STEP = 0.15;

function pageNumbers(count: number) {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampPage(page: number, pageCount: number) {
  if (!pageCount) return 1;
  return clamp(page, 1, pageCount);
}

function getScrollRoot(container: HTMLElement | null) {
  return container?.closest<HTMLElement>("[data-reader-scroll-root]") ?? null;
}

function topInsideScrollRoot(element: HTMLElement, scrollRoot: HTMLElement) {
  const elementBounds = element.getBoundingClientRect();
  const rootBounds = scrollRoot.getBoundingClientRect();
  return scrollRoot.scrollTop + elementBounds.top - rootBounds.top;
}

function getToolbarHeight(container: HTMLElement | null) {
  return (
    container?.querySelector<HTMLElement>("[data-pdf-toolbar]")?.getBoundingClientRect().height ?? 0
  );
}

export function PdfReader({
  fileUrl,
  annotations,
  activeAnnotationId,
  maxAllowedPage,
  onCurrentPageChange,
  onBlockedPageAttempt,
  onPageRead,
  onPageText,
}: {
  fileUrl: string;
  annotations: ReaderAnnotation[];
  activeAnnotationId: string | null;
  maxAllowedPage?: number;
  onCurrentPageChange?: (page: number) => void;
  onBlockedPageAttempt?: (page: number) => void;
  onPageRead?: (page: number) => void;
  onPageText?: (page: number, text: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pdfjs, setPdfjs] = useState<PdfModule | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [basePageSize, setBasePageSize] = useState<PdfPageSize | null>(null);
  const [scale, setScale] = useState(1.15);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: any = null;

    async function load() {
      setError(null);
      setPdf(null);
      setPageCount(0);
      setCurrentPage(1);
      setPageInput("1");
      const [pdfjsModule, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      pdfjsModule.GlobalWorkerOptions.workerSrc = worker.default;
      if (cancelled) return;
      setPdfjs(pdfjsModule);
      loadingTask = pdfjsModule.getDocument({
        url: fileUrl,
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
        iccUrl: "/pdfjs/iccs/",
        standardFontDataUrl: "/pdfjs/standard_fonts/",
        wasmUrl: "/pdfjs/wasm/",
        useWasm: true,
        useWorkerFetch: true,
        isImageDecoderSupported: false,
        isOffscreenCanvasSupported: false,
      });
      const loaded = await loadingTask.promise;
      const firstPage = await loaded.getPage(1);
      const firstViewport = firstPage.getViewport({ scale: 1 });
      if (cancelled) return;
      setPdf(loaded);
      setPageCount(loaded.numPages);
      setBasePageSize({ width: firstViewport.width, height: firstViewport.height });
    }

    load().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Could not load PDF");
    });

    return () => {
      cancelled = true;
      loadingTask?.destroy?.();
      setPdf(null);
      setPageCount(0);
    };
  }, [fileUrl]);

  const pages = useMemo(() => pageNumbers(pageCount), [pageCount]);

  const measureCurrentPage = useCallback(() => {
    const container = containerRef.current;
    const scrollRoot = getScrollRoot(container);
    if (!container || !scrollRoot || !pageCount) return currentPage;

    const readingLine = scrollRoot.getBoundingClientRect().top + getToolbarHeight(container) + 16;
    const pageElements = Array.from(container.querySelectorAll<HTMLElement>("[data-reader-page]"));
    let nextPage = currentPage;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const page of pageElements) {
      const bounds = page.getBoundingClientRect();
      const distance = Math.abs(bounds.top - readingLine);
      const containsReadingLine = bounds.top <= readingLine && bounds.bottom >= readingLine;
      const score = containsReadingLine ? -distance : distance;
      if (score < bestDistance) {
        bestDistance = score;
        nextPage = Number(page.dataset.pageNumber || 1);
      }
    }

    return clampPage(nextPage, pageCount);
  }, [currentPage, pageCount]);

  const jumpToPage = useCallback(
    (pageNumber: number) => {
      const targetPage = Math.min(clampPage(pageNumber, pageCount), maxAllowedPage ?? pageCount);
      const page = containerRef.current?.querySelector<HTMLElement>(
        `[data-reader-page][data-page-number="${targetPage}"]`,
      );
      const scrollRoot = getScrollRoot(containerRef.current);
      if (!page || !scrollRoot) return;

      setPageInput(String(targetPage));
      scrollRoot.scrollTo({
        top: Math.max(
          0,
          topInsideScrollRoot(page, scrollRoot) - getToolbarHeight(containerRef.current) - 16,
        ),
        behavior: "smooth",
      });
    },
    [maxAllowedPage, pageCount],
  );

  const fitWidth = useCallback(() => {
    const scrollRoot = getScrollRoot(containerRef.current);
    if (!scrollRoot || !basePageSize) return;
    const availableWidth = Math.max(320, scrollRoot.clientWidth - 96);
    setScale(clamp(availableWidth / basePageSize.width, MIN_SCALE, MAX_SCALE));
  }, [basePageSize]);

  const lastAllowedPage = Math.min(pageCount || 1, maxAllowedPage ?? (pageCount || 1));

  function submitPageJump(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPage = Number.parseInt(pageInput, 10);
    if (Number.isFinite(nextPage)) jumpToPage(nextPage);
    else setPageInput(String(currentPage));
  }

  useEffect(() => {
    setPageInput(String(currentPage));
    onCurrentPageChange?.(currentPage);
    onPageRead?.(currentPage);
  }, [currentPage, onCurrentPageChange, onPageRead]);

  useEffect(() => {
    const scrollRoot = getScrollRoot(containerRef.current);
    if (!scrollRoot || !pageCount) return;

    let animationFrame = 0;
    const updateCurrentPage = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const nextPage = measureCurrentPage();
        const allowedPage = maxAllowedPage ?? pageCount;
        if (nextPage > allowedPage) {
          onBlockedPageAttempt?.(nextPage);
          jumpToPage(allowedPage);
          return;
        }
        setCurrentPage((value) => (value === nextPage ? value : nextPage));
      });
    };

    updateCurrentPage();
    scrollRoot.addEventListener("scroll", updateCurrentPage, { passive: true });
    window.addEventListener("resize", updateCurrentPage);
    return () => {
      cancelAnimationFrame(animationFrame);
      scrollRoot.removeEventListener("scroll", updateCurrentPage);
      window.removeEventListener("resize", updateCurrentPage);
    };
  }, [jumpToPage, maxAllowedPage, measureCurrentPage, onBlockedPageAttempt, pageCount, scale]);

  return (
    <div ref={containerRef} className="flex min-h-full flex-col">
      <div
        data-pdf-toolbar="true"
        className="quiet-edge sticky top-0 z-30 flex min-h-13 items-center justify-between gap-3 bg-background/90 px-5 py-2 backdrop-blur"
      >
        <form
          onSubmit={submitPageJump}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            aria-label="Previous page"
            disabled={!pageCount || currentPage <= 1}
            onClick={() => jumpToPage(currentPage - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="pl-1">P.</span>
          <Input
            value={pageInput}
            inputMode="numeric"
            aria-label="Current page"
            className="h-7 w-12 border-border/70 bg-card px-2 text-center text-xs shadow-none"
            disabled={!pageCount}
            onChange={(event) => setPageInput(event.target.value)}
            onBlur={() => setPageInput(String(currentPage))}
          />
          <span className="pr-1">/ {pageCount || "..."}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            aria-label="Next page"
            disabled={!pageCount || currentPage >= lastAllowedPage}
            onClick={() => jumpToPage(currentPage + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </form>

        <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            aria-label="Zoom out"
            onClick={() => setScale((value) => clamp(value - SCALE_STEP, MIN_SCALE, MAX_SCALE))}
          >
            <ZoomOut className="size-4" />
          </Button>
          <div className="w-12 text-center">{Math.round(scale * 100)}%</div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            aria-label="Zoom in"
            onClick={() => setScale((value) => clamp(value + SCALE_STEP, MIN_SCALE, MAX_SCALE))}
          >
            <ZoomIn className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-full px-2 text-xs"
            disabled={!basePageSize}
            onClick={fitWidth}
          >
            <Maximize2 className="size-3.5" />
            Aptare
          </Button>
        </div>
      </div>

      {error ? (
        <div className="m-8 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : !pdf || !pdfjs ? (
        <div className="flex h-80 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Preparing reader
        </div>
      ) : (
        <div className="flex flex-col items-center gap-10 px-6 py-10">
          {pages.map((pageNumber) => (
            <PdfPage
              key={pageNumber}
              pdf={pdf}
              pdfjs={pdfjs}
              pageNumber={pageNumber}
              scale={scale}
              annotations={annotations}
              activeAnnotationId={activeAnnotationId}
              onPageText={onPageText}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PdfPage({
  pdf,
  pdfjs,
  pageNumber,
  scale,
  annotations,
  activeAnnotationId,
  onPageText,
}: {
  pdf: any;
  pdfjs: PdfModule;
  pageNumber: number;
  scale: number;
  annotations: ReaderAnnotation[];
  activeAnnotationId: string | null;
  onPageText?: (page: number, text: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    let cancelled = false;
    let renderTask: any = null;
    let textLayer: any = null;

    async function renderPage() {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;

      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const textLayerElement = textLayerRef.current;
      if (!canvas || !textLayerElement) return;
      const context = canvas.getContext("2d");
      if (!context) return;

      textLayerElement.replaceChildren();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      setSize({ width: viewport.width, height: viewport.height });

      renderTask = page.render({
        canvasContext: context,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });

      const textContent = await page.getTextContent();
      if (cancelled) return;
      const pageText = textContent.items
        .map((item: unknown) => ((item as { str?: string }).str ?? "").trim())
        .filter(Boolean)
        .join(" ");
      if (pageText) onPageText?.(pageNumber, pageText);
      textLayer = new pdfjs.TextLayer({
        textContentSource: textContent,
        container: textLayerElement,
        viewport,
      });

      await Promise.all([renderTask.promise, textLayer.render()]);
    }

    renderPage().catch(() => undefined);

    return () => {
      cancelled = true;
      renderTask?.cancel?.();
      textLayer?.cancel?.();
    };
  }, [pdf, pdfjs, pageNumber, scale, onPageText]);

  const pageStyle = {
    width: size.width || undefined,
    height: size.height || undefined,
    "--scale-factor": String(scale),
    "--user-unit": "1",
    "--total-scale-factor": String(scale),
    "--scale-round-x": "1px",
    "--scale-round-y": "1px",
  } as CSSProperties;

  return (
    <div className="relative flex w-full justify-center">
      <div className="absolute -left-10 top-3 hidden text-xs text-muted-foreground xl:block">
        {pageNumber}
      </div>
      <div
        className="reader-page relative overflow-hidden rounded-sm bg-[oklch(0.99_0.004_84)] shadow-[0_18px_70px_oklch(0.24_0.01_72_/_0.08)]"
        data-reader-page="true"
        data-page-number={pageNumber}
        style={pageStyle}
      >
        <canvas ref={canvasRef} className="relative z-0 block" />
        <HighlightLayer
          annotations={annotations}
          pageNumber={pageNumber}
          activeAnnotationId={activeAnnotationId}
        />
        <div ref={textLayerRef} className="pdf-text-layer" />
      </div>
    </div>
  );
}
