export function readableDocumentTitle(title: string) {
  const cleaned = title
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\b[0-9a-f]{16,}\b/gi, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(?:97[89]\d{10}|\d{10,})\b\s*$/g, "")
    .replace(/\s+([,.)])/g, "$1")
    .replace(/[\s,;:-]+$/g, "")
    .trim();

  return cleaned || "Untitled document";
}
