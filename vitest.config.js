import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    coverage: { provider: "v8", include: ["app/scripts/engine.js"], reporter: ["text"] }
  }
});
