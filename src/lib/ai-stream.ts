function applyTextChunk(
  current: string,
  chunk: { text?: string; delta?: string; content?: string },
) {
  if (chunk.delta) return current + chunk.delta;
  if (chunk.text) return current + chunk.text;
  if (chunk.content) {
    return chunk.content.startsWith(current) ? chunk.content : current + chunk.content;
  }
  return current;
}

export async function streamChatResponse(
  threadId: string,
  message: string,
  context: {
    documentTitle: string;
    selectedText?: string;
    surroundingChunks?: string[];
  },
  onChunk: (text: string) => void,
): Promise<string> {
  const response = await fetch(`/api/threads/${threadId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, context }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "Request failed");
    throw new Error(text);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const json = trimmed.slice(5).trim();
      if (!json || json === "[DONE]") continue;

      try {
        const chunk = JSON.parse(json);
        if (chunk.type === "TEXT_MESSAGE_CONTENT") {
          const nextContent = applyTextChunk(fullContent, chunk);
          if (nextContent !== fullContent) {
            fullContent = nextContent;
            onChunk(fullContent);
          }
        }
      } catch {
        // ignore malformed SSE lines
      }
    }
  }

  return fullContent;
}
