import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MockStorageAdapter } from "@trails-logos/storage";
import { packTrailPackage } from "@trails-logos/core";
import { createSampleTrailPackage } from "../scripts/fixture.js";

describe("Storage Adapter Suite (PRD Section 10)", () => {
  let tempDir: string;
  let storageDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "trails-st-pkg-"));
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "trails-st-db-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(storageDir, { recursive: true, force: true }).catch(() => {});
  });

  it("stores and retrieves packages indexed by CID", async () => {
    await createSampleTrailPackage(tempDir);
    const { zipBuffer, cid, byteLength } = packTrailPackage(tempDir);

    const adapter = new MockStorageAdapter(storageDir);
    const uploadResult = await adapter.uploadPackage(zipBuffer);

    expect(uploadResult.cid).toBe(cid);
    expect(uploadResult.byteLength).toBe(byteLength);

    const has = await adapter.hasPackage(cid);
    expect(has).toBe(true);

    const downloaded = await adapter.downloadPackage(cid);
    expect(downloaded.length).toBe(byteLength);
    expect(downloaded.equals(zipBuffer)).toBe(true);
  });

  it("throws error for non-existent package CID", async () => {
    const adapter = new MockStorageAdapter(storageDir);
    await expect(adapter.downloadPackage("cid_sha256_unknown_deadbeef")).rejects.toThrow(
      "STORAGE_NOT_FOUND"
    );
  });
});
