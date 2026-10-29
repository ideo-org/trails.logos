import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { type TrailManifest, SCHEMA_VERSION } from "@trails-logos/core";

export async function createSampleTrailPackage(targetDir: string, overrides?: Partial<TrailManifest>): Promise<TrailManifest> {
  await fs.mkdir(targetDir, { recursive: true });
  await fs.mkdir(path.join(targetDir, "assets", "images"), { recursive: true });
  await fs.mkdir(path.join(targetDir, "assets", "audio"), { recursive: true });
  await fs.mkdir(path.join(targetDir, "assets", "video"), { recursive: true });

  // 1. Assets
  const coverBuffer = Buffer.from("FAKE_JPEG_BINARY_DATA_FOR_TRAIL_COVER_IMAGE_HEADER_12345");
  const coverPath = path.join("assets", "images", "cover.jpg").replace(/\\/g, "/");
  await fs.writeFile(path.join(targetDir, coverPath), coverBuffer);
  const coverSha = crypto.createHash("sha256").update(coverBuffer).digest("hex");

  const voiceBuffer = Buffer.from("FAKE_AAC_M4A_VOICE_MEMO_LOOK_AT_THIS_BREATHTAKING_SUNRISE_VALLEY");
  const voicePath = path.join("assets", "audio", "voice-01.m4a").replace(/\\/g, "/");
  await fs.writeFile(path.join(targetDir, voicePath), voiceBuffer);
  const voiceSha = crypto.createHash("sha256").update(voiceBuffer).digest("hex");

  const videoBuffer = Buffer.from("FAKE_MP4_PANORAMA_VIDEO_360_SWEEP_OVER_THE_BAY_AREA");
  const videoPath = path.join("assets", "video", "panorama.mp4").replace(/\\/g, "/");
  await fs.writeFile(path.join(targetDir, videoPath), videoBuffer);
  const videoSha = crypto.createHash("sha256").update(videoBuffer).digest("hex");

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
      hasVideos: true,
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
        width: 1920,
        height: 1080,
      },
      {
        id: "asset-voice-01",
        kind: "audio",
        mediaType: "audio/mp4",
        relativePath: voicePath,
        byteLength: voiceBuffer.length,
        sha256: voiceSha,
        durationMs: 15500,
      },
      {
        id: "asset-video-01",
        kind: "video",
        mediaType: "video/mp4",
        relativePath: videoPath,
        byteLength: videoBuffer.length,
        sha256: videoSha,
        durationMs: 30000,
        width: 1920,
        height: 1080,
      },
    ],
    moments: [
      {
        id: "moment-01",
        originalOrder: 1,
        startedAt: "2026-10-29T06:30:15.000Z",
        assetIds: ["asset-cover-01"],
        text: "Beginning of the steep incline at dawn.",
      },
      {
        id: "moment-02",
        originalOrder: 2,
        startedAt: "2026-10-29T06:35:40.000Z",
        assetIds: ["asset-voice-01", "asset-video-01"],
        text: "Crest of the first ridge — listen to the wind and see the bay view.",
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
          segmentId: "seg-geo-01",
        },
        {
          timestamp: "2026-10-29T06:32:00.000Z",
          latitude: 37.5128,
          longitude: -121.9025,
          accuracy: 3.2,
          altitude: 462.1,
          segmentId: "seg-geo-01",
        },
        {
          timestamp: "2026-10-29T06:34:00.000Z",
          latitude: 37.5135,
          longitude: -121.9030,
          accuracy: 2.8,
          altitude: 475.0,
          segmentId: "seg-geo-01",
        },
      ],
    },
    spatialSessions: [
      {
        sessionId: "sess-01",
        startedAt: "2026-10-29T06:30:00.000Z",
        coordinateFrameId: "frame-01",
        trackingState: "normal",
      },
    ],
    coordinateFrames: [
      {
        id: "frame-01",
        units: "meters",
        axisConvention: "rightHandedYUp",
        worldAlignmentConfiguration: "gravityAndHeading",
        sourceSessionId: "sess-01",
        transformRelationships: [],
      },
    ],
    ...overrides,
  };

  await fs.writeFile(
    path.join(targetDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );

  return manifest;
}
