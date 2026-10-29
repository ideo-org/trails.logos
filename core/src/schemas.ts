import { z } from 'zod';

export const SCHEMA_VERSION = '1.0.0';
export const PACKAGE_FORMAT_VERSION = '0.1.0';

// 1. Capabilities
export const CapabilitiesSchema = z.object({
  hasPhotos: z.boolean().default(false),
  hasVideos: z.boolean().default(false),
  hasVoice: z.boolean().default(false),
  hasText: z.boolean().default(false),
  hasGeographicPath: z.boolean().default(false),
  hasLocalSpatialPath: z.boolean().default(false),
  hasSpatialGeometry: z.boolean().default(false),
  hasPlan: z.boolean().default(false),
  hasAlignmentAssets: z.boolean().default(false),
}).strict();

export type Capabilities = z.infer<typeof CapabilitiesSchema>;

// 2. Asset
export const AssetKindSchema = z.enum([
  'photo',
  'video',
  'audio',
  'spatial',
  'alignment',
  'preview',
  'other',
]);

export const AssetSchema = z.object({
  id: z.string().min(1),
  kind: AssetKindSchema,
  relativePath: z.string().min(1).refine(
    (p) => !p.startsWith('/') && !p.startsWith('\\') && !p.includes('..'),
    { message: 'Asset relativePath must be relative and cannot contain ".." or leading slashes' }
  ),
  mediaType: z.string().min(1),
  byteLength: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Must be a 64-character lowercase hex SHA-256 digest'),
  durationMs: z.number().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  thumbnailAssetId: z.string().optional(),
}).strict();

export type Asset = z.infer<typeof AssetSchema>;

// 3. Geographic Context & Moments
export const GeographicContextSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional(),
  accuracy: z.number().optional(),
}).strict();

export const LocalSpatialContextSchema = z.object({
  position: z.tuple([z.number(), z.number(), z.number()]),
  coordinateFrameId: z.string().min(1),
}).strict();

export const MomentSchema = z.object({
  id: z.string().min(1),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  originalOrder: z.number().int(),
  presentationOrder: z.number().int().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  assetIds: z.array(z.string()),
  geographicContext: GeographicContextSchema.optional(),
  localSpatialContext: LocalSpatialContextSchema.optional(),
}).strict();

export type Moment = z.infer<typeof MomentSchema>;

// 4. Place
export const PlaceSchema = z.object({
  localId: z.string().optional(),
  name: z.string().optional(),
  locality: z.string().optional(),
  geographicAnchor: GeographicContextSchema.optional(),
  floorLabel: z.string().optional(),
}).strict();

export type Place = z.infer<typeof PlaceSchema>;

// 5. Geographic Path
export const GeographicPathPointSchema = z.object({
  timestamp: z.string().datetime(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive(),
  altitude: z.number().optional(),
  altitudeAccuracy: z.number().optional(),
  segmentId: z.string().min(1),
  quality: z.string().optional(),
}).strict();

export const GeographicPathSchema = z.object({
  points: z.array(GeographicPathPointSchema),
}).strict();

export type GeographicPath = z.infer<typeof GeographicPathSchema>;

// 6. Local Spatial Path
export const LocalSpatialPathPointSchema = z.object({
  timestamp: z.string().datetime(),
  position: z.tuple([z.number(), z.number(), z.number()]),
  coordinateFrameId: z.string().min(1),
  trackingState: z.string().min(1),
  segmentId: z.string().min(1),
  orientation: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
}).strict();

export const LocalSpatialPathSchema = z.object({
  points: z.array(LocalSpatialPathPointSchema),
}).strict();

export type LocalSpatialPath = z.infer<typeof LocalSpatialPathSchema>;

// 7. Coordinate Frame & Spatial Session
export const TransformRelationshipSchema = z.object({
  sourceFrame: z.string().min(1),
  destinationFrame: z.string().min(1),
  matrix: z.array(z.number()).length(16),
  direction: z.string().min(1),
  validationStatus: z.string().min(1),
}).strict();

export const CoordinateFrameSchema = z.object({
  id: z.string().min(1),
  units: z.string().min(1),
  axisConvention: z.string().min(1),
  worldAlignmentConfiguration: z.string().min(1),
  sourceSessionId: z.string().min(1),
  transformRelationships: z.array(TransformRelationshipSchema),
}).strict();

export type CoordinateFrame = z.infer<typeof CoordinateFrameSchema>;

export const SpatialSessionSchema = z.object({
  sessionId: z.string().min(1),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  coordinateFrameId: z.string().min(1),
  trackingState: z.string().min(1),
}).strict();

export type SpatialSession = z.infer<typeof SpatialSessionSchema>;

// 8. Trail Manifest
export const TrailManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  trailId: z.string().min(1),
  revision: z.number().int().positive(),
  title: z.string().min(1),
  introduction: z.string().optional(),
  creatorDisplayName: z.string().optional(),
  recordedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  place: PlaceSchema.optional(),
  coverAssetId: z.string().optional(),
  capabilities: CapabilitiesSchema,
  assets: z.array(AssetSchema),
  moments: z.array(MomentSchema),
  geographicPath: GeographicPathSchema.optional(),
  spatialSessions: z.array(SpatialSessionSchema).default([]),
  coordinateFrames: z.array(CoordinateFrameSchema).default([]),
}).strict();

export type TrailManifest = z.infer<typeof TrailManifestSchema>;

// 9. Trail Publication (LEZ State Record)
export const TrailPublicationSchema = z.object({
  trailId: z.string().min(1),
  publisherAccount: z.string().min(1),
  currentRevision: z.number().int().positive(),
  packageCid: z.string().min(1),
  packageSizeBytes: z.number().int().positive(),
  packageFormatVersion: z.literal(PACKAGE_FORMAT_VERSION),
  title: z.string().min(1),
  shortDescription: z.string().optional(),
  recordedAt: z.string().datetime(),
  capabilities: CapabilitiesSchema,
  listed: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type TrailPublication = z.infer<typeof TrailPublicationSchema>;

// 10. Publication Revision History Record
export const TrailRevisionSchema = z.object({
  trailId: z.string().min(1),
  revision: z.number().int().positive(),
  packageCid: z.string().min(1),
  packageSizeBytes: z.number().int().positive(),
  operationId: z.string().min(1),
  publishedAt: z.string().datetime(),
}).strict();

export type TrailRevision = z.infer<typeof TrailRevisionSchema>;

// 11. Publication Receipt
export const PublicationReceiptSchema = z.object({
  trailId: z.string().min(1),
  revision: z.number().int().positive(),
  packageCid: z.string().min(1),
  packageSizeBytes: z.number().int().positive(),
  networkIdentifier: z.string().min(1),
  registryProgramIdentifier: z.string().min(1),
  registryRecordReference: z.string().min(1),
  transactionReference: z.string().min(1),
  verifiedAt: z.string().datetime(),
}).strict();

export type PublicationReceipt = z.infer<typeof PublicationReceiptSchema>;

// 12. Registry Config
export const RegistryConfigSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  administratorAccount: z.string().min(1),
  authorisedPublisherAccount: z.string().min(1),
}).strict();

export type RegistryConfig = z.infer<typeof RegistryConfigSchema>;
