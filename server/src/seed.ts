import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { type TrailManifest, SCHEMA_VERSION, packTrailPackage } from "@trails-logos/core";
import { type IRegistryAdapter } from "@trails-logos/registry";
import { type IStorageAdapter } from "@trails-logos/storage";

export async function createSamplePackage(targetDir: string, overrides?: Partial<TrailManifest>): Promise<TrailManifest> {
  await fs.mkdir(targetDir, { recursive: true });
  await fs.mkdir(path.join(targetDir, "assets", "images"), { recursive: true });
  await fs.mkdir(path.join(targetDir, "assets", "audio"), { recursive: true });

  const coverBuffer = Buffer.from("SAMPLE_TRAIL_COVER_IMAGE_JPEG_HEADER");
  const coverPath = path.join("assets", "images", "cover.jpg").replace(/\\/g, "/");
  await fs.writeFile(path.join(targetDir, coverPath), coverBuffer);
  const coverSha = crypto.createHash("sha256").update(coverBuffer).digest("hex");

  const voiceBuffer = Buffer.from("SAMPLE_VOICE_MEMO_SPATIAL_RECORDING");
  const voicePath = path.join("assets", "audio", "voice-01.m4a").replace(/\\/g, "/");
  await fs.writeFile(path.join(targetDir, voicePath), voiceBuffer);
  const voiceSha = crypto.createHash("sha256").update(voiceBuffer).digest("hex");

  const trailId = overrides?.trailId ?? "e57b98d3-7d52-441f-8cb4-20bce01e35d1";
  const recordedAt = "2026-10-29T06:30:00.000Z";

  const manifest: TrailManifest = {
    schemaVersion: SCHEMA_VERSION,
    trailId,
    revision: overrides?.revision ?? 1,
    title: overrides?.title ?? "Mission Peak Ridge Sunrise Trail",
    introduction: "Stunning early morning ridgeline walk with views across Silicon Valley.",
    creatorDisplayName: "Hiro Nomad",
    recordedAt,
    endedAt: "2026-10-29T07:15:00.000Z",
    place: {
      name: "Mission Peak Regional Preserve",
      locality: "Fremont, CA",
      geographicAnchor: {
        latitude: 37.5123,
        longitude: -121.9021,
        altitude: 450.2,
      },
    },
    coverAssetId: "asset-cover-01",
    capabilities: {
      hasPhotos: true,
      hasVideos: false,
      hasVoice: true,
      hasText: true,
      hasGeographicPath: true,
      hasLocalSpatialPath: true,
      hasSpatialGeometry: false,
      hasPlan: false,
      hasAlignmentAssets: false,
    },
    assets: [
      {
        id: "asset-cover-01",
        kind: "photo",
        mediaType: "image/jpeg",
        relativePath: coverPath,
        byteLength: coverBuffer.length,
        sha256: coverSha,
      },
      {
        id: "asset-voice-01",
        kind: "audio",
        mediaType: "audio/mp4",
        relativePath: voicePath,
        byteLength: voiceBuffer.length,
        sha256: voiceSha,
      },
    ],
    moments: [
      {
        id: "moment-01",
        originalOrder: 1,
        startedAt: "2026-10-29T06:30:15.000Z",
        assetIds: ["asset-cover-01"],
        text: "Threshold of the trail overlooking the bay.",
      },
    ],
    geographicPath: {
      points: [
        {
          timestamp: "2026-10-29T06:30:00.000Z",
          latitude: 37.5123,
          longitude: -121.9021,
          accuracy: 3.5,
          altitude: 450.2,
          segmentId: "seg-01",
        },
      ],
    },
    spatialSessions: [],
    coordinateFrames: [],
    ...overrides,
  };

  await fs.writeFile(
    path.join(targetDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );

  return manifest;
}

export async function seedCatalogueIfEmpty(
  registry: IRegistryAdapter,
  storage: IStorageAdapter,
  tempDir: string
): Promise<void> {
  const catalog = await registry.listTrails({ includeUnlisted: true });
  if (catalog.items.some(t => t.trailId.startsWith("test-"))) return;

  console.log("[trails.logos] Seeding sample PRD v0.4.0 catalogue with test- creators...");

  // 1. Presidio Coastal Overlook by @test-mira
  const t1Dir = path.join(tempDir, "seed-t1");
  const m1 = await createSamplePackage(t1Dir, {
    trailId: "test-presidio-coastal-trail",
    title: "Presidio Coastal Overlook (Sample)",
    introduction: "Pacific ocean bluffs and eucalyptus groves above the Golden Gate.",
    creatorId: "creator-test-mira",
    creatorUsername: "test-mira",
    creatorDisplayName: "Mira Patel (Test)",
    place: {
      name: "Presidio Bluffs",
      locality: "San Francisco, CA",
      geographicAnchor: {
        latitude: 37.7983,
        longitude: -122.4662,
        altitude: 90.0,
      },
    },
  });
  const p1 = packTrailPackage(t1Dir);
  const u1 = await storage.uploadPackage(p1.zipBuffer);
  await registry.registerTrail({
    manifest: m1,
    packageCid: u1.cid,
    packageSizeBytes: u1.byteLength,
    publisherAccount: "0xMIRA_COMMUNITY_PUBLISHER_1001",
    operationId: "seed-op-1",
  });

  // 2. Mission Peak Ridge by @test-hiro
  const t2Dir = path.join(tempDir, "seed-t2");
  const m2 = await createSamplePackage(t2Dir, {
    trailId: "test-mission-peak-ridge",
    title: "Mission Peak Ridge Sunrise Trail (Sample)",
    introduction: "Early morning ridgeline walk with views across Silicon Valley.",
    creatorId: "creator-test-hiro",
    creatorUsername: "test-hiro",
    creatorDisplayName: "Hiro Nomad (Test)",
    place: {
      name: "Mission Peak",
      locality: "Fremont, CA",
      geographicAnchor: {
        latitude: 37.5123,
        longitude: -121.9021,
        altitude: 450.2,
      },
    },
  });
  const p2 = packTrailPackage(t2Dir);
  const u2 = await storage.uploadPackage(p2.zipBuffer);
  await registry.registerTrail({
    manifest: m2,
    packageCid: u2.cid,
    packageSizeBytes: u2.byteLength,
    publisherAccount: "0xHIRO_AUTHOR_KEY_2002",
    operationId: "seed-op-2",
  });

  // 3. Acoustic Study (unlocated anchor-less trail) by @test-soundcraft
  const t3Dir = path.join(tempDir, "seed-t3");
  const m3 = await createSamplePackage(t3Dir, {
    trailId: "test-acoustic-resonance-study",
    title: "Atmospheric Acoustic Resonance Study (Sample)",
    introduction: "Spatial audio reverberation decay across cavernous unanchored chambers.",
    creatorId: "creator-test-soundcraft",
    creatorUsername: "test-soundcraft",
    creatorDisplayName: "SoundCraft (Test)",
    place: undefined,
    geographicPath: undefined,
  });
  const p3 = packTrailPackage(t3Dir);
  const u3 = await storage.uploadPackage(p3.zipBuffer);
  await registry.registerTrail({
    manifest: m3,
    packageCid: u3.cid,
    packageSizeBytes: u3.byteLength,
    publisherAccount: "0xSOUND_COMMUNITY_KEY_3003",
    operationId: "seed-op-3",
  });

  console.log("[trails.logos] Seeded 3 test sample trails across @test-* creators successfully!");
}
