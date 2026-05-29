import { createFileRoute } from "@tanstack/react-router";
import { AppHeader, PageFrame } from "#/components/ui/app-shell";
import { Button } from "#/components/ui/button";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { session } = Route.useRouteContext();

  return (
    <PageFrame>
      <AppHeader>
        {session ? (
          <Button asChild size="sm">
            <a href="/dashboard">Bibliotheca</a>
          </Button>
        ) : (
          <>
            <Button asChild size="sm" variant="ghost">
              <a href="/api/auth/google/start">Google</a>
            </Button>
            <form action="/api/auth/dev" method="post">
              <Button size="sm" type="submit">
                Locus
              </Button>
            </form>
          </>
        )}
      </AppHeader>

      <section className="mx-auto grid min-h-[calc(100vh-3.5rem)] max-w-6xl gap-12 px-5 py-14 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center lg:py-20">
        <div>
          <div className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Lectio privata
          </div>
          <h1 className="max-w-3xl font-serif text-5xl font-medium leading-[0.98] tracking-[-0.045em] text-foreground sm:text-7xl">
            Legere. Notare. Meminisse.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground">
            A quiet reader for documents, notes, summaries, and review questions.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <a href={session ? "/dashboard" : "/api/auth/google/start"}>Incipere</a>
            </Button>
            {!session ? (
              <form action="/api/auth/dev" method="post">
                <Button size="lg" variant="outline" type="submit">
                  Locus
                </Button>
              </form>
            ) : null}
          </div>
        </div>

        <div className="quiet-panel p-5 sm:p-6">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            In bibliotheca
          </div>
          <div className="mt-5 divide-y divide-[var(--border-soft)] text-lg font-medium tracking-tight">
            <div className="py-3 first:pt-0">Familia Romana</div>
            <div className="py-3">Annotationes</div>
            <div className="py-3 last:pb-0">Memoria activa</div>
          </div>
        </div>
      </section>
    </PageFrame>
  );
}
