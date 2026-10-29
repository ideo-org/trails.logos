import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { TrailManifest, TrailManifestSchema } from './schemas.js';

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ValidationResult {
  valid: boolean;
  manifest?: TrailManifest;
  issues: ValidationIssue[];
  totalAssets: number;
  totalBytes: number;
}

export class ValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(`Package validation failed with ${issues.length} issue(s):\n` + issues.map((i) => `  [${i.code}] ${i.message}`).join('\n'));
    this.name = 'ValidationError';
  }
}

export interface ValidateOptions {
  throwOnError?: boolean;
}

/**
 * Validate a trail package directory against PRD requirements.
 */
export function validateTrailPackage(packageDir: string, options?: ValidateOptions): ValidationResult {
  const issues: ValidationIssue[] = [];
  const throwOnError = options?.throwOnError ?? false;

  const fail = (code: string, message: string, path?: string): ValidationResult => {
    issues.push({ code, message, path });
    if (throwOnError) {
      throw new ValidationError(issues);
    }
    return {
      valid: false,
      issues,
      totalAssets: 0,
      totalBytes: 0,
    };
  };

  // 1. Check directory exists
  if (!fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
    return fail('DIR_NOT_FOUND', `Package directory not found: ${packageDir}`);
  }

  // 2. Check manifest.json exists
  const manifestPath = path.join(packageDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return fail('MANIFEST_MISSING', 'manifest.json not found in package root');
  }

  let rawManifest: unknown;
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    rawManifest = JSON.parse(content);
  } catch (err: any) {
    return fail('MANIFEST_CORRUPT', `Could not parse manifest.json: ${err.message}`);
  }

  // 3. Validate manifest schema
  const parseRes = TrailManifestSchema.safeParse(rawManifest);
  if (!parseRes.success) {
    for (const err of parseRes.error.issues) {
      issues.push({
        code: 'SCHEMA_VIOLATION',
        message: `${err.path.join('.')}: ${err.message}`,
        path: err.path.join('.'),
      });
    }
    if (throwOnError) {
      throw new ValidationError(issues);
    }
    return {
      valid: false,
      issues,
      totalAssets: 0,
      totalBytes: 0,
    };
  }

  const manifest = parseRes.data;
  const assetIdMap = new Map<string, (typeof manifest.assets)[0]>();
  let totalBytes = 0;

  // 4. Validate Assets (existence, path safety, byteLength, sha256)
  for (const asset of manifest.assets) {
    assetIdMap.set(asset.id, asset);

    // Path traversal check
    if (path.isAbsolute(asset.relativePath) || asset.relativePath.includes('..')) {
      issues.push({
        code: 'ILLEGAL_PATH',
        message: `Asset "${asset.id}" has illegal path traversal: ${asset.relativePath}`,
      });
      continue;
    }

    const fullPath = path.join(packageDir, asset.relativePath);
    if (!fs.existsSync(fullPath)) {
      issues.push({
        code: 'MISSING_ASSET_FILE',
        message: `Asset "${asset.id}" references missing file: ${asset.relativePath}`,
      });
      continue;
    }

    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      issues.push({
        code: 'ASSET_NOT_FILE',
        message: `Asset path is not a regular file: ${asset.relativePath}`,
      });
      continue;
    }

    // Check byte length
    if (stat.size !== asset.byteLength) {
      issues.push({
        code: 'BYTE_LENGTH_MISMATCH',
        message: `Asset "${asset.id}" size mismatch: manifest specifies ${asset.byteLength} bytes, file is ${stat.size} bytes`,
      });
    }
    totalBytes += stat.size;

    // Check SHA-256 digest
    const fileBytes = fs.readFileSync(fullPath);
    const hash = crypto.createHash('sha256').update(fileBytes).digest('hex').toLowerCase();
    if (hash !== asset.sha256.toLowerCase()) {
      issues.push({
        code: 'HASH_MISMATCH',
        message: `Asset "${asset.id}" SHA-256 hash mismatch. Expected ${asset.sha256}, got ${hash}`,
      });
    }
  }

  // 5. Validate coverAssetId
  if (manifest.coverAssetId && !assetIdMap.has(manifest.coverAssetId)) {
    issues.push({
      code: 'INVALID_COVER_ASSET',
      message: `coverAssetId "${manifest.coverAssetId}" is not declared in assets array`,
    });
  }

  // 6. Validate Moments asset references
  for (const moment of manifest.moments) {
    for (const aId of moment.assetIds) {
      if (!assetIdMap.has(aId)) {
        issues.push({
          code: 'INVALID_MOMENT_ASSET_REF',
          message: `Moment "${moment.id}" references undeclared asset ID "${aId}"`,
        });
      }
    }
  }

  // 7. Validate Coordinate Frames
  const frameIds = new Set<string>(manifest.coordinateFrames.map((f) => f.id));
  for (const session of manifest.spatialSessions) {
    if (!frameIds.has(session.coordinateFrameId)) {
      issues.push({
        code: 'INVALID_FRAME_REF',
        message: `Spatial session "${session.sessionId}" references undeclared coordinateFrameId "${session.coordinateFrameId}"`,
      });
    }
  }

  if (issues.length > 0) {
    if (throwOnError) {
      throw new ValidationError(issues);
    }
    return {
      valid: false,
      issues,
      totalAssets: manifest.assets.length,
      totalBytes,
    };
  }

  return {
    valid: true,
    manifest,
    issues: [],
    totalAssets: manifest.assets.length,
    totalBytes,
  };
}
