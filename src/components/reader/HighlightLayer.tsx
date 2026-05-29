import type { AnnotationSelector, ReaderAnnotation } from "#/lib/document-service";

function rectsForPage(selector: AnnotationSelector, pageNumber: number) {
  return (selector.rects ?? []).filter((rect) => rect.page === pageNumber);
}

export function HighlightLayer({
  annotations,
  pageNumber,
  activeAnnotationId,
}: {
  annotations: ReaderAnnotation[];
  pageNumber: number;
  activeAnnotationId: string | null;
}) {
  const rects = annotations.flatMap((annotation) =>
    rectsForPage(annotation.selectorJson, pageNumber).map((rect) => ({ rect, annotation })),
  );

  if (!rects.length) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
      {rects.map(({ rect, annotation }, index) => (
        <div
          key={`${annotation.id}-${index}`}
          className={`reader-highlight ${annotation.id === activeAnnotationId ? "reader-highlight-active" : ""}`}
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
          }}
        />
      ))}
    </div>
  );
}
