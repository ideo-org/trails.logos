import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { validateTrailPackage, packTrailPackage, unpackTrailPackage } from "@trails-logos/core";
import { createSampleTrailPackage } from "../scripts/fixture.js";

describe("Validator & Packaging Suite (PRD Section 6, 7, 8)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "trails-test-val-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("successfully validates a compliant trail package directory", async () => {
    await createSampleTrailPackage(tempDir);
    const result = validateTrailPackage(tempDir);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.manifest.trailId).toBe("e57b98d3-7d52-441f-8cb4-20bce01e35d1");
    expect(result.manifest.revision).toBe(1);
    expect(result.totalAssets).toBe(3);
    expect(result.totalBytes).toBeGreaterThan(0);
  });

  it("rejects packages missing manifest.json", async () => {
    const result = validateTrailPackage(tempDir);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MANIFEST_MISSING")).toBe(true);
  });

  it("rejects path traversal attempts in asset relative paths", async () => {
    await createSampleTrailPackage(tempDir);
    const manifestPath = path.join(tempDir, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));

    manifest.assets[0].relativePath = "../../../etc/passwd";
    await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf-8");

    const result = validateTrailPackage(tempDir);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "SCHEMA_VIOLATION")).toBe(true);
  });

  it("detects asset byte length mismatch", async () => {
    await createSampleTrailPackage(tempDir);
    const manifestPath = path.join(tempDir, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));

    manifest.assets[0].byteLength = 999999;
    await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf-8");

    const result = validateTrailPackage(tempDir);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "BYTE_LENGTH_MISMATCH")).toBe(true);
  });

  it("detects asset SHA-256 digest corruption or tampering", async () => {
    await createSampleTrailPackage(tempDir);
    const manifestPath = path.join(tempDir, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));

    manifest.assets[0].sha256 = "0000000000000000000000000000000000000000000000000000000000000000";
    await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf-8");

    const result = validateTrailPackage(tempDir);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "HASH_MISMATCH")).toBe(true);
  });

  it("packs into deterministic ZIP and unpacks faithfully", async () => {
    await createSampleTrailPackage(tempDir);
    const packRes = packTrailPackage(tempDir);

    expect(packRes.zipBuffer.length).toBeGreaterThan(0);
    expect(packRes.cid).toMatch(/^cid_sha256_[0-9a-f]{64}$/);
    expect(packRes.validation.valid).toBe(true);

    const unpackDir = await fs.mkdtemp(path.join(os.tmpdir(), "trails-test-unpack-"));
    try {
      await unpackTrailPackage(packRes.zipBuffer, unpackDir);
      const unpackVal = validateTrailPackage(unpackDir);
      expect(unpackVal.valid).toBe(true);
      expect(unpackVal.manifest.trailId).toBe(packRes.validation.manifest.trailId);
    } finally {
      await fs.rm(unpackDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
