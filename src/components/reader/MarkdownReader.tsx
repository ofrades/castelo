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
    <div className="flex justify-center px-6 py-14">
      <article
        className="reader-page quiet-panel relative w-full max-w-3xl px-10 py-9"
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
