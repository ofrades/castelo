import { createFileRoute } from "@tanstack/react-router";
import { BookMarked } from "lucide-react";
import { Button } from "#/components/ui/button";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { session } = Route.useRouteContext();

  return (
    <main className="min-h-screen bg-background">
      <header className="quiet-edge bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <BookMarked className="size-4" />
            Castelo
          </div>
          <div className="flex items-center gap-2">
            {session ? (
              <Button asChild size="sm">
                <a href="/dashboard">Bibliotheca</a>
              </Button>
            ) : (
              <>
                <Button asChild size="sm" variant="outline">
                  <a href="/api/auth/google/start">Google</a>
                </Button>
                <form action="/api/auth/dev" method="post">
                  <Button size="sm" type="submit">
                    Locus
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="mx-auto grid min-h-[calc(100vh-3.5rem)] max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[1fr_360px] lg:items-center">
        <div>
          <div className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Lectio
          </div>
          <h1 className="max-w-3xl text-5xl font-semibold tracking-[-0.05em] text-foreground sm:text-7xl">
            Legere. Notare. Meminisse.
          </h1>
          <div className="mt-7 flex flex-wrap gap-3">
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

        <div className="quiet-panel px-6 py-8">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            In bibliotheca
          </div>
          <div className="mt-4 space-y-4 text-2xl font-semibold tracking-tight">
            <div>Familia Romana</div>
            <div>Annotationes</div>
            <div>Memoria activa</div>
          </div>
        </div>
      </section>
    </main>
  );
}
