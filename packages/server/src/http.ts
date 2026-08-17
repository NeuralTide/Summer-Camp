import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

export type Handler = (ctx: RequestContext) => Promise<unknown> | unknown;

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  url: URL;
}

/** Thrown by handlers to produce a specific status code. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

/**
 * A minimal path router. The API surface is small and entirely local, so a full
 * framework would be more dependency than the routing is worth.
 */
export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, segments: pattern.split("/").filter(Boolean), handler });
  }

  get(pattern: string, handler: Handler): void {
    this.add("GET", pattern, handler);
  }
  post(pattern: string, handler: Handler): void {
    this.add("POST", pattern, handler);
  }
  patch(pattern: string, handler: Handler): void {
    this.add("PATCH", pattern, handler);
  }
  delete(pattern: string, handler: Handler): void {
    this.add("DELETE", pattern, handler);
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | undefined {
    const parts = pathname.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i]!;
        const part = parts[i]!;
        if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(part);
        else if (seg !== part) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return undefined;
  }
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // A lesson with a dozen exercises is large; a 8MB ceiling is generous but bounded.
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
}

export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const payload = JSON.stringify(value ?? null);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

/**
 * Serve the built UI, falling back to index.html so client-side routes deep-link.
 * Paths are resolved and checked against the root to reject traversal attempts.
 */
export async function serveStatic(root: string, pathname: string, res: ServerResponse): Promise<boolean> {
  const rootResolved = resolve(root);
  const requested = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let filePath = resolve(join(rootResolved, requested));

  if (filePath !== rootResolved && !filePath.startsWith(rootResolved + sep)) return false;

  let info = await stat(filePath).catch(() => undefined);
  if (info?.isDirectory()) {
    filePath = join(filePath, "index.html");
    info = await stat(filePath).catch(() => undefined);
  }
  if (!info?.isFile()) {
    // SPA fallback: unknown non-asset paths render the app shell.
    if (extname(requested)) return false;
    filePath = join(rootResolved, "index.html");
    info = await stat(filePath).catch(() => undefined);
    if (!info?.isFile()) return false;
  }

  const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const immutable = filePath.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    "content-type": type,
    "content-length": info.size,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(filePath).pipe(res);
  return true;
}
