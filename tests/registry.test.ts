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

  it("claims unique username handles and prevents duplicate collisions across accounts", async () => {
    const adapter = new MockRegistryAdapter(stateFile);
    await adapter.init();

    // 1. Check availability
    const check1 = await adapter.checkUsername("wandering-cedar-42");
    expect(check1.available).toBe(true);
    expect(check1.username).toBe("wandering-cedar-42");

    // Invalid username checks
    const tooShort = await adapter.checkUsername("ab");
    expect(tooShort.available).toBe(false);

    // 2. Claim username for account A
    const accountA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const creatorA = await adapter.claimCreator({
      username: "wandering-cedar-42",
      displayName: "Cedar Walker",
      accountAddress: accountA,
      bio: "Spatial archivist exploring alpine meadows.",
    });

    expect(creatorA.username).toBe("wandering-cedar-42");
    expect(creatorA.publisherReference).toBe(accountA);
    expect(creatorA.ensDomain).toBe("wandering-cedar-42.trails.eth");

    // 3. Check availability again - now taken
    const checkTaken = await adapter.checkUsername("wandering-cedar-42");
    expect(checkTaken.available).toBe(false);
    expect(checkTaken.claimedBy).toBe(accountA);

    // 4. Duplicate claim by Account B must fail
    const accountB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    await expect(
      adapter.claimCreator({
        username: "wandering-cedar-42",
        displayName: "Impostor",
        accountAddress: accountB,
      })
    ).rejects.toThrow(/already claimed/);

    // 5. Idempotent update by Account A succeeds
    const updatedA = await adapter.claimCreator({
      username: "wandering-cedar-42",
      displayName: "Cedar Walker Updated",
      accountAddress: accountA,
    });
    expect(updatedA.displayName).toBe("Cedar Walker Updated");

    // 6. Publication with Account B using claimed username fails
    const manifest = await createSampleTrailPackage(tempDir);
    manifest.creatorUsername = "wandering-cedar-42";
    await expect(
      adapter.registerTrail({
        manifest,
        packageCid: "cid_sha256_b_collision",
        packageSizeBytes: 2048,
        publisherAccount: accountB,
        operationId: "op-collision-01",
      })
    ).rejects.toThrow(/already claimed/);
  });
});
