import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HighlightLayer } from "./HighlightLayer";
import type { ReaderAnnotation } from "#/lib/document-service";

export function MarkdownReader({
  markdown,
  annotations,
  activeAnnotationId,
}: {
  markdown: string;
  annotations: ReaderAnnotation[];
  activeAnnotationId: string | null;
}) {
  return (
    <div className="flex justify-center px-4 py-10 sm:px-6 sm:py-14">
      <article
        className="reader-page relative w-full max-w-3xl rounded-xl bg-card/70 px-6 py-8 sm:px-10 sm:py-9"
        data-reader-page="true"
        data-page-number="1"
      >
        <HighlightLayer
          annotations={annotations}
          pageNumber={1}
          activeAnnotationId={activeAnnotationId}
        />
        <div className="reader-prose relative z-20">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {markdown || "No readable text was extracted."}
          </ReactMarkdown>
        </div>
      </article>
    </div>
  );
}
