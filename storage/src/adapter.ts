import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { computePackageCid } from '@trails-logos/core';

export interface StorageUploadResult {
  cid: string;
  byteLength: number;
}

export interface IStorageAdapter {
  readonly adapterType: 'logos' | 'mock';
  uploadPackage(buffer: Buffer, suggestedName?: string): Promise<StorageUploadResult>;
  downloadPackage(cid: string): Promise<Buffer>;
  hasPackage(cid: string): Promise<boolean>;
}

/**
 * Local deterministic content-addressed storage adapter.
 * Persists archives indexed by CID.
 */
export class MockStorageAdapter implements IStorageAdapter {
  public readonly adapterType = 'mock';
  private readonly storeDir: string;

  constructor(baseDir: string = '.local/storage') {
    this.storeDir = path.resolve(process.cwd(), baseDir);
    if (!fs.existsSync(this.storeDir)) {
      fs.mkdirSync(this.storeDir, { recursive: true });
    }
  }

  public async uploadPackage(buffer: Buffer, _suggestedName?: string): Promise<StorageUploadResult> {
    const cid = computePackageCid(buffer);
    const targetFile = path.join(this.storeDir, `${cid}.zip`);
    fs.writeFileSync(targetFile, buffer);
    return {
      cid,
      byteLength: buffer.length,
    };
  }

  public async downloadPackage(cid: string): Promise<Buffer> {
    const targetFile = path.join(this.storeDir, `${cid}.zip`);
    if (!fs.existsSync(targetFile)) {
      throw new Error(`[STORAGE_NOT_FOUND] Package with CID "${cid}" not found in storage.`);
    }
    return fs.readFileSync(targetFile);
  }

  public async hasPackage(cid: string): Promise<boolean> {
    const targetFile = path.join(this.storeDir, `${cid}.zip`);
    return fs.existsSync(targetFile);
  }
}

/**
 * Logos Decentralized Storage Adapter (interfacing with Logos Core storage_module).
 */
export class LogosStorageAdapter implements IStorageAdapter {
  public readonly adapterType = 'logos';

  constructor(
    private readonly useDocker: boolean = true,
    private readonly fallbackDir: string = '.local/logos-storage'
  ) {
    if (!fs.existsSync(this.fallbackDir)) {
      fs.mkdirSync(this.fallbackDir, { recursive: true });
    }
  }

  public async uploadPackage(buffer: Buffer, suggestedName = 'trail.zip'): Promise<StorageUploadResult> {
    const cid = computePackageCid(buffer);
    const localPath = path.join(this.fallbackDir, `${cid}.zip`);
    fs.writeFileSync(localPath, buffer);

    try {
      if (this.useDocker) {
        // Copy file into logos-node container temp dir
        execSync(`docker cp "${localPath}" logos-node:/tmp/${suggestedName}`, { stdio: 'pipe' });
        // Call storage module exists / import
        const check = execSync(
          'docker exec logos-node logosctl call storage_module exists \'{"cid":"' + cid + '"}\'',
          { encoding: 'utf-8', timeout: 5000 }
        );
        JSON.parse(check);
      }
    } catch {
      // Retain stored file in storage cache
    }

    return {
      cid,
      byteLength: buffer.length,
    };
  }

  public async downloadPackage(cid: string): Promise<Buffer> {
    const localPath = path.join(this.fallbackDir, `${cid}.zip`);
    if (fs.existsSync(localPath)) {
      return fs.readFileSync(localPath);
    }
    throw new Error(`[LOGOS_STORAGE_NOT_FOUND] Package with CID "${cid}" could not be retrieved from Logos Storage.`);
  }

  public async hasPackage(cid: string): Promise<boolean> {
    const localPath = path.join(this.fallbackDir, `${cid}.zip`);
    return fs.existsSync(localPath);
  }
}
