#!/usr/bin/env node
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { createTrailsServer } from "../server.js";
import { MockStorageAdapter, LogosStorageAdapter } from "@trails-logos/storage";
import { MockRegistryAdapter, LezRegistryAdapter } from "@trails-logos/registry";
import { seedCatalogueIfEmpty } from "../seed.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8095;
  let host = process.env.HOST || "0.0.0.0";
  let storageMode = process.env.STORAGE_MODE || "mock";
  let registryMode = process.env.REGISTRY_MODE || "mock";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    if (arg === "--port" && nextArg) {
      port = parseInt(nextArg, 10);
      i++;
    } else if (arg === "--host" && nextArg) {
      host = nextArg;
      i++;
    } else if (arg === "--storage" && nextArg) {
      storageMode = nextArg;
      i++;
    } else if (arg === "--registry" && nextArg) {
      registryMode = nextArg;
      i++;
    }
  }

  const storage =
    storageMode === "logos"
      ? new LogosStorageAdapter()
      : new MockStorageAdapter(".local/storage");

  const registry =
    registryMode === "lez"
      ? new LezRegistryAdapter("http://127.0.0.1:8545", ".local/registry.json")
      : new MockRegistryAdapter(".local/registry.json");

  await registry.init();

  // Automatic seeding of sample discovery catalogue disabled by default
  if (process.env.SEED_SAMPLE_TRAILS === "true") {
    const seedDir = await fs.mkdtemp(path.join(os.tmpdir(), "trails-seed-"));
    try {
      await seedCatalogueIfEmpty(registry, storage, seedDir);
    } finally {
      await fs.rm(seedDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const server = createTrailsServer({ port, host, storage, registry });
  const running = await server.start();

  console.log(`[trails.logos] REST API Server running at http://${running.host}:${running.port}`);
  console.log(`[trails.logos] Storage Adapter: ${storageMode}, Registry Adapter: ${registryMode}`);
}

main().catch((err) => {
  console.error("[trails.logos] Fatal server error:", err);
  process.exit(1);
});
