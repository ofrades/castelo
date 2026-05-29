import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import type { ReaderAnnotation } from "#/lib/document-service";
import type { Document } from "#/lib/schema";
import {
  ensurePageReviewQuestions,
  getReviewState,
  gradeReviewAnswer,
  markReviewAnswerRevealed,
} from "#/server/documents";

type Progress = Awaited<ReturnType<typeof getReviewState>>["progress"];
type ReviewQuestion = Awaited<ReturnType<typeof getReviewState>>["questions"][number];

function annotationPage(annotation: ReaderAnnotation) {
  return annotation.selectorJson.rects?.[0]?.page ?? 1;
}

function cleanText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function pageTextFor(pageTextByPage: Record<number, string>, markdown: string, page: number) {
  return cleanText(pageTextByPage[page] ?? (page === 1 ? markdown : ""));
}

function buildAnnotationContext(annotations: ReaderAnnotation[], page: number) {
  return annotations
    .filter((annotation) => annotation.kind !== "global" && annotation.kind !== "question")
    .filter((annotation) => annotationPage(annotation) === page)
    .map((annotation) => {
      const body = annotation.body.trim();
      const selected = annotation.selectedText?.trim();
      return `${annotation.kind}: ${[body, selected].filter(Boolean).join(" | ")}`;
    })
    .join("\n");
}

function dueForPage(questions: ReviewQuestion[], page: number) {
  return questions
    .filter((question) => question.pageNumber === page && question.status !== "correct")
    .toSorted((a, b) => {
      if (a.status === b.status) return a.createdAt.getTime() - b.createdAt.getTime();
      return a.status === "incorrect" ? -1 : 1;
    });
}

function correctForPage(questions: ReviewQuestion[], page: number) {
  return questions.filter(
    (question) => question.pageNumber === page && question.status === "correct",
  );
}

export function ReviewQuestionnaire({
  document,
  annotations,
  markdown,
  maxPageRead,
  currentPage,
  pageTextByPage,
  onProgressStateChange,
}: {
  document: Document;
  annotations: ReaderAnnotation[];
  markdown: string;
  maxPageRead: number;
  currentPage: number;
  pageTextByPage: Record<number, string>;
  onProgressStateChange: (state: { unlockedPage: number }) => void;
}) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [questions, setQuestions] = useState<ReviewQuestion[]>([]);
  const [activePage, setActivePage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [grading, setGrading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pageText = useMemo(
    () => pageTextFor(pageTextByPage, markdown, activePage),
    [activePage, markdown, pageTextByPage],
  );
  const annotationContext = useMemo(
    () => buildAnnotationContext(annotations, activePage),
    [activePage, annotations],
  );
  const dueQuestions = dueForPage(questions, activePage);
  const currentQuestion =
    dueQuestions[Math.min(questionIndex, Math.max(0, dueQuestions.length - 1))] ?? null;
  const pageQuestions = questions.filter((question) => question.pageNumber === activePage);
  const correctQuestions = correctForPage(questions, activePage);
  const requiredCorrect = Math.min(2, pageQuestions.length || 2);
  const isPageMastered = pageQuestions.length > 0 && correctQuestions.length >= requiredCorrect;

  useEffect(() => {
    setQuestionIndex(0);
  }, [activePage]);

  useEffect(() => {
    if (questionIndex >= dueQuestions.length)
      setQuestionIndex(Math.max(0, dueQuestions.length - 1));
  }, [dueQuestions.length, questionIndex]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const state = await getReviewState({ data: { documentId: document.id } });
        if (cancelled) return;
        setProgress(state.progress);
        setQuestions(state.questions);
        setActivePage(Math.max(1, Math.min(currentPage, state.progress.unlockedPage)));
        onProgressStateChange({ unlockedPage: state.progress.unlockedPage });
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Could not load review progress.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [currentPage, document.id, onProgressStateChange]);

  async function generateForPage() {
    if (!pageText.trim()) {
      setError("Open this page in the reader first so the text can load.");
      return;
    }
    setGenerating(true);
    setError(null);
    setFeedback(null);
    try {
      const generated = await ensurePageReviewQuestions({
        data: {
          documentId: document.id,
          pageNumber: activePage,
          pageText,
          annotationContext,
        },
      });
      setQuestions((current) => [
        ...current.filter((question) => question.pageNumber !== activePage),
        ...generated,
      ]);
    } catch (err) {
      setError((err as Error).message || "Could not generate questions.");
    } finally {
      setGenerating(false);
    }
  }

  async function submitAnswer() {
    if (!currentQuestion || !answer.trim()) return;
    setGrading(true);
    setError(null);
    try {
      const result = await gradeReviewAnswer({
        data: { documentId: document.id, questionId: currentQuestion.id, answer },
      });
      setFeedback(result.grade.feedback);
      setProgress(result.progress);
      setQuestions((current) =>
        current.map((question) =>
          question.id === result.question.id ? result.question : question,
        ),
      );
      onProgressStateChange({ unlockedPage: result.progress.unlockedPage });
      setAnswer("");
      setQuestionIndex((index) => Math.min(index, Math.max(0, dueQuestions.length - 2)));
    } catch (err) {
      setError((err as Error).message || "Could not grade answer.");
    } finally {
      setGrading(false);
    }
  }

  async function revealExpectedAnswer() {
    if (!currentQuestion) return;
    setGrading(true);
    setError(null);
    try {
      const result = await markReviewAnswerRevealed({
        data: { documentId: document.id, questionId: currentQuestion.id },
      });
      setFeedback(result.feedback);
      setQuestions((current) =>
        current.map((question) =>
          question.id === result.question.id ? result.question : question,
        ),
      );
    } catch (err) {
      setError((err as Error).message || "Could not reveal answer.");
    } finally {
      setGrading(false);
    }
  }

  function moveQuestion(direction: -1 | 1) {
    setFeedback(null);
    setAnswer("");
    setQuestionIndex((index) =>
      Math.min(Math.max(0, index + direction), Math.max(0, dueQuestions.length - 1)),
    );
  }

  function movePage(direction: -1 | 1) {
    const upperBound = progress?.unlockedPage ?? Math.max(maxPageRead, 1);
    setFeedback(null);
    setAnswer("");
    setQuestionIndex(0);
    setActivePage((page) => Math.min(upperBound, Math.max(1, page + direction)));
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Paratur
      </div>
    );
  }

  const pageMarks = Array.from(
    { length: Math.min(progress?.unlockedPage ?? 1, 8) },
    (_, index) => index + 1,
  );

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col px-8 py-10">
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <button
          type="button"
          onClick={() => movePage(-1)}
          disabled={activePage <= 1}
          className="transition-colors hover:text-primary disabled:opacity-25"
        >
          Pagina prior
        </button>
        <div className="flex items-center gap-5">
          {pageMarks.map((page) => (
            <button
              key={page}
              type="button"
              onClick={() => {
                setActivePage(page);
                setQuestionIndex(0);
                setFeedback(null);
              }}
              className={`size-2 rounded-full transition-colors ${page === activePage ? "bg-primary" : "bg-border hover:bg-muted-foreground/40"}`}
              aria-label={`Page ${page}`}
            />
          ))}
          <span>{progress?.unlockedPage ?? 1}</span>
        </div>
        <button
          type="button"
          onClick={() => movePage(1)}
          disabled={activePage >= (progress?.unlockedPage ?? maxPageRead)}
          className="transition-colors hover:text-primary disabled:opacity-25"
        >
          Pagina altera
        </button>
      </div>

      {error ? <p className="mt-10 text-center text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-1 items-center justify-center py-16">
        {!pageQuestions.length ? (
          <section className="max-w-xl text-center">
            <p className="text-3xl font-semibold tracking-tight">Pagina {activePage}</p>
            <Button
              className="mt-10"
              variant="ghost"
              onClick={generateForPage}
              disabled={generating}
            >
              {generating ? <Loader2 className="size-4 animate-spin" /> : null}
              Quaestiones creare
            </Button>
          </section>
        ) : isPageMastered && !currentQuestion ? (
          <section className="max-w-xl text-center">
            <p className="text-3xl font-semibold tracking-tight">Perfectum</p>
            <Button className="mt-10" variant="ghost" onClick={() => movePage(1)}>
              Pergere
            </Button>
          </section>
        ) : currentQuestion ? (
          <section className="w-full max-w-xl">
            <div className="mb-24 text-center text-[11px] font-medium text-muted-foreground">
              {correctQuestions.length}/{requiredCorrect} · {questionIndex + 1}/
              {dueQuestions.length}
            </div>
            <h2 className="text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.04em]">
              {currentQuestion.question}
            </h2>
            {currentQuestion.sourceHint ? (
              <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
                {currentQuestion.sourceHint}
              </p>
            ) : null}
            <Textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="Responsum"
              className="mt-12 min-h-24 resize-none border-x-0 border-t-0 bg-transparent px-0 text-lg shadow-none focus-visible:ring-0"
            />
            {feedback ? (
              <p className="mt-8 text-sm leading-7 text-muted-foreground">{feedback}</p>
            ) : null}
          </section>
        ) : (
          <section className="max-w-xl text-center">
            <p className="text-3xl font-semibold tracking-tight">Nihil restat</p>
            <Button
              className="mt-10"
              variant="ghost"
              onClick={generateForPage}
              disabled={generating}
            >
              Repetere
            </Button>
          </section>
        )}
      </div>

      {currentQuestion ? (
        <div className="flex items-center justify-between pb-2 text-sm font-semibold text-primary">
          <button type="button" onClick={revealExpectedAnswer} disabled={grading}>
            Monstra responsum
          </button>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => moveQuestion(-1)}
              disabled={questionIndex <= 0}
              className="text-muted-foreground disabled:opacity-25"
            >
              Prior
            </button>
            <button
              type="button"
              onClick={() => moveQuestion(1)}
              disabled={questionIndex >= dueQuestions.length - 1}
              className="text-muted-foreground disabled:opacity-25"
            >
              Altera
            </button>
          </div>
          <button type="button" onClick={submitAnswer} disabled={!answer.trim() || grading}>
            {grading ? "Probatur" : "Probare"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
