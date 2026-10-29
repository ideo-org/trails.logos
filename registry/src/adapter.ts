import {
  type TrailPublication,
  type TrailRevision,
  type TrailManifest,
  type PublicationReceipt,
  PACKAGE_FORMAT_VERSION,
  TrailPublicationSchema,
  TrailRevisionSchema,
  PublicationReceiptSchema,
} from "@trails-logos/core";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

export interface RegisterTrailParams {
  manifest: TrailManifest;
  packageCid: string;
  packageSizeBytes: number;
  publisherAccount: string;
  operationId: string;
}

export interface PublishRevisionParams {
  trailId: string;
  manifest: TrailManifest;
  packageCid: string;
  packageSizeBytes: number;
  publisherAccount: string;
  operationId: string;
}

export interface ListTrailsOptions {
  cursor?: string;
  limit?: number;
  includeUnlisted?: boolean;
}

export interface ListTrailsResult {
  items: TrailPublication[];
  nextCursor?: string;
}

export interface IRegistryAdapter {
  init(): Promise<void>;
  registerTrail(params: RegisterTrailParams): Promise<{ publication: TrailPublication; receipt: PublicationReceipt }>;
  publishRevision(params: PublishRevisionParams): Promise<{ publication: TrailPublication; receipt: PublicationReceipt }>;
  setListed(trailId: string, listed: boolean, signerAccount: string): Promise<TrailPublication>;
  getTrail(trailId: string): Promise<TrailPublication | null>;
  getRevision(trailId: string, revisionNumber?: number): Promise<TrailRevision | null>;
  listRevisions(trailId: string): Promise<TrailRevision[]>;
  listTrails(options?: ListTrailsOptions): Promise<ListTrailsResult>;
}

export class MockRegistryAdapter implements IRegistryAdapter {
  private publications: Map<string, TrailPublication> = new Map();
  private revisions: Map<string, Map<number, TrailRevision>> = new Map();
  private storageFile?: string;
  private networkId = "logos-localnet";
  private programId = "lez-trails-registry-v0.1.0";

  constructor(storageFile?: string) {
    this.storageFile = storageFile;
  }

  async init(): Promise<void> {
    if (this.storageFile) {
      try {
        const data = await fs.readFile(this.storageFile, "utf-8");
        const parsed = JSON.parse(data) as {
          publications: [string, TrailPublication][];
          revisions: [string, [number, TrailRevision][]][];
        };
        this.publications = new Map(parsed.publications);
        this.revisions = new Map(
          parsed.revisions.map(([id, revMap]) => [id, new Map(revMap)])
        );
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw err;
        }
      }
    }
  }

  private async persist(): Promise<void> {
    if (!this.storageFile) return;
    await fs.mkdir(path.dirname(this.storageFile), { recursive: true });
    const serializable = {
      publications: Array.from(this.publications.entries()),
      revisions: Array.from(this.revisions.entries()).map(([id, revMap]) => [
        id,
        Array.from(revMap.entries()),
      ]),
    };
    await fs.writeFile(this.storageFile, JSON.stringify(serializable, null, 2), "utf-8");
  }

  async registerTrail(params: RegisterTrailParams): Promise<{ publication: TrailPublication; receipt: PublicationReceipt }> {
    const { manifest, packageCid, packageSizeBytes, publisherAccount, operationId } = params;
    const trailId = manifest.trailId;

    if (this.publications.has(trailId)) {
      throw new Error(`Trail ${trailId} is already registered`);
    }

    const now = new Date().toISOString();
    const publication: TrailPublication = {
      trailId,
      publisherAccount,
      currentRevision: 1,
      packageCid,
      packageSizeBytes,
      packageFormatVersion: PACKAGE_FORMAT_VERSION,
      title: manifest.title,
      shortDescription: manifest.introduction,
      recordedAt: manifest.recordedAt,
      capabilities: manifest.capabilities,
      listed: true,
      createdAt: now,
      updatedAt: now,
    };
    TrailPublicationSchema.parse(publication);

    const revision: TrailRevision = {
      trailId,
      revision: 1,
      packageCid,
      packageSizeBytes,
      operationId,
      publishedAt: now,
    };
    TrailRevisionSchema.parse(revision);

    this.publications.set(trailId, publication);
    const revMap = new Map<number, TrailRevision>();
    revMap.set(1, revision);
    this.revisions.set(trailId, revMap);

    const txRef = `0x${crypto.createHash("sha256").update(`${trailId}:1:${operationId}:${now}`).digest("hex")}`;
    const receipt: PublicationReceipt = {
      trailId,
      revision: 1,
      packageCid,
      packageSizeBytes,
      networkIdentifier: this.networkId,
      registryProgramIdentifier: this.programId,
      registryRecordReference: `lez://trails/${trailId}`,
      transactionReference: txRef,
      verifiedAt: now,
    };
    PublicationReceiptSchema.parse(receipt);

    await this.persist();
    return { publication, receipt };
  }

  async publishRevision(params: PublishRevisionParams): Promise<{ publication: TrailPublication; receipt: PublicationReceipt }> {
    const { trailId, manifest, packageCid, packageSizeBytes, publisherAccount, operationId } = params;
    const pub = this.publications.get(trailId);
    if (!pub) {
      throw new Error(`Trail ${trailId} does not exist`);
    }

    if (pub.publisherAccount !== publisherAccount) {
      throw new Error(
        `Unauthorized: publisher is ${pub.publisherAccount}, caller is ${publisherAccount}`
      );
    }

    const nextRevision = pub.currentRevision + 1;
    const now = new Date().toISOString();

    pub.currentRevision = nextRevision;
    pub.packageCid = packageCid;
    pub.packageSizeBytes = packageSizeBytes;
    pub.title = manifest.title;
    pub.shortDescription = manifest.introduction;
    pub.recordedAt = manifest.recordedAt;
    pub.capabilities = manifest.capabilities;
    pub.updatedAt = now;

    const revision: TrailRevision = {
      trailId,
      revision: nextRevision,
      packageCid,
      packageSizeBytes,
      operationId,
      publishedAt: now,
    };
    TrailRevisionSchema.parse(revision);

    let revMap = this.revisions.get(trailId);
    if (!revMap) {
      revMap = new Map();
      this.revisions.set(trailId, revMap);
    }
    revMap.set(nextRevision, revision);

    const txRef = `0x${crypto.createHash("sha256").update(`${trailId}:${nextRevision}:${operationId}:${now}`).digest("hex")}`;
    const receipt: PublicationReceipt = {
      trailId,
      revision: nextRevision,
      packageCid,
      packageSizeBytes,
      networkIdentifier: this.networkId,
      registryProgramIdentifier: this.programId,
      registryRecordReference: `lez://trails/${trailId}`,
      transactionReference: txRef,
      verifiedAt: now,
    };
    PublicationReceiptSchema.parse(receipt);

    await this.persist();
    return { publication: pub, receipt };
  }

  async setListed(
    trailId: string,
    listed: boolean,
    signerAccount: string
  ): Promise<TrailPublication> {
    const pub = this.publications.get(trailId);
    if (!pub) {
      throw new Error(`Trail ${trailId} does not exist`);
    }
    if (pub.publisherAccount !== signerAccount) {
      throw new Error(
        `Unauthorized: publisher is ${pub.publisherAccount}, caller is ${signerAccount}`
      );
    }

    pub.listed = listed;
    pub.updatedAt = new Date().toISOString();
    await this.persist();
    return pub;
  }

  async getTrail(trailId: string): Promise<TrailPublication | null> {
    const pub = this.publications.get(trailId);
    return pub ? { ...pub } : null;
  }

  async getRevision(
    trailId: string,
    revisionNumber?: number
  ): Promise<TrailRevision | null> {
    const pub = this.publications.get(trailId);
    if (!pub) return null;

    const revNum = revisionNumber ?? pub.currentRevision;
    const revMap = this.revisions.get(trailId);
    if (!revMap) return null;

    const rev = revMap.get(revNum);
    return rev ? { ...rev } : null;
  }

  async listRevisions(trailId: string): Promise<TrailRevision[]> {
    const revMap = this.revisions.get(trailId);
    if (!revMap) return [];
    return Array.from(revMap.values()).sort((a, b) => a.revision - b.revision);
  }

  async listTrails(options?: ListTrailsOptions): Promise<ListTrailsResult> {
    const limit = options?.limit ?? 50;
    const includeUnlisted = options?.includeUnlisted ?? false;
    let all = Array.from(this.publications.values());

    if (!includeUnlisted) {
      all = all.filter((p) => p.listed);
    }

    // Sort by createdAt descending
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    let startIndex = 0;
    if (options?.cursor) {
      const idx = all.findIndex((p) => p.trailId === options.cursor);
      if (idx >= 0) {
        startIndex = idx + 1;
      }
    }

    const items = all.slice(startIndex, startIndex + limit);
    const nextCursor =
      startIndex + limit < all.length ? items[items.length - 1]?.trailId : undefined;

    return { items, nextCursor };
  }
}

export class LezRegistryAdapter implements IRegistryAdapter {
  private rpcUrl: string;
  private fallback: MockRegistryAdapter;

  constructor(rpcUrl = "http://127.0.0.1:8545", stateBackupPath?: string) {
    this.rpcUrl = rpcUrl;
    this.fallback = new MockRegistryAdapter(stateBackupPath);
  }

  getRpcUrl(): string {
    return this.rpcUrl;
  }

  async init(): Promise<void> {
    await this.fallback.init();
  }

  async registerTrail(params: RegisterTrailParams): Promise<{ publication: TrailPublication; receipt: PublicationReceipt }> {
    return this.fallback.registerTrail(params);
  }

  async publishRevision(params: PublishRevisionParams): Promise<{ publication: TrailPublication; receipt: PublicationReceipt }> {
    return this.fallback.publishRevision(params);
  }

  async setListed(
    trailId: string,
    listed: boolean,
    signerAccount: string
  ): Promise<TrailPublication> {
    return this.fallback.setListed(trailId, listed, signerAccount);
  }

  async getTrail(trailId: string): Promise<TrailPublication | null> {
    return this.fallback.getTrail(trailId);
  }

  async getRevision(
    trailId: string,
    revisionNumber?: number
  ): Promise<TrailRevision | null> {
    return this.fallback.getRevision(trailId, revisionNumber);
  }

  async listRevisions(trailId: string): Promise<TrailRevision[]> {
    return this.fallback.listRevisions(trailId);
  }

  async listTrails(options?: ListTrailsOptions): Promise<ListTrailsResult> {
    return this.fallback.listTrails(options);
  }
}
