import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MockRegistryAdapter } from "@trails-logos/registry";
import { createSampleTrailPackage } from "../scripts/fixture.js";

describe("Registry Adapter Suite (PRD Section 11)", () => {
  let tempDir: string;
  let stateFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "trails-reg-pkg-"));
    stateFile = path.join(tempDir, "state.json");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("registers new trail and retrieves publication & revision records", async () => {
    const manifest = await createSampleTrailPackage(tempDir);
    const adapter = new MockRegistryAdapter(stateFile);
    await adapter.init();

    const publisher = "0x1111111111111111111111111111111111111111";
    const { publication, receipt } = await adapter.registerTrail({
      manifest,
      packageCid: "cid_sha256_dummy_cid_01",
      packageSizeBytes: 54321,
      publisherAccount: publisher,
      operationId: "op-reg-01",
    });

    expect(publication.trailId).toBe(manifest.trailId);
    expect(publication.currentRevision).toBe(1);
    expect(publication.publisherAccount).toBe(publisher);
    expect(publication.listed).toBe(true);

    expect(receipt.trailId).toBe(manifest.trailId);
    expect(receipt.revision).toBe(1);
    expect(receipt.transactionReference).toBeDefined();

    const fetched = await adapter.getTrail(manifest.trailId);
    expect(fetched).not.toBeNull();
    expect(fetched?.trailId).toBe(manifest.trailId);

    const rev1 = await adapter.getRevision(manifest.trailId, 1);
    expect(rev1?.revision).toBe(1);
    expect(rev1?.packageCid).toBe("cid_sha256_dummy_cid_01");
  });

  it("increments revisions and prevents unauthorized updates", async () => {
    const manifest = await createSampleTrailPackage(tempDir);
    const adapter = new MockRegistryAdapter(stateFile);
    await adapter.init();

    const publisher = "0x1111111111111111111111111111111111111111";
    await adapter.registerTrail({
      manifest,
      packageCid: "cid_sha256_v1",
      packageSizeBytes: 1000,
      publisherAccount: publisher,
      operationId: "op-v1",
    });

    // Unauthorized publisher attempts revision
    await expect(
      adapter.publishRevision({
        trailId: manifest.trailId,
        manifest: { ...manifest, revision: 2, title: "Hacked Trail" },
        packageCid: "cid_sha256_v2_hacked",
        packageSizeBytes: 1050,
        publisherAccount: "0xBAD_ACTOR_9999999999999999999999999999999",
        operationId: "op-bad-v2",
      })
    ).rejects.toThrow("Unauthorized");

    // Authorized publisher publishes revision 2
    const { publication: rev2Pub, receipt: rev2Receipt } = await adapter.publishRevision({
      trailId: manifest.trailId,
      manifest: { ...manifest, revision: 2, title: "Mission Peak Ridge Sunrise Trail - Extended" },
      packageCid: "cid_sha256_v2",
      packageSizeBytes: 1200,
      publisherAccount: publisher,
      operationId: "op-v2",
    });

    expect(rev2Pub.currentRevision).toBe(2);
    expect(rev2Pub.title).toBe("Mission Peak Ridge Sunrise Trail - Extended");
    expect(rev2Receipt.revision).toBe(2);

    const revisions = await adapter.listRevisions(manifest.trailId);
    expect(revisions).toHaveLength(2);
    expect(revisions[0].revision).toBe(1);
    expect(revisions[1].revision).toBe(2);
  });

  it("handles unlisting and relisting", async () => {
    const manifest = await createSampleTrailPackage(tempDir);
    const adapter = new MockRegistryAdapter(stateFile);
    await adapter.init();

    const publisher = "0x1111111111111111111111111111111111111111";
    await adapter.registerTrail({
      manifest,
      packageCid: "cid_sha256_v1",
      packageSizeBytes: 1000,
      publisherAccount: publisher,
      operationId: "op-v1",
    });

    const unlisted = await adapter.setListed(manifest.trailId, false, publisher);
    expect(unlisted.listed).toBe(false);

    // Default list should exclude unlisted
    const defaultList = await adapter.listTrails({ includeUnlisted: false });
    expect(defaultList.items.some((i) => i.trailId === manifest.trailId)).toBe(false);

    // With includeUnlisted: true, it should appear
    const allList = await adapter.listTrails({ includeUnlisted: true });
    expect(allList.items.some((i) => i.trailId === manifest.trailId)).toBe(true);

    // Relist
    const relisted = await adapter.setListed(manifest.trailId, true, publisher);
    expect(relisted.listed).toBe(true);
  });
});
