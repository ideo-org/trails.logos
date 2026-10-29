import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as crypto from "node:crypto";
import {
  validateTrailPackage,
  packTrailPackage,
  unpackTrailPackage,
} from "@trails-logos/core";
import { MockStorageAdapter } from "@trails-logos/storage";
import { MockRegistryAdapter } from "@trails-logos/registry";
import { createSampleTrailPackage } from "./fixture.js";

async function runDemo(): Promise<void> {
  console.log("===============================================================================");
  console.log("          TRAILS.LOGOS v0.1.0 — COMPLETE SYSTEM DEMONSTRATION                  ");
  console.log("  Decentralized Spatial Audio & AR Trail Registry & Distributed Storage Layer  ");
  console.log("===============================================================================\n");

  const runId = crypto.randomUUID().slice(0, 8);
  const demoRoot = await fs.mkdtemp(path.join(os.tmpdir(), `trails-demo-${runId}-`));
  const storageDir = path.join(demoRoot, "storage");
  const registryFile = path.join(demoRoot, "registry.json");
  const nodeADir = path.join(demoRoot, "deviceA_capture");
  const nodeBDir = path.join(demoRoot, "deviceB_playback");

  try {
    // Phase 1: Infrastructure Setup
    console.log("[Phase 1] Initializing Logos Storage and LEZ Registry Adapters...");
    const storage = new MockStorageAdapter(storageDir);
    const registry = new MockRegistryAdapter(registryFile);
    await registry.init();
    console.log("  -> Storage adapter ready: MockStorageAdapter (Local Content-Addressed Store)");
    console.log("  -> Registry adapter ready: MockRegistryAdapter (LEZ Program Simulation)\n");

    // Phase 2: Native App Recording & Package Construction
    console.log("[Phase 2] Generating compliant Trail Package on Installation A (iOS Device)...");
    const manifest = await createSampleTrailPackage(nodeADir, {
      title: "Coyote Hills Ridge & Salt Marsh Trail",
      trailId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    console.log(`  -> Trail ID:        ${manifest.trailId}`);
    console.log(`  -> Title:           "${manifest.title}"`);
    console.log(`  -> Revision:        ${manifest.revision}`);
    console.log(`  -> Assets:          ${manifest.assets.length} items (Photo, Voice note, Video panorama)`);
    console.log(`  -> Coordinate Frame: ${manifest.coordinateFrames[0].id}\n`);

    // Phase 3: Integrity Validation
    console.log("[Phase 3] Running Strict Pre-Publish Validation (PRD Section 6 & 8)...");
    const validation = validateTrailPackage(nodeADir);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.issues.map((i) => i.message).join(", ")}`);
    }
    console.log(`  -> Validation:      PASSED (0 issues)`);
    console.log(`  -> Total Bytes:     ${validation.totalBytes} bytes across ${validation.totalAssets} assets\n`);

    // Phase 4: Deterministic Packaging & CID Generation
    console.log("[Phase 4] Packing Trail Archive and Computing Package CID...");
    const packResult = packTrailPackage(nodeADir);
    console.log(`  -> Archive Size:    ${packResult.byteLength} bytes`);
    console.log(`  -> Archive SHA-256: ${packResult.sha256}`);
    console.log(`  -> Content CID:     ${packResult.cid}\n`);

    // Phase 5: Storage Upload & LEZ Registry Publishing
    console.log("[Phase 5] Publishing Trail to Distributed Network...");
    const authorAddress = "0xALICE_COMMUNITY_PUBLISHER_7788";
    const uploadRes = await storage.uploadPackage(packResult.zipBuffer);
    console.log(`  -> Storage Upload:  Uploaded package to Logos Storage (CID: ${uploadRes.cid})`);

    const { publication, receipt } = await registry.registerTrail({
      manifest,
      packageCid: uploadRes.cid,
      packageSizeBytes: uploadRes.byteLength,
      publisherAccount: authorAddress,
      operationId: `op-demo-${runId}-1`,
    });
    console.log("  -> LEZ Publication Receipt:");
    console.log(`     - Trail ID:         ${receipt.trailId}`);
    console.log(`     - Revision:         ${receipt.revision}`);
    console.log(`     - Program ID:       ${receipt.registryProgramIdentifier}`);
    console.log(`     - Network ID:       ${receipt.networkIdentifier}`);
    console.log(`     - Tx Reference:     ${receipt.transactionReference}`);
    console.log(`     - Verified At:      ${receipt.verifiedAt}\n`);

    // Phase 6: Discovery & Download from Installation B
    console.log("[Phase 6] Simulating Installation B (Discovering & Syncing from Network)...");
    const catalog = await registry.listTrails();
    console.log(`  -> Registry Query:  Found ${catalog.items.length} listed trail(s)`);
    const target = catalog.items.find((t) => t.trailId === manifest.trailId);
    if (!target) throw new Error("Trail not found in registry!");
    console.log(`  -> Selected Trail:  "${target.title}" (Rev ${target.currentRevision})`);

    console.log(`  -> Fetching Archive by CID: ${target.packageCid} from storage...`);
    const downloadedBuffer = await storage.downloadPackage(target.packageCid);
    console.log(`  -> Downloaded:      ${downloadedBuffer.length} bytes (Matches origin: ${downloadedBuffer.equals(packResult.zipBuffer)})\n`);

    // Phase 7: Installation B Local Unpacking & Offline Replay Verification
    console.log("[Phase 7] Installation B Goes Offline: Unpacking & Self-Verification...");
    await unpackTrailPackage(downloadedBuffer, nodeBDir);
    const nodeBValidation = validateTrailPackage(nodeBDir);
    if (!nodeBValidation.valid) {
      throw new Error("Installation B offline package integrity check failed!");
    }
    console.log(`  -> Offline Verify:  PASSED! All ${nodeBValidation.totalAssets} assets & SHA-256 hashes intact.`);
    console.log(`  -> Ready for Offline Spatial Audio & AR Playback.\n`);

    // Phase 8: Revision 2 Update Cycle
    console.log("[Phase 8] Author Publishes Revision 2 (Trail Extension & Re-recording)...");
    const rev2Manifest = {
      ...manifest,
      revision: 2,
      title: "Coyote Hills Ridge & Salt Marsh Trail - Extended Loop",
    };
    await fs.writeFile(
      path.join(nodeADir, "manifest.json"),
      JSON.stringify(rev2Manifest, null, 2),
      "utf-8"
    );
    const packRev2 = packTrailPackage(nodeADir);
    const uploadRev2 = await storage.uploadPackage(packRev2.zipBuffer);

    const { publication: pubRev2, receipt: receiptRev2 } = await registry.publishRevision({
      trailId: manifest.trailId,
      manifest: rev2Manifest,
      packageCid: uploadRev2.cid,
      packageSizeBytes: uploadRev2.byteLength,
      publisherAccount: authorAddress,
      operationId: `op-demo-${runId}-2`,
    });
    console.log(`  -> Revision Updated: Current Revision is now ${pubRev2.currentRevision}`);
    console.log(`  -> New Package CID:  ${receiptRev2.packageCid}`);
    console.log(`  -> Updated Title:    "${pubRev2.title}"\n`);

    // Phase 9: Listing & Availability Toggle
    console.log("[Phase 9] Testing Listing & Moderation Controls...");
    const unlisted = await registry.setListed(manifest.trailId, false, authorAddress);
    console.log(`  -> Trail unlisted: listed=${unlisted.listed}`);
    const filteredCatalog = await registry.listTrails({ includeUnlisted: false });
    console.log(`  -> Public catalog count: ${filteredCatalog.items.length} (Unlisted trail hidden)`);

    const relisted = await registry.setListed(manifest.trailId, true, authorAddress);
    console.log(`  -> Trail relisted: listed=${relisted.listed}`);
    const restoredCatalog = await registry.listTrails({ includeUnlisted: false });
    console.log(`  -> Public catalog count: ${restoredCatalog.items.length} (Restored)\n`);

    console.log("===============================================================================");
    console.log("  ALL DEMONSTRATION CRITERIA & PRD SPECIFICATIONS COMPLETED SUCCESSFULLY!      ");
    console.log("===============================================================================");
  } finally {
    await fs.rm(demoRoot, { recursive: true, force: true }).catch(() => {});
  }
}

runDemo().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
