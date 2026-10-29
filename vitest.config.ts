import { defineConfig } from "vitest/config";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@trails-logos/core": path.resolve(__dirname, "core/src/index.ts"),
      "@trails-logos/storage": path.resolve(__dirname, "storage/src/index.ts"),
      "@trails-logos/registry": path.resolve(__dirname, "registry/src/index.ts"),
      "@trails-logos/server": path.resolve(__dirname, "server/src/index.ts"),
      "@trails-logos/cli": path.resolve(__dirname, "cli/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
