import { defineConfig } from "mygo-cli";

export default defineConfig({
  name: "ReClaim Cleaner",
  identifier: "dev.reclaim.cleaner",
  version: "0.5.0",
  // The frontend is the existing Vite app; main.go embeds its build, so a
  // plain `go build` works too.
  buildCommand: "bun run --cwd frontend build",
  frontendDist: "frontend/dist",
  out: "build",
});
