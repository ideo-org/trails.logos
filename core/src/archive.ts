import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { validateTrailPackage, ValidationResult } from './validator.js';

export interface PackResult {
  zipBuffer: Buffer;
  byteLength: number;
  sha256: string;
  cid: string;
  validation: ValidationResult;
}

/**
 * Compute deterministic content-addressed identifier (CID) from binary package.
 * Format: "cid_sha256_<hex>"
 */
export function computePackageCid(buffer: Buffer): string {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').toLowerCase();
  return `cid_sha256_${hash}`;
}

/**
 * Pack a valid trail directory into a ZIP archive buffer and calculate its CID.
 */
export function packTrailPackage(packageDir: string): PackResult {
  // First validate the directory
  const validation = validateTrailPackage(packageDir);

  const zip = new AdmZip();
  // Add all files recursively from package directory
  zip.addLocalFolder(packageDir);

  const zipBuffer = zip.toBuffer();
  const byteLength = zipBuffer.length;
  const sha256 = crypto.createHash('sha256').update(zipBuffer).digest('hex').toLowerCase();
  const cid = computePackageCid(zipBuffer);

  return {
    zipBuffer,
    byteLength,
    sha256,
    cid,
    validation,
  };
}

/**
 * Unpack a ZIP buffer into target directory and validate it.
 */
export function unpackTrailPackage(zipBufferOrPath: Buffer | string, targetDir: string): ValidationResult {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const zip = typeof zipBufferOrPath === 'string'
    ? new AdmZip(zipBufferOrPath)
    : new AdmZip(zipBufferOrPath);

  zip.extractAllTo(targetDir, true);

  return validateTrailPackage(targetDir);
}
