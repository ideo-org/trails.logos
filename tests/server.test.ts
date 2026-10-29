import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createTrailsServer, TrailsServer } from "@trails-logos/server";
import { MockStorageAdapter } from "@trails-logos/storage";
import { MockRegistryAdapter } from "@trails-logos/registry";
import { packTrailPackage } from "@trails-logos/core";
import { createSampleTrailPackage } from "../scripts/fixture.js";

describe("Server REST API Suite (PRD Section 13)", () => {
  let tempDir: string;
  let server: TrailsServer;
  let baseUrl: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "trails-srv-test-"));
    const storage = new MockStorageAdapter(path.join(tempDir, "storage"));
    const registry = new MockRegistryAdapter(path.join(tempDir, "registry.json"));

    server = createTrailsServer({ port: 0, host: "127.0.0.1", storage, registry });
    const { port, host } = await server.start();
    baseUrl = `http://${host}:${port}`;
  });

  afterEach(async () => {
    await server.stop();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("responds to /health check", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
  });

  it("publishes, queries, and downloads a trail package via REST", async () => {
    const pkgDir = path.join(tempDir, "sample-pkg");
    await createSampleTrailPackage(pkgDir);
    const { zipBuffer, cid } = packTrailPackage(pkgDir);

    // 1. POST /publications
    const opId = "test-op-42";
    const pubRes = await fetch(`${baseUrl}/publications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        "X-Publisher-Account": "0x4444444444444444444444444444444444444444",
        "X-Operation-Id": opId,
      },
      body: zipBuffer,
    });

    expect(pubRes.status).toBe(201);
    const receipt = await pubRes.json();
    expect(receipt.packageCid).toBe(cid);
    expect(receipt.revision).toBe(1);

    // 2. GET /publications/:operationId (idempotent lookup)
    const opRes = await fetch(`${baseUrl}/publications/${opId}`);
    expect(opRes.status).toBe(200);
    const opReceipt = await opRes.json();
    expect(opReceipt.packageCid).toBe(cid);

    // 3. GET /trails
    const listRes = await fetch(`${baseUrl}/trails`);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.items.length).toBe(1);
    expect(listBody.items[0].packageCid).toBe(cid);

    // 4. GET /trails/:id
    const trailId = receipt.trailId;
    const trailRes = await fetch(`${baseUrl}/trails/${trailId}`);
    expect(trailRes.status).toBe(200);
    const trailBody = await trailRes.json();
    expect(trailBody.trailId).toBe(trailId);
    expect(trailBody.title).toBe("Mission Peak Ridge Sunrise Trail");

    // 5. GET /trails/:id/download
    const dlRes = await fetch(`${baseUrl}/trails/${trailId}/download`);
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers.get("content-type")).toBe("application/zip");
    const downloadedBuf = Buffer.from(await dlRes.arrayBuffer());
    expect(downloadedBuf.equals(zipBuffer)).toBe(true);
  });
});
