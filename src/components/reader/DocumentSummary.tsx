import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "#/components/ui/button";
import { createAnnotationThread, getDocumentThreads, getThread } from "#/server/threads";
import { streamChatResponse } from "#/lib/ai-stream";
import type { Document } from "#/lib/schema";
import type { ThreadWithMessages } from "#/lib/thread-service";

function chunkText(text: string, maxLength = 2000): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + maxLength));
    start += maxLength;
  }
  return chunks;
}

function latestAssistantMessage(thread: ThreadWithMessages | null) {
  if (!thread) return null;
  const assistantMessages = thread.messages.filter(
    (message) => message.role === "assistant" && message.content.trim(),
  );
  return assistantMessages[assistantMessages.length - 1] ?? null;
}

export function DocumentSummary({ document, markdown }: { document: Document; markdown: string }) {
  const [thread, setThread] = useState<ThreadWithMessages | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchThread() {
      setLoading(true);
      try {
        const threads = await getDocumentThreads({ data: { documentId: document.id } });
        if (cancelled) return;
        const docThread = threads.find((t) => t.scope === "document");
        if (docThread) {
          const full = await getThread({ data: { threadId: docThread.id } });
          if (!cancelled) setThread(full);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchThread();
    return () => {
      cancelled = true;
    };
  }, [document.id]);

  const generateSummary = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    setStreamedText("");

    try {
      const docThread = await createAnnotationThread({
        data: {
          documentId: document.id,
          annotationId: null,
          scope: "document",
          title: `Summary: ${document.title.slice(0, 40)}`,
        },
      });

      const chunks =
        document.kind === "markdown" || document.kind === "text" ? chunkText(markdown) : [];

      const prompt =
        "Summarize this text. Cover the main idea, key points, structure, and notable passages. Keep it grounded in the document and use clear headings when helpful.";

      await streamChatResponse(
        docThread.id,
        prompt,
        {
          documentTitle: document.title,
          surroundingChunks: chunks,
        },
        (text) => setStreamedText(text),
      );

      const full = await getThread({ data: { threadId: docThread.id } });
      setThread(full);
      setStreamedText("");
    } catch (err) {
      const message = (err as Error).message;
      if (message === "INSUFFICIENT_FUNDS") {
        setError("Your wallet balance is too low to generate a summary.");
      } else {
        setError(message || "Failed to generate summary.");
      }
    } finally {
      setGenerating(false);
    }
  }, [generating, document.id, document.kind, document.title, markdown]);

  const assistantMessage = latestAssistantMessage(thread);
  const displayText = streamedText || assistantMessage?.content || "";

  if (loading) {
    return (
      <div className="flex h-80 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Paratur
      </div>
    );
  }

  if (!assistantMessage && !generating) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center gap-4 p-10 text-center">
        <Sparkles className="size-7 text-muted-foreground/35" />
        <div>
          <p className="font-medium">Summa nulla</p>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Generate a concise guide when you need one.
          </p>
        </div>
        <Button onClick={generateSummary} disabled={generating} variant="outline">
          <Sparkles className="size-4" />
          Summam creare
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-12">
      <div className="mb-10 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Summa</h2>
        <Button variant="outline" size="sm" onClick={generateSummary} disabled={generating}>
          {generating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          Iterare
        </Button>
      </div>

      {generating && !streamedText ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Scribitur
        </div>
      ) : null}

      {displayText ? (
        <article className="reader-prose rounded-xl border border-[var(--border-soft)] bg-card/55 px-6 py-5 sm:px-8 sm:py-7">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayText}</ReactMarkdown>
        </article>
      ) : null}

      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
