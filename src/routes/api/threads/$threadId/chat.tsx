import { chat, toServerSentEventsResponse, type StreamChunk } from "@tanstack/ai";
import { createOpenaiChatCompletions } from "@tanstack/ai-openai";
import { createFileRoute } from "@tanstack/react-router";
import {
  AI_MAX_OUTPUT_TOKENS,
  AI_MODEL,
  createOpenRouterHeaders,
  MIN_WALLET_BALANCE_CENTS,
  OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL,
} from "#/lib/ai-config";
import { getSessionFromRequest } from "#/lib/session";

export const Route = createFileRoute("/api/threads/$threadId/chat")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const session = await getSessionFromRequest(request);
        if (!session) {
          return new Response("Unauthorized", { status: 401 });
        }

        const threadId = params.threadId;
        if (!threadId) {
          return new Response("Missing threadId", { status: 400 });
        }

        const body = (await request.json().catch(() => ({}))) as {
          message?: string;
          context?: {
            documentTitle?: string;
            selectedText?: string;
            surroundingChunks?: string[];
          };
        };

        if (!body.message?.trim()) {
          return new Response("Missing message", { status: 400 });
        }

        const { getDb } = await import("#/lib/db");
        const db = await getDb();
        const { learningArtifacts, user: userTable } = await import("#/lib/schema");
        const { eq } = await import("drizzle-orm");
        const { addThreadMessage, getThreadWithMessages, deductWalletBalance, logUsage } =
          await import("#/lib/thread-service");
        const { getUsdToEurRate } = await import("#/lib/fx");
        const { calculateBilledCost } = await import("#/lib/pricing");

        const thread = await getThreadWithMessages(db, session.sub, threadId);
        if (!thread) {
          return new Response("Thread not found", { status: 404 });
        }

        const [u] = await db
          .select({ walletBalance: userTable.walletBalance })
          .from(userTable)
          .where(eq(userTable.id, session.sub))
          .limit(1);

        const isAdmin = session.email === "mig.silva@gmail.com";

        if (!isAdmin && (u?.walletBalance ?? 0) < MIN_WALLET_BALANCE_CENTS) {
          return new Response("INSUFFICIENT_FUNDS", { status: 402 });
        }

        await addThreadMessage(db, {
          threadId,
          role: "user",
          content: body.message,
        });

        const sessionSub = session.sub;

        const contextParts: string[] = [];
        if (body.context?.documentTitle) {
          contextParts.push(`Document: ${body.context.documentTitle}`);
        }
        if (body.context?.selectedText) {
          contextParts.push(`Selected passage: """${body.context.selectedText}"""`);
        }
        if (body.context?.surroundingChunks?.length) {
          contextParts.push(`Context:\n${body.context.surroundingChunks.join("\n\n")}`);
        }

        const responseStyle =
          thread.thread.scope === "annotation"
            ? "For inline notes, answer in one short sentence only. No heading, no bullets, no multi-paragraph response."
            : thread.thread.scope === "page"
              ? "For page discussion, act like a thoughtful reading partner in a small group: point out interesting and important parts, connect them to the page, and invite attention to what matters."
              : "For document overview, summarize the text clearly: main idea, key points, structure, and notable passages. Use concise headings when helpful.";

        const systemPrompt = [
          "You are a thoughtful learning companion. Help the user understand, explore, and question the material they're reading.",
          "Be precise and grounded in the text. When referencing specific claims, quote or paraphrase the source.",
          responseStyle,
          "If the user asks something outside the document context, answer helpfully but note when you're going beyond the text.",
          contextParts.length ? contextParts.join("\n\n") : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        const priorMessages = thread.messages
          .filter((m: { role: string }) => m.role !== "system")
          .map((m: { role: string; content: string }) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

        const adapter = createOpenaiChatCompletions(AI_MODEL as never, OPENROUTER_API_KEY, {
          baseURL: OPENROUTER_BASE_URL,
          defaultHeaders: createOpenRouterHeaders(),
        }) as any;

        const abortController = new AbortController();

        const aiStream = chat({
          adapter,
          systemPrompts: systemPrompt ? [systemPrompt] : [],
          messages: [...priorMessages, { role: "user", content: body.message }],
          stream: true,
          maxTokens: AI_MAX_OUTPUT_TOKENS,
          abortController,
        });

        function applyTextChunk(current: string, chunk: StreamChunk) {
          const textChunk = chunk as StreamChunk & {
            text?: string;
            delta?: string;
            content?: string;
          };
          if (textChunk.delta) return current + textChunk.delta;
          if (textChunk.text) return current + textChunk.text;
          if (textChunk.content) {
            return textChunk.content.startsWith(current)
              ? textChunk.content
              : current + textChunk.content;
          }
          return current;
        }

        async function persistAssistantMessage(content: string, model: string) {
          await addThreadMessage(db, {
            threadId,
            role: "assistant",
            content,
            model,
          });

          const artifactKind =
            thread.thread.scope === "annotation"
              ? "inline_note"
              : thread.thread.scope === "page"
                ? "page_summary"
                : "overview_summary";
          const now = new Date();
          await db.insert(learningArtifacts).values({
            id: crypto.randomUUID(),
            ownerUserId: sessionSub,
            documentId: thread.thread.documentId,
            versionId: null,
            annotationId: thread.thread.annotationId,
            kind: artifactKind,
            pageNumber: null,
            prompt: body.message,
            content,
            model,
            createdAt: now,
            updatedAt: now,
          });
        }

        async function* withPersistence(): AsyncIterable<StreamChunk> {
          let fullContent = "";
          let savedAssistantMessage = false;
          let usage: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
            model: string;
          } | null = null;

          try {
            for await (const chunk of aiStream as AsyncIterable<StreamChunk>) {
              if (chunk.type === "TEXT_MESSAGE_CONTENT") {
                fullContent = applyTextChunk(fullContent, chunk);
              }

              if (chunk.type === "RUN_FINISHED") {
                const finished = chunk as StreamChunk & {
                  usage?: {
                    promptTokens?: number;
                    completionTokens?: number;
                    totalTokens?: number;
                    costUsd?: number;
                  };
                  model?: string;
                };
                const model = finished.model ?? AI_MODEL;
                const totalTokens = finished.usage?.totalTokens ?? 0;
                usage = {
                  promptTokens: finished.usage?.promptTokens ?? 0,
                  completionTokens: finished.usage?.completionTokens ?? 0,
                  totalTokens,
                  model,
                };

                const providerCostUsd = Math.max(
                  0,
                  finished.usage?.costUsd ?? totalTokens * 0.0000002,
                );
                const billing = calculateBilledCost({
                  actualModel: model,
                  providerCostUsd,
                  usdToEurRate: await getUsdToEurRate(),
                });
                const costCents = Math.max(1, billing.billedCents);

                if (!isAdmin) {
                  await deductWalletBalance(db, sessionSub, costCents);
                }
                await logUsage(db, {
                  userId: sessionSub,
                  source: `thread:${threadId}`,
                  model,
                  promptTokens: usage.promptTokens,
                  completionTokens: usage.completionTokens,
                  totalTokens: usage.totalTokens,
                  providerCostUsd,
                  costCents,
                });

                if (fullContent.trim()) {
                  await persistAssistantMessage(fullContent, model);
                  savedAssistantMessage = true;
                }

                yield {
                  type: "CUSTOM",
                  name: "openrouter-usage",
                  model,
                  timestamp: Date.now(),
                  value: { ...usage, billedCents: costCents },
                } as StreamChunk;
              }

              yield chunk;
            }
            if (!savedAssistantMessage && fullContent.trim()) {
              await persistAssistantMessage(fullContent, usage?.model ?? AI_MODEL);
            }
          } catch (err) {
            if ((err as Error).message !== "Aborted") throw err;
          }
        }

        return toServerSentEventsResponse(withPersistence(), {
          abortController,
          headers: {
            "Cache-Control": "no-store, no-transform",
            "X-Accel-Buffering": "no",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
