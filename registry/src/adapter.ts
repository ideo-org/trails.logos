import {
  type TrailPublication,
  type TrailRevision,
  type TrailManifest,
  type PublicationReceipt,
  type DiscoveryRecord,
  type DiscoveryAnchor,
  type CreatorRecord,
  PACKAGE_FORMAT_VERSION,
  TrailPublicationSchema,
  TrailRevisionSchema,
  PublicationReceiptSchema,
  DiscoveryRecordSchema,
  CreatorRecordSchema,
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

export interface ListDiscoveryOptions {
  area?: string;
  creatorId?: string;
  query?: string;
  cursor?: string;
  limit?: number;
  includeUnlisted?: boolean;
}

export interface ListDiscoveryResult {
  items: DiscoveryRecord[];
  nextCursor?: string;
}

export interface CheckUsernameResult {
  available: boolean;
  username: string;
  reason?: string;
  claimedBy?: string;
}

export interface ClaimCreatorParams {
  username: string;
  displayName?: string;
  accountAddress: string;
  bio?: string;
  avatarUrl?: string;
  ensDomain?: string;
}

export interface IRegistryAdapter {
  init(): Promise<void>;
  registerTrail(params: RegisterTrailParams): Promise<{ publication: TrailPublication; receipt: PublicationReceipt }>;
  publishRevision(params: PublishRevisionParams): Promise<{ publication: TrailPublication; receipt: PublicationReceipt }>;
  setListed(trailId: string, listed: boolean, signerAccount: string): Promise<TrailPublication>;
  getTrail(trailId: string): Promise<TrailPublication | null>;
  getDiscoveryRecord(trailId: string): Promise<DiscoveryRecord | null>;
  getRevision(trailId: string, revisionNumber?: number): Promise<TrailRevision | null>;
  listRevisions(trailId: string): Promise<TrailRevision[]>;
  listTrails(options?: ListTrailsOptions): Promise<ListTrailsResult>;
  listDiscoveryRecords(options?: ListDiscoveryOptions): Promise<ListDiscoveryResult>;
  searchCreators(query?: string): Promise<CreatorRecord[]>;
  checkUsername(username: string): Promise<CheckUsernameResult>;
  claimCreator(params: ClaimCreatorParams): Promise<CreatorRecord>;
  getCreatorByUsername(username: string): Promise<CreatorRecord | null>;
  getCreatorByAddress(address: string): Promise<CreatorRecord | null>;
}

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export class MockRegistryAdapter implements IRegistryAdapter {
  private publications: Map<string, TrailPublication> = new Map();
  private revisions: Map<string, Map<number, TrailRevision>> = new Map();
  private discoveryRecords: Map<string, DiscoveryRecord> = new Map();
  private creators: Map<string, CreatorRecord> = new Map();
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
          discoveryRecords?: [string, DiscoveryRecord][];
          creators?: [string, CreatorRecord][];
        };
        this.publications = new Map(parsed.publications);
        this.revisions = new Map(
          parsed.revisions.map(([id, revMap]) => [id, new Map(revMap)])
        );
        if (parsed.discoveryRecords) {
          this.discoveryRecords = new Map(parsed.discoveryRecords);
        } else {
          for (const [id, pub] of this.publications.entries()) {
            this.discoveryRecords.set(id, {
              trailId: pub.trailId,
              revision: pub.currentRevision,
              title: pub.title,
              shortDescription: pub.shortDescription,
              creatorId: `creator-${pub.publisherAccount.slice(2, 10)}`,
              username: `user_${pub.publisherAccount.slice(2, 8)}`,
              displayName: "Contributor",
              publisherReference: pub.publisherAccount,
              recordedAt: pub.recordedAt,
              publishedAt: pub.createdAt,
              capabilities: pub.capabilities,
              packageCid: pub.packageCid,
              packageSizeBytes: pub.packageSizeBytes,
              listed: pub.listed,
            });
          }
        }
        if (parsed.creators) {
          this.creators = new Map(parsed.creators);
        }
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
      discoveryRecords: Array.from(this.discoveryRecords.entries()),
      creators: Array.from(this.creators.entries()),
    };
    await fs.writeFile(this.storageFile, JSON.stringify(serializable, null, 2), "utf-8");
  }

  async checkUsername(rawUsername: string): Promise<CheckUsernameResult> {
    const username = rawUsername.toLowerCase().trim().replace(/^@/, "");
    if (!username || username.length < 3) {
      return { available: false, username, reason: "Username must be at least 3 characters long" };
    }
    if (username.length > 64) {
      return { available: false, username, reason: "Username must not exceed 64 characters" };
    }
    if (!/^[a-z0-9][a-z0-9_.-]*[a-z0-9]$/.test(username)) {
      return { available: false, username, reason: "Username can only contain lowercase letters, numbers, hyphens, underscores, or periods" };
    }

    const existing = this.creators.get(username);
    if (existing) {
      return {
        available: false,
        username,
        reason: `Username @${username} is already claimed`,
        claimedBy: existing.publisherReference,
      };
    }

    for (const record of this.discoveryRecords.values()) {
      if (record.username.toLowerCase() === username) {
        return {
          available: false,
          username,
          reason: `Username @${username} is already registered in discovery`,
          claimedBy: record.publisherReference,
        };
      }
    }

    return { available: true, username };
  }

  async claimCreator(params: ClaimCreatorParams): Promise<CreatorRecord> {
    const rawUsername = params.username.toLowerCase().trim().replace(/^@/, "");
    const existing = this.creators.get(rawUsername);

    if (existing) {
      if (existing.publisherReference.toLowerCase() === params.accountAddress.toLowerCase()) {
        if (params.displayName) existing.displayName = params.displayName;
        if (params.bio !== undefined) existing.bio = params.bio;
        if (params.avatarUrl !== undefined) existing.avatarUrl = params.avatarUrl;
        if (params.ensDomain) existing.ensDomain = params.ensDomain;
        await this.persist();
        return existing;
      }
      throw new Error(`Username @${rawUsername} is already claimed by account ${existing.publisherReference}`);
    }

    const check = await this.checkUsername(rawUsername);
    if (!check.available) {
      throw new Error(check.reason || `Invalid username @${rawUsername}`);
    }

    const creatorId = `creator-${params.accountAddress.slice(2, 10).toLowerCase()}`;
    const ensDomain = params.ensDomain || (rawUsername.includes(".") ? rawUsername : `${rawUsername}.trails.eth`);

    const record: CreatorRecord = {
      creatorId,
      username: rawUsername,
      displayName: params.displayName || rawUsername,
      publisherReference: params.accountAddress,
      trailCount: 0,
      bio: params.bio,
      avatarUrl: params.avatarUrl,
      ensDomain,
    };
    CreatorRecordSchema.parse(record);
    this.creators.set(rawUsername, record);
    await this.persist();
    return record;
  }

  async getCreatorByUsername(username: string): Promise<CreatorRecord | null> {
    const norm = username.toLowerCase().trim().replace(/^@/, "");
    const found = this.creators.get(norm);
    if (found) return { ...found };
    for (const d of this.discoveryRecords.values()) {
      if (d.username.toLowerCase() === norm) {
        return {
          creatorId: d.creatorId,
          username: d.username,
          displayName: d.displayName,
          publisherReference: d.publisherReference,
          trailCount: 1,
          ensDomain: `${d.username}.trails.eth`,
        };
      }
    }
    return null;
  }

  async getCreatorByAddress(address: string): Promise<CreatorRecord | null> {
    const addr = address.toLowerCase();
    for (const c of this.creators.values()) {
      if (c.publisherReference.toLowerCase() === addr) {
        return { ...c };
      }
    }
    for (const d of this.discoveryRecords.values()) {
      if (d.publisherReference.toLowerCase() === addr) {
        return {
          creatorId: d.creatorId,
          username: d.username,
          displayName: d.displayName,
          publisherReference: d.publisherReference,
          trailCount: 1,
          ensDomain: `${d.username}.trails.eth`,
        };
      }
    }
    return null;
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

    // Build PRD Section 18 DiscoveryRecord
    let discoveryAnchor: DiscoveryAnchor | undefined = undefined;
    if (manifest.place?.geographicAnchor) {
      discoveryAnchor = {
        latitude: manifest.place.geographicAnchor.latitude,
        longitude: manifest.place.geographicAnchor.longitude,
        altitude: manifest.place.geographicAnchor.altitude,
      };
    } else if (manifest.geographicPath?.points && manifest.geographicPath.points.length > 0) {
      const firstPt = manifest.geographicPath.points[0];
      if (firstPt) {
        discoveryAnchor = {
          latitude: firstPt.latitude,
          longitude: firstPt.longitude,
          altitude: firstPt.altitude,
        };
      }
    }

    const rawUsername = manifest.creatorUsername ?? (manifest.creatorDisplayName ? manifest.creatorDisplayName.toLowerCase().replace(/\s+/g, "") : `user_${publisherAccount.slice(2, 8)}`);
    const normalizedUsername = rawUsername.toLowerCase().trim().replace(/^@/, "");

    // Enforce non-duplicate username
    const claimedCreator = this.creators.get(normalizedUsername);
    if (claimedCreator && claimedCreator.publisherReference.toLowerCase() !== publisherAccount.toLowerCase()) {
      throw new Error(`Username @${normalizedUsername} is already claimed by account ${claimedCreator.publisherReference}`);
    }

    for (const disc of this.discoveryRecords.values()) {
      if (disc.username.toLowerCase() === normalizedUsername && disc.publisherReference.toLowerCase() !== publisherAccount.toLowerCase()) {
        throw new Error(`Username @${normalizedUsername} is already registered to account ${disc.publisherReference}`);
      }
    }

    const creatorId = manifest.creatorId ?? (claimedCreator ? claimedCreator.creatorId : `creator-${publisherAccount.slice(2, 10).toLowerCase()}`);
    const displayName = manifest.creatorDisplayName ?? (claimedCreator ? claimedCreator.displayName : "Trail Contributor");

    if (!claimedCreator) {
      this.creators.set(normalizedUsername, {
        creatorId,
        username: normalizedUsername,
        displayName,
        publisherReference: publisherAccount,
        trailCount: 1,
        ensDomain: normalizedUsername.includes(".") ? normalizedUsername : `${normalizedUsername}.trails.eth`,
      });
    }

    const placeLabel = manifest.place?.name ?? manifest.place?.locality;
    const coverReference = manifest.coverAssetId ?? manifest.assets.find(a => a.kind === "photo")?.relativePath;

    const discoveryRecord: DiscoveryRecord = {
      trailId,
      revision: 1,
      title: manifest.title,
      shortDescription: manifest.introduction,
      creatorId,
      username: normalizedUsername,
      displayName,
      publisherReference: publisherAccount,
      recordedAt: manifest.recordedAt,
      publishedAt: now,
      placeLabel,
      discoveryAnchor,
      coverReference,
      capabilities: manifest.capabilities,
      packageCid,
      packageSizeBytes,
      listed: true,
    };
    DiscoveryRecordSchema.parse(discoveryRecord);
    this.discoveryRecords.set(trailId, discoveryRecord);

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

    // Update DiscoveryRecord
    let discoveryAnchor: DiscoveryAnchor | undefined = undefined;
    if (manifest.place?.geographicAnchor) {
      discoveryAnchor = {
        latitude: manifest.place.geographicAnchor.latitude,
        longitude: manifest.place.geographicAnchor.longitude,
        altitude: manifest.place.geographicAnchor.altitude,
      };
    } else if (manifest.geographicPath?.points && manifest.geographicPath.points.length > 0) {
      const firstPt = manifest.geographicPath.points[0];
      if (firstPt) {
        discoveryAnchor = {
          latitude: firstPt.latitude,
          longitude: firstPt.longitude,
          altitude: firstPt.altitude,
        };
      }
    }

    const existingDisc = this.discoveryRecords.get(trailId);
    const creatorId = manifest.creatorId ?? existingDisc?.creatorId ?? `creator-${publisherAccount.slice(2, 10)}`;
    const username = manifest.creatorUsername ?? existingDisc?.username ?? `user_${publisherAccount.slice(2, 8)}`;
    const displayName = manifest.creatorDisplayName ?? existingDisc?.displayName ?? "Trail Contributor";
    const placeLabel = manifest.place?.name ?? manifest.place?.locality ?? existingDisc?.placeLabel;
    const coverReference = manifest.coverAssetId ?? manifest.assets.find(a => a.kind === "photo")?.relativePath ?? existingDisc?.coverReference;

    const discoveryRecord: DiscoveryRecord = {
      trailId,
      revision: nextRevision,
      title: manifest.title,
      shortDescription: manifest.introduction,
      creatorId,
      username,
      displayName,
      publisherReference: publisherAccount,
      recordedAt: manifest.recordedAt,
      publishedAt: now,
      placeLabel,
      discoveryAnchor,
      coverReference,
      capabilities: manifest.capabilities,
      packageCid,
      packageSizeBytes,
      listed: pub.listed,
    };
    DiscoveryRecordSchema.parse(discoveryRecord);
    this.discoveryRecords.set(trailId, discoveryRecord);

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

    const disc = this.discoveryRecords.get(trailId);
    if (disc) {
      disc.listed = listed;
    }

    await this.persist();
    return pub;
  }

  async getTrail(trailId: string): Promise<TrailPublication | null> {
    const pub = this.publications.get(trailId);
    return pub ? { ...pub } : null;
  }

  async getDiscoveryRecord(trailId: string): Promise<DiscoveryRecord | null> {
    const disc = this.discoveryRecords.get(trailId);
    return disc ? { ...disc } : null;
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

  async listDiscoveryRecords(options?: ListDiscoveryOptions): Promise<ListDiscoveryResult> {
    const limit = options?.limit ?? 50;
    const includeUnlisted = options?.includeUnlisted ?? false;
    let records = Array.from(this.discoveryRecords.values());

    if (!includeUnlisted) {
      records = records.filter(r => r.listed);
    }

    // Filter by creatorId (PRD §7)
    if (options?.creatorId) {
      records = records.filter(r => r.creatorId === options.creatorId);
    }

    // Filter by area (PRD §6)
    if (options?.area) {
      const area = options.area.trim();
      if (area.startsWith("bbox:")) {
        const parts = area.slice("bbox:".length).split(",").map(Number);
        if (parts.length === 4 && parts.every(n => !isNaN(n))) {
          const minLat = parts[0]!;
          const minLng = parts[1]!;
          const maxLat = parts[2]!;
          const maxLng = parts[3]!;
          records = records.filter(r => {
            if (!r.discoveryAnchor) return false;
            const { latitude, longitude } = r.discoveryAnchor;
            return latitude >= minLat && latitude <= maxLat && longitude >= minLng && longitude <= maxLng;
          });
        }
      } else if (area.startsWith("circle:") || area.startsWith("near:")) {
        const prefix = area.startsWith("circle:") ? "circle:" : "near:";
        const parts = area.slice(prefix.length).split(",").map(Number);
        if (parts.length === 3 && parts.every(n => !isNaN(n))) {
          const lat = parts[0]!;
          const lng = parts[1]!;
          const radiusKm = parts[2]!;
          records = records.filter(r => {
            if (!r.discoveryAnchor) return false;
            const dist = haversineDistanceKm(lat, lng, r.discoveryAnchor.latitude, r.discoveryAnchor.longitude);
            return dist <= radiusKm;
          });
        }
      } else if (area.includes(",")) {
        const parts = area.split(",").map(Number);
        if (parts.length === 4 && parts.every(n => !isNaN(n))) {
          const minLat = parts[0]!;
          const minLng = parts[1]!;
          const maxLat = parts[2]!;
          const maxLng = parts[3]!;
          records = records.filter(r => {
            if (!r.discoveryAnchor) return false;
            const { latitude, longitude } = r.discoveryAnchor;
            return latitude >= minLat && latitude <= maxLat && longitude >= minLng && longitude <= maxLng;
          });
        } else if (parts.length === 3 && parts.every(n => !isNaN(n))) {
          const lat = parts[0]!;
          const lng = parts[1]!;
          const radiusKm = parts[2]!;
          records = records.filter(r => {
            if (!r.discoveryAnchor) return false;
            const dist = haversineDistanceKm(lat, lng, r.discoveryAnchor.latitude, r.discoveryAnchor.longitude);
            return dist <= radiusKm;
          });
        }
      }
    }

    // Filter by text query (PRD §8)
    if (options?.query && options.query.trim().length > 0) {
      const q = options.query.toLowerCase().trim();
      records = records.filter(r => {
        return r.title.toLowerCase().includes(q) ||
          (r.shortDescription && r.shortDescription.toLowerCase().includes(q)) ||
          r.username.toLowerCase().includes(q) ||
          r.displayName.toLowerCase().includes(q) ||
          (r.placeLabel && r.placeLabel.toLowerCase().includes(q));
      });
    }

    // Sort by recently published descending (PRD §9)
    records.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

    let startIndex = 0;
    if (options?.cursor) {
      const idx = records.findIndex(r => r.trailId === options.cursor);
      if (idx >= 0) {
        startIndex = idx + 1;
      }
    }

    const items = records.slice(startIndex, startIndex + limit);
    const nextCursor =
      startIndex + limit < records.length ? items[items.length - 1]?.trailId : undefined;

    return { items, nextCursor };
  }

  async searchCreators(query?: string): Promise<CreatorRecord[]> {
    const counts = new Map<string, CreatorRecord>();

    // Seed from claimed creators
    for (const c of this.creators.values()) {
      counts.set(c.username.toLowerCase(), { ...c, trailCount: 0 });
    }

    // Aggregate from discovery records
    for (const r of this.discoveryRecords.values()) {
      if (!r.listed) continue;
      const key = r.username.toLowerCase();
      const existing = counts.get(key);
      if (existing) {
        existing.trailCount += 1;
      } else {
        counts.set(key, {
          creatorId: r.creatorId,
          username: r.username,
          displayName: r.displayName,
          publisherReference: r.publisherReference,
          trailCount: 1,
          ensDomain: r.username.includes(".") ? r.username : `${r.username}.trails.eth`,
        });
      }
    }

    let creators = Array.from(counts.values());
    if (query && query.trim().length > 0) {
      const q = query.toLowerCase().trim();
      creators = creators.filter(c =>
        c.username.toLowerCase().includes(q) ||
        c.displayName.toLowerCase().includes(q) ||
        (c.ensDomain && c.ensDomain.toLowerCase().includes(q))
      );
    }

    creators.sort((a, b) => b.trailCount - a.trailCount);
    return creators;
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

  async getDiscoveryRecord(trailId: string): Promise<DiscoveryRecord | null> {
    return this.fallback.getDiscoveryRecord(trailId);
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

  async listDiscoveryRecords(options?: ListDiscoveryOptions): Promise<ListDiscoveryResult> {
    return this.fallback.listDiscoveryRecords(options);
  }

  async searchCreators(query?: string): Promise<CreatorRecord[]> {
    return this.fallback.searchCreators(query);
  }

  async checkUsername(username: string): Promise<CheckUsernameResult> {
    return this.fallback.checkUsername(username);
  }

  async claimCreator(params: ClaimCreatorParams): Promise<CreatorRecord> {
    return this.fallback.claimCreator(params);
  }

  async getCreatorByUsername(username: string): Promise<CreatorRecord | null> {
    return this.fallback.getCreatorByUsername(username);
  }

  async getCreatorByAddress(address: string): Promise<CreatorRecord | null> {
    return this.fallback.getCreatorByAddress(address);
  }
}
