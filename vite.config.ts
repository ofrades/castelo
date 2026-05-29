import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const isTest = process.env.VITEST === "true";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  fmt: {
    ignorePatterns: ["src/routeTree.gen.ts", "public/pdfjs/**"],
  },
  plugins: [
    ...(!isTest ? [nitro()] : []),
    tailwindcss(),
    ...(!isTest ? [tanstackStart()] : []),
    viteReact(),
  ],
} as any);

export default config;
