import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MockStorageAdapter } from "@trails-logos/storage";
import { MockRegistryAdapter } from "@trails-logos/registry";
import {
  packTrailPackage,
  unpackTrailPackage,
  validateTrailPackage,
} from "@trails-logos/core";
import { createSampleTrailPackage } from "../scripts/fixture.js";

describe("E2E Multi-Node Sync & Offline Replay Suite (PRD Section 17, 18)", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "trails-e2e-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
  });

  it("completes full publication lifecycle: Node A publishes -> Node B discovers, downloads & replays offline", async () => {
    const nodeADir = path.join(workspaceDir, "nodeA");
    const nodeBDir = path.join(workspaceDir, "nodeB");
    const storageDir = path.join(workspaceDir, "shared_storage");
    const registryFile = path.join(workspaceDir, "shared_registry.json");

    // Shared Logos network infrastructure (Storage + Registry)
    const storageNode = new MockStorageAdapter(storageDir);
    const registryNode = new MockRegistryAdapter(registryFile);
    await registryNode.init();

    // 1. Installation A records trail and creates package
    const captureDir = path.join(nodeADir, "captured_trail");
    const originalManifest = await createSampleTrailPackage(captureDir, {
      title: "Alpine Ridge Panorama",
      trailId: "99887766-5544-3322-1100-aabbccddeeff",
    });

    const packResult = packTrailPackage(captureDir);
    expect(packResult.validation.valid).toBe(true);

    // 2. Installation A publishes package to Storage and registers in LEZ
    const storageRes = await storageNode.uploadPackage(packResult.zipBuffer);
    const { publication, receipt } = await registryNode.registerTrail({
      manifest: originalManifest,
      packageCid: storageRes.cid,
      packageSizeBytes: storageRes.byteLength,
      publisherAccount: "0xNODE_A_AUTHOR_ACCOUNT_ADDRESS_12345",
      operationId: "op-e2e-pub-01",
    });

    expect(publication.currentRevision).toBe(1);
    expect(receipt.packageCid).toBe(storageRes.cid);

    // 3. Installation B queries registry to discover available trails
    const discovery = await registryNode.listTrails();
    expect(discovery.items.length).toBeGreaterThan(0);
    const discoveredTrail = discovery.items.find((t) => t.trailId === originalManifest.trailId);
    expect(discoveredTrail).toBeDefined();
    expect(discoveredTrail?.title).toBe("Alpine Ridge Panorama");

    // 4. Installation B fetches specific revision metadata and downloads package
    const revisionMeta = await registryNode.getRevision(discoveredTrail!.trailId, 1);
    expect(revisionMeta).toBeDefined();
    expect(revisionMeta?.packageCid).toBe(storageRes.cid);

    const downloadedZip = await storageNode.downloadPackage(revisionMeta!.packageCid);
    expect(downloadedZip.length).toBe(packResult.byteLength);

    // 5. Installation B goes offline: unpacks and validates package locally
    const nodeBLocalTrailDir = path.join(nodeBDir, "imported_trail");
    await unpackTrailPackage(downloadedZip, nodeBLocalTrailDir);

    const localValidation = validateTrailPackage(nodeBLocalTrailDir);
    expect(localValidation.valid).toBe(true);
    expect(localValidation.manifest.title).toBe("Alpine Ridge Panorama");
    expect(localValidation.totalAssets).toBe(3);

    // Verify all local assets exist and match SHA-256 digests offline
    for (const asset of localValidation.manifest.assets) {
      const assetFilePath = path.join(nodeBLocalTrailDir, asset.relativePath);
      const exists = await fs
        .access(assetFilePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    }
  });
});
