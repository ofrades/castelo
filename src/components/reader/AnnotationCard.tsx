import { useCallback, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import { deleteAnnotation } from "#/server/documents";
import { createAnnotationThread, getThread } from "#/server/threads";
import { streamChatResponse } from "#/lib/ai-stream";
import type { ReaderAnnotation } from "#/lib/document-service";
import type { Document } from "#/lib/schema";
import type { ThreadWithMessages } from "#/lib/thread-service";

function annotationPreview(annotation: ReaderAnnotation) {
  return annotation.body.trim() || annotation.selectedText?.trim() || "Untitled";
}

function latestAssistantMessage(thread: ThreadWithMessages | null) {
  if (!thread) return null;
  const assistantMessages = thread.messages.filter(
    (message) => message.role === "assistant" && message.content.trim(),
  );
  return assistantMessages[assistantMessages.length - 1] ?? null;
}

export function AnnotationCard({
  annotation,
  document,
  active,
  onFocus,
  onDelete,
}: {
  annotation: ReaderAnnotation;
  document: Document;
  active: boolean;
  onFocus: () => void;
  onDelete: (annotationId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [thread, setThread] = useState<ThreadWithMessages | null>(null);
  const [generating, setGenerating] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const generateInsight = useCallback(
    async (message: string) => {
      if (generating) return;
      setGenerating(true);
      setError(null);
      setStreamedText("");

      try {
        let threadId = thread?.thread.id;
        if (!threadId) {
          const created = await createAnnotationThread({
            data: {
              documentId: document.id,
              annotationId: annotation.id,
              scope: "annotation",
              title: annotationPreview(annotation).slice(0, 60),
            },
          });
          threadId = created.id;
        }

        await streamChatResponse(
          threadId,
          message,
          {
            documentTitle: document.title,
            selectedText: annotation.selectedText ?? undefined,
          },
          (text) => setStreamedText(text),
        );

        const full = await getThread({ data: { threadId } });
        setThread(full);
        setStreamedText("");
        setFollowUp("");
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === "INSUFFICIENT_FUNDS") {
          setError("Wallet too low.");
        } else {
          setError(msg || "Failed.");
        }
      } finally {
        setGenerating(false);
      }
    },
    [generating, thread, annotation, document.id, document.title],
  );

  async function removeAnnotation() {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAnnotation({ data: { documentId: document.id, annotationId: annotation.id } });
      onDelete(annotation.id);
    } catch (err) {
      setError((err as Error).message || "Could not delete note.");
    } finally {
      setDeleting(false);
    }
  }

  const assistantMessage = latestAssistantMessage(thread);
  const displayText = streamedText || assistantMessage?.content || "";

  return (
    <div
      className={`border-b border-border py-3 transition-colors ${active ? "text-primary" : "hover:text-foreground"}`}
    >
      <div className="flex items-start gap-2">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onFocus}>
          <p className="line-clamp-4 text-xs leading-relaxed">{annotationPreview(annotation)}</p>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
          disabled={deleting}
          onClick={removeAnnotation}
          aria-label="Delete note"
        >
          {deleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
        </Button>
      </div>

      {annotation.scope !== "document" && (
        <div className="mt-2">
          {!expanded ? (
            <button
              type="button"
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => {
                setExpanded(true);
                if (assistantMessage) return;
                generateInsight("Explain the key idea in this passage in one short sentence.");
              }}
              disabled={generating}
            >
              {generating && !assistantMessage
                ? "Generating..."
                : assistantMessage
                  ? "Insight"
                  : "Ask AI"}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">AI</span>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => setExpanded(false)}
                >
                  Hide
                </button>
              </div>

              {displayText ? (
                <div className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                  {displayText}
                  {generating && streamedText ? (
                    <span className="inline-block h-3 w-0.5 animate-pulse bg-current align-middle" />
                  ) : null}
                </div>
              ) : generating ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Thinking...
                </div>
              ) : null}

              <div className="flex items-end gap-1.5">
                <Textarea
                  value={followUp}
                  onChange={(event) => setFollowUp(event.target.value)}
                  placeholder="Ask..."
                  className="min-h-7 flex-1 resize-none py-1 text-[11px]"
                  rows={1}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (followUp.trim()) generateInsight(followUp);
                    }
                  }}
                />
                <Button
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  disabled={!followUp.trim() || generating}
                  onClick={() => generateInsight(followUp)}
                >
                  Ask
                </Button>
              </div>

              {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
