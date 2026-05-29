import { describe, expect, it } from "vitest";
import { guessDocumentKind, titleFromFileName } from "./storage";

describe("document storage helpers", () => {
  it("classifies first-reader document types", () => {
    expect(guessDocumentKind("paper.pdf", "application/pdf")).toBe("pdf");
    expect(guessDocumentKind("notes.md", "text/markdown")).toBe("markdown");
    expect(guessDocumentKind("plain.txt", "text/plain")).toBe("text");
  });

  it("derives a readable title from file names", () => {
    expect(titleFromFileName("statistical_interpretation-notes.pdf")).toBe(
      "statistical interpretation notes",
    );
    expect(titleFromFileName("aesop-9780486280202-720f0091a79f499b31c008aa6f8ad.pdf")).toBe(
      "aesop",
    );
  });
});
