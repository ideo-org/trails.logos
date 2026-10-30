import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import {
  type IRegistryAdapter,
  MockRegistryAdapter,
} from "@trails-logos/registry";
import {
  type IStorageAdapter,
  MockStorageAdapter,
} from "@trails-logos/storage";
import {
  type PublicationReceipt,
  validateTrailPackage,
  unpackTrailPackage,
} from "@trails-logos/core";

export interface ServerConfig {
  port?: number;
  host?: string;
  storage: IStorageAdapter;
  registry: IRegistryAdapter;
}

export class TrailsServer {
  private server: http.Server;
  private config: ServerConfig;
  private operationReceipts: Map<string, PublicationReceipt> = new Map();

  constructor(config: ServerConfig) {
    this.config = {
      port: config.port ?? 3000,
      host: config.host ?? "0.0.0.0",
      storage: config.storage,
      registry: config.registry,
    };
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  getHttpServer(): http.Server {
    return this.server;
  }

  async start(): Promise<{ port: number; host: string }> {
    await this.config.registry.init();
    return new Promise((resolve) => {
      this.server.listen(this.config.port, this.config.host, () => {
        const addr = this.server.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : (this.config.port ?? 3000);
        resolve({ port: actualPort, host: this.config.host ?? "0.0.0.0" });
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
    const payload = JSON.stringify(data);
    res.writeHead(statusCode, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Publisher-Account, X-Operation-Id",
    });
    res.end(payload);
  }

  private sendError(res: http.ServerResponse, statusCode: number, message: string): void {
    this.sendJson(res, statusCode, { error: message, statusCode });
  }

  private async collectBody(req: http.IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
      const pathname = url.pathname;
      const method = req.method?.toUpperCase() || "GET";

      if (method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Publisher-Account, X-Operation-Id",
        });
        res.end();
        return;
      }

      // GET /health
      if (method === "GET" && (pathname === "/health" || pathname === "/status")) {
        this.sendJson(res, 200, {
          status: "ok",
          version: "0.1.0",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // GET /publications/:operationId
      if (method === "GET" && pathname.startsWith("/publications/")) {
        const opId = pathname.slice("/publications/".length);
        const receipt = this.operationReceipts.get(opId);
        if (!receipt) {
          this.sendError(res, 404, `Operation ${opId} not found`);
          return;
        }
        this.sendJson(res, 200, receipt);
        return;
      }

      // POST /publications
      if (method === "POST" && pathname === "/publications") {
        await this.handlePublishTrail(req, res);
        return;
      }

      // GET /discovery (PRD v0.4.0 §18)
      if (method === "GET" && pathname === "/discovery") {
        const area = url.searchParams.get("area") || undefined;
        const creatorId = url.searchParams.get("creatorId") || undefined;
        const query = url.searchParams.get("query") || undefined;
        const cursor = url.searchParams.get("cursor") || undefined;
        const limitStr = url.searchParams.get("limit");
        const limit = limitStr ? parseInt(limitStr, 10) : 50;
        const includeUnlisted = url.searchParams.get("includeUnlisted") === "true";

        const result = await this.config.registry.listDiscoveryRecords({
          area,
          creatorId,
          query,
          cursor,
          limit,
          includeUnlisted,
        });
        this.sendJson(res, 200, result);
        return;
      }

      // GET /discovery/:id
      if (method === "GET" && pathname.startsWith("/discovery/")) {
        const discId = pathname.slice("/discovery/".length);
        const record = await this.config.registry.getDiscoveryRecord(discId);
        if (!record) {
          this.sendError(res, 404, `Discovery record ${discId} not found`);
          return;
        }
        this.sendJson(res, 200, record);
        return;
      }

      // GET /creators (PRD v0.4.0 §7 & §18)
      if (method === "GET" && pathname === "/creators") {
        const query = url.searchParams.get("query") || undefined;
        const creators = await this.config.registry.searchCreators(query);
        this.sendJson(res, 200, { items: creators });
        return;
      }

      // GET /trails
      if (method === "GET" && pathname === "/trails") {
        const cursor = url.searchParams.get("cursor") || undefined;
        const limitStr = url.searchParams.get("limit");
        const limit = limitStr ? parseInt(limitStr, 10) : 50;
        const includeUnlisted = url.searchParams.get("includeUnlisted") === "true";

        const result = await this.config.registry.listTrails({
          cursor,
          limit,
          includeUnlisted,
        });
        this.sendJson(res, 200, result);
        return;
      }

      // Routes matching /trails/:id/...
      if (pathname.startsWith("/trails/")) {
        const parts = pathname.slice("/trails/".length).split("/").filter(Boolean);
        const trailId = parts[0];
        if (!trailId) {
          this.sendError(res, 400, "Missing trail ID");
          return;
        }

        // GET /trails/:id
        if (parts.length === 1 && method === "GET") {
          const trail = await this.config.registry.getTrail(trailId);
          if (!trail) {
            this.sendError(res, 404, `Trail ${trailId} not found`);
            return;
          }
          this.sendJson(res, 200, trail);
          return;
        }

        // GET /trails/:id/revisions
        if (parts.length === 2 && parts[1] === "revisions" && method === "GET") {
          const revisions = await this.config.registry.listRevisions(trailId);
          this.sendJson(res, 200, { trailId, revisions });
          return;
        }

        // GET /trails/:id/revisions/:revision
        if (parts.length === 3 && parts[1] === "revisions" && method === "GET") {
          const revPart = parts[2] || "";
          const revNum = parseInt(revPart, 10);
          if (isNaN(revNum)) {
            this.sendError(res, 400, "Invalid revision number");
            return;
          }
          const revision = await this.config.registry.getRevision(trailId, revNum);
          if (!revision) {
            this.sendError(res, 404, `Revision ${revNum} for trail ${trailId} not found`);
            return;
          }
          this.sendJson(res, 200, revision);
          return;
        }

        // GET /trails/:id/download
        if (parts.length === 2 && parts[1] === "download" && method === "GET") {
          const revQuery = url.searchParams.get("revision");
          const revNum = revQuery ? parseInt(revQuery, 10) : undefined;
          const revision = await this.config.registry.getRevision(trailId, revNum);
          if (!revision) {
            this.sendError(res, 404, `Revision not found for trail ${trailId}`);
            return;
          }

          const fileBuffer = await this.config.storage.downloadPackage(revision.packageCid);
          res.writeHead(200, {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="trail-${trailId}-rev${revision.revision}.zip"`,
            "ETag": `"${revision.packageCid}"`,
            "Content-Length": fileBuffer.length,
            "Access-Control-Allow-Origin": "*",
          });
          res.end(fileBuffer);
          return;
        }

        // POST /trails/:id/revisions
        if (parts.length === 2 && parts[1] === "revisions" && method === "POST") {
          await this.handlePublishRevision(trailId, req, res);
          return;
        }

        // POST /trails/:id/listing
        if (parts.length === 2 && parts[1] === "listing" && method === "POST") {
          const bodyBuf = await this.collectBody(req);
          const body = JSON.parse(bodyBuf.toString("utf-8")) as { listed: boolean };
          const publisher = (req.headers["x-publisher-account"] as string) || "0x0000000000000000000000000000000000000001";
          const updated = await this.config.registry.setListed(trailId, !!body.listed, publisher);
          this.sendJson(res, 200, updated);
          return;
        }
      }

      this.sendError(res, 404, `Not found: ${method} ${pathname}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.sendError(res, 500, msg);
    }
  }

  private async handlePublishTrail(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const publisher = (req.headers["x-publisher-account"] as string) || "0x0000000000000000000000000000000000000001";
    const operationId = (req.headers["x-operation-id"] as string) || crypto.randomUUID();

    // Check idempotency
    const existing = this.operationReceipts.get(operationId);
    if (existing) {
      this.sendJson(res, 200, existing);
      return;
    }

    const packageBuffer = await this.collectBody(req);
    if (packageBuffer.length === 0) {
      this.sendError(res, 400, "Empty payload; zip package expected");
      return;
    }

    // Unpack to temporary directory for validation
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "trails-publish-"));
    try {
      await unpackTrailPackage(packageBuffer, tempDir);
      const validation = validateTrailPackage(tempDir);
      if (!validation.valid || !validation.manifest) {
        const issuesMsg = validation.issues.map((i) => `[${i.code}] ${i.message}`).join("; ");
        this.sendError(res, 400, `Package validation failed: ${issuesMsg}`);
        return;
      }

      const manifest = validation.manifest;

      // Upload to storage
      const storageResult = await this.config.storage.uploadPackage(packageBuffer);

      // Register on LEZ
      const { receipt } = await this.config.registry.registerTrail({
        manifest,
        packageCid: storageResult.cid,
        packageSizeBytes: storageResult.byteLength,
        publisherAccount: publisher,
        operationId,
      });

      this.operationReceipts.set(operationId, receipt);
      this.sendJson(res, 201, receipt);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async handlePublishRevision(
    trailId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const publisher = (req.headers["x-publisher-account"] as string) || "0x0000000000000000000000000000000000000001";
    const operationId = (req.headers["x-operation-id"] as string) || crypto.randomUUID();

    const existing = this.operationReceipts.get(operationId);
    if (existing) {
      this.sendJson(res, 200, existing);
      return;
    }

    const packageBuffer = await this.collectBody(req);
    if (packageBuffer.length === 0) {
      this.sendError(res, 400, "Empty payload; zip package expected");
      return;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "trails-rev-"));
    try {
      await unpackTrailPackage(packageBuffer, tempDir);
      const validation = validateTrailPackage(tempDir);
      if (!validation.valid || !validation.manifest) {
        const issuesMsg = validation.issues.map((i) => `[${i.code}] ${i.message}`).join("; ");
        this.sendError(res, 400, `Package validation failed: ${issuesMsg}`);
        return;
      }

      const manifest = validation.manifest;
      if (manifest.trailId !== trailId) {
        this.sendError(
          res,
          400,
          `Manifest trailId ${manifest.trailId} does not match route trailId ${trailId}`
        );
        return;
      }

      const storageResult = await this.config.storage.uploadPackage(packageBuffer);

      const { receipt } = await this.config.registry.publishRevision({
        trailId,
        manifest,
        packageCid: storageResult.cid,
        packageSizeBytes: storageResult.byteLength,
        publisherAccount: publisher,
        operationId,
      });

      this.operationReceipts.set(operationId, receipt);
      this.sendJson(res, 201, receipt);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export function createTrailsServer(options?: {
  port?: number;
  host?: string;
  storage?: IStorageAdapter;
  registry?: IRegistryAdapter;
}): TrailsServer {
  const storage = options?.storage ?? new MockStorageAdapter();
  const registry = options?.registry ?? new MockRegistryAdapter();
  return new TrailsServer({
    port: options?.port ?? 3000,
    host: options?.host ?? "0.0.0.0",
    storage,
    registry,
  });
}
