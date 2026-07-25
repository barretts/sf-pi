/* SPDX-License-Identifier: Apache-2.0 */
/** Narrow, secret-safe adapter for the loopback tldraw offline Canvas API. */
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  RuntimeCapabilities,
  RuntimeScreenshot,
  TldrawDocumentSummary,
  TldrawRuntimeStatus,
  TldrawServerConfig,
} from "./types.ts";
import { sanitizeRuntimeText } from "./redaction.ts";

export type TldrawRuntimeErrorCode =
  | "not_running"
  | "stale_config"
  | "auth_error"
  | "not_found"
  | "no_open_document"
  | "unsupported"
  | "timeout"
  | "execution_failed"
  | "invalid_response";

export class TldrawRuntimeError extends Error {
  constructor(
    readonly code: TldrawRuntimeErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TldrawRuntimeError";
  }
}

interface ClientOptions {
  fetchImpl?: typeof fetch;
  serverConfigPath?: string;
  timeoutMs?: number;
}

interface ApiEnvelope<T> {
  success?: boolean;
  result?: T;
  error?: string;
}

const LEGACY_CAPABILITIES: RuntimeCapabilities = {
  apiContract: "canvas-api-v1",
  capabilityEndpoint: false,
  nativeDocumentCreation: false,
  documents: true,
  search: true,
  execute: true,
  screenshot: true,
  scriptWorkspace: true,
  scriptStatus: true,
};

export function defaultTldrawServerConfigPath(): string {
  if (process.env.TLDRAW_SERVER_CONFIG) return path.resolve(process.env.TLDRAW_SERVER_CONFIG);
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "tldraw", "server.json");
  if (process.platform === "win32")
    return path.join(process.env.APPDATA ?? os.homedir(), "tldraw", "server.json");
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
    "tldraw",
    "server.json",
  );
}

export function hasTldrawServerConfig(filePath = defaultTldrawServerConfigPath()): boolean {
  return existsSync(filePath);
}

export class TldrawRuntimeClient {
  private readonly fetchImpl: typeof fetch;
  private readonly serverConfigPath: string;
  private readonly timeoutMs: number;

  constructor(options: ClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.serverConfigPath = options.serverConfigPath ?? defaultTldrawServerConfigPath();
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  readServerConfig(): TldrawServerConfig {
    if (!existsSync(this.serverConfigPath)) {
      throw new TldrawRuntimeError(
        "not_running",
        "tldraw offline is not running. Open the desktop app and a canvas first.",
      );
    }
    try {
      const parsed = JSON.parse(
        readFileSync(this.serverConfigPath, "utf8"),
      ) as Partial<TldrawServerConfig>;
      if (
        !Number.isInteger(parsed.port) ||
        Number(parsed.port) < 1 ||
        Number(parsed.port) > 65535 ||
        typeof parsed.token !== "string" ||
        !parsed.token
      ) {
        throw new Error("missing port or token");
      }
      return parsed as TldrawServerConfig;
    } catch (error) {
      if (error instanceof TldrawRuntimeError) throw error;
      throw new TldrawRuntimeError(
        "stale_config",
        "The tldraw server configuration is invalid or stale. Restart tldraw offline.",
      );
    }
  }

  async status(signal?: AbortSignal): Promise<TldrawRuntimeStatus> {
    let config: TldrawServerConfig;
    try {
      config = this.readServerConfig();
    } catch (error) {
      if (error instanceof TldrawRuntimeError)
        return {
          kind: error.code === "not_running" ? "not-running" : "stale-config",
          message: error.message,
        };
      throw error;
    }

    try {
      const capabilities = await this.capabilities(signal);
      const documents = await this.documents(signal);
      const focused = documents.find((document) => document.focusOrder === 0) ?? documents[0];
      return {
        kind: documents.length > 0 ? "ready" : "no-open-document",
        port: config.port,
        openDocuments: documents.length,
        focusedDocumentName: focused?.name,
        capabilities,
        message:
          documents.length > 0
            ? capabilities.nativeDocumentCreation
              ? "Canvas API ready."
              : "Canvas API ready for open documents; native document creation is unavailable."
            : "Canvas API is reachable, but no document is open.",
      };
    } catch (error) {
      if (error instanceof TldrawRuntimeError) {
        const kind =
          error.code === "auth_error"
            ? "auth-error"
            : error.code === "unsupported"
              ? "incompatible"
              : "stale-config";
        return { kind, port: config.port, message: error.message };
      }
      throw error;
    }
  }

  async capabilities(signal?: AbortSignal): Promise<RuntimeCapabilities> {
    try {
      const response = await this.request<Record<string, unknown>>(
        "GET",
        "/api/capabilities",
        undefined,
        signal,
        false,
      );
      return {
        apiContract: "unknown",
        capabilityEndpoint: true,
        nativeDocumentCreation:
          response.nativeDocumentCreation === true || response.createDocument === true,
        documents: response.documents === true,
        search: response.search === true,
        execute: response.execute === true,
        screenshot: response.screenshot === true,
        scriptWorkspace: response.scriptWorkspace === true,
        scriptStatus: response.scriptStatus === true,
      };
    } catch (error) {
      if (error instanceof TldrawRuntimeError && error.code === "not_found")
        return { ...LEGACY_CAPABILITIES };
      throw error;
    }
  }

  async documents(signal?: AbortSignal): Promise<TldrawDocumentSummary[]> {
    return this.searchCode<TldrawDocumentSummary[]>(
      "const docs=await api.getDocs(); return docs.map((doc,index)=>({id:doc.id,name:doc.name,shapeCount:doc.shapeCount,pageName:doc.pageName,focusOrder:doc.focusOrder ?? index}))",
      signal,
    );
  }

  async resolveDocument(
    documentId: string | undefined,
    signal?: AbortSignal,
  ): Promise<TldrawDocumentSummary> {
    const documents = await this.documents(signal);
    if (documentId) {
      const exact = documents.find((document) => document.id === documentId);
      if (!exact)
        throw new TldrawRuntimeError(
          "not_found",
          `Open tldraw document '${safeLabel(documentId)}' was not found.`,
        );
      return exact;
    }
    const focused = documents.find((document) => document.focusOrder === 0) ?? documents[0];
    if (!focused)
      throw new TldrawRuntimeError(
        "no_open_document",
        "No tldraw document is open. Open or create a board in tldraw offline, then retry.",
      );
    return focused;
  }

  async search(query: string, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const encoded = JSON.stringify(needle);
    const code = [
      `const needle=${encoded};`,
      "const docs=await api.getDocs();",
      "const matches=[];",
      "for(const doc of docs){",
      " const docText=JSON.stringify({name:doc.name,pageName:doc.pageName}).toLowerCase();",
      " if(docText.includes(needle)) matches.push({kind:'document',documentId:doc.id,name:doc.name,pageName:doc.pageName});",
      " const page=await api.getShapes(doc.id);",
      " for(const shape of page?.shapes ?? []){const text=JSON.stringify(shape.props ?? {}).toLowerCase(); if(text.includes(needle)) matches.push({kind:'shape',documentId:doc.id,shapeId:shape.id,shapeType:shape.type});}",
      "}",
      "return matches.slice(0,100)",
    ].join("");
    return this.searchCode<Array<Record<string, unknown>>>(code, signal);
  }

  async execute<T>(documentId: string, script: string, signal?: AbortSignal): Promise<T> {
    if (!script.trim()) throw new TldrawRuntimeError("execution_failed", "Canvas script is empty.");
    return this.request<T>(
      "POST",
      `/api/doc/${documentPathId(documentId)}/exec`,
      script,
      signal,
      true,
    );
  }

  async screenshot(
    documentId: string,
    options: {
      size?: "small" | "medium" | "large" | "full";
      mode?: "canvas" | "window";
      bounds?: { x: number; y: number; w: number; h: number };
    } = {},
    signal?: AbortSignal,
  ): Promise<RuntimeScreenshot> {
    const code = `return await api.getScreenshot(${JSON.stringify(documentId)},${JSON.stringify(options)})`;
    const screenshot = await this.searchCode<RuntimeScreenshot>(code, signal);
    return validateRuntimeScreenshot(screenshot);
  }

  async scriptWorkspace(
    documentId: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "POST",
      `/api/doc/${documentPathId(documentId)}/script-workspace`,
      "return true",
      signal,
      true,
    );
  }

  async scriptStatus(documentId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/api/doc/${documentPathId(documentId)}/script-status`,
      undefined,
      signal,
      true,
    );
  }

  async createDocument(): Promise<never> {
    const capabilities = await this.capabilities();
    if (!capabilities.nativeDocumentCreation) {
      throw new TldrawRuntimeError(
        "unsupported",
        "This tldraw runtime does not expose native document creation. Open a blank board manually; OS automation and direct .tldraw generation are intentionally not used.",
      );
    }
    throw new TldrawRuntimeError(
      "unsupported",
      "Native document creation was advertised but this sf-tldraw build does not recognize the operation contract. Upgrade sf-tldraw before using it.",
    );
  }

  private async searchCode<T>(code: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>(
      "POST",
      "/api/search",
      JSON.stringify({ code }),
      signal,
      true,
      "application/json",
    );
  }

  private async request<T>(
    method: "GET" | "POST",
    pathname: string,
    body: string | undefined,
    signal: AbortSignal | undefined,
    unwrapEnvelope: boolean,
    contentType = "text/plain",
  ): Promise<T> {
    const config = this.readServerConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), this.timeoutMs);
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await this.fetchImpl(`http://127.0.0.1:${config.port}${pathname}`, {
        method,
        headers: {
          authorization: `Bearer ${config.token}`,
          ...(body !== undefined ? { "content-type": contentType } : {}),
        },
        body,
        signal: controller.signal,
      });
      const text = await response.text();
      const parsed = parseJson(text);
      if (!response.ok) {
        const message = safeRuntimeMessage(parsed, response.status);
        if (response.status === 401 || response.status === 403)
          throw new TldrawRuntimeError("auth_error", message, response.status);
        if (response.status === 404)
          throw new TldrawRuntimeError("not_found", message, response.status);
        throw new TldrawRuntimeError("execution_failed", message, response.status);
      }
      if (!unwrapEnvelope) return parsed as T;
      const envelope = parsed as ApiEnvelope<T>;
      if (envelope.success === false)
        throw new TldrawRuntimeError(
          "execution_failed",
          safeRuntimeMessage(envelope, response.status),
          response.status,
        );
      if (!("result" in envelope))
        throw new TldrawRuntimeError(
          "invalid_response",
          "tldraw returned a response without a result.",
          response.status,
        );
      return envelope.result as T;
    } catch (error) {
      if (error instanceof TldrawRuntimeError) throw error;
      if (controller.signal.aborted)
        throw new TldrawRuntimeError("timeout", "tldraw Canvas API request timed out.");
      throw new TldrawRuntimeError(
        "stale_config",
        "Could not reach the tldraw Canvas API. Restart tldraw offline and retry.",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function safeRuntimeMessage(payload: unknown, status: number): string {
  const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const raw =
    typeof value.error === "string" ? value.error : `tldraw Canvas API returned HTTP ${status}.`;
  return sanitizeRuntimeText(raw).slice(0, 500);
}

export function validateRuntimeScreenshot(value: unknown): RuntimeScreenshot {
  if (!value || typeof value !== "object") {
    throw new TldrawRuntimeError(
      "invalid_response",
      "tldraw returned invalid screenshot metadata.",
    );
  }
  const screenshot = value as Partial<RuntimeScreenshot>;
  if (
    typeof screenshot.filePath !== "string" ||
    typeof screenshot.width !== "number" ||
    typeof screenshot.height !== "number" ||
    typeof screenshot.pageName !== "string" ||
    (screenshot.captureMode !== "canvas" && screenshot.captureMode !== "window")
  ) {
    throw new TldrawRuntimeError(
      "invalid_response",
      "tldraw returned incomplete screenshot metadata.",
    );
  }
  let source: string;
  try {
    const metadata = lstatSync(screenshot.filePath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("not a regular file");
    source = realpathSync(screenshot.filePath);
    const allowedRoot = realpathSync(path.join(os.tmpdir(), "tldraw-canvas-api"));
    if (source !== allowedRoot && !source.startsWith(`${allowedRoot}${path.sep}`)) {
      throw new Error("outside capture directory");
    }
    const size = statSync(source).size;
    if (size < 4 || size > 50_000_000) throw new Error("invalid size");
    const header = Buffer.alloc(8);
    const descriptor = openSync(source, "r");
    try {
      readSync(descriptor, header, 0, header.length, 0);
    } finally {
      closeSync(descriptor);
    }
    const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const png = header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!jpeg && !png) throw new Error("unsupported image type");
  } catch {
    throw new TldrawRuntimeError(
      "invalid_response",
      "tldraw screenshot evidence failed local file validation.",
    );
  }
  return { ...(screenshot as RuntimeScreenshot), filePath: source };
}

function safeLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9:._-]/g, "").slice(0, 120);
}

function documentPathId(value: string): string {
  const safe = safeLabel(value);
  if (!safe || safe !== value || value.includes("/")) {
    throw new TldrawRuntimeError("not_found", "Invalid tldraw document id.");
  }
  // The desktop router matches the opaque id literally; percent-encoding the
  // colons changes the lookup key and produces a false Document-not-found.
  return safe;
}

export { LEGACY_CAPABILITIES };
