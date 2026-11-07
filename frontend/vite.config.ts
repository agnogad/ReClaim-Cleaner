import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The frontend is served by MyGo from the built files, so assets are
// referenced relatively and the build target stays modern.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  clearScreen: false,
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    minify: "oxc",
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
