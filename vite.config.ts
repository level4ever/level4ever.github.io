import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Relative, so the site works from any GitHub Pages path.
  base: "./",
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
  },
});
