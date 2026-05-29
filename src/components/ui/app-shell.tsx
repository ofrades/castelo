import type { ReactNode } from "react";
import { BookMarked } from "lucide-react";
import { cn } from "#/lib/utils";

function AppHeader({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <header className={cn("app-header", className)}>
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-6">
        <a href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <BookMarked className="size-4" />
          Castelo
        </a>
        {children ? <div className="flex items-center gap-2">{children}</div> : null}
      </div>
    </header>
  );
}

function PageFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cn("min-h-screen bg-background", className)}>{children}</main>;
}

export { AppHeader, PageFrame };
