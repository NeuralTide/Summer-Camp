#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Store, defaultDataDir } from "@metaharness/core";
import { createApp } from "./app.js";

const DEFAULT_PORT = Number(process.env.METAHARNESS_PORT ?? 5273);
const HOST = process.env.METAHARNESS_HOST ?? "127.0.0.1";

function parseArgs(argv: string[]): { port: number; open: boolean; dir?: string } {
  const args = { port: DEFAULT_PORT, open: true as boolean, dir: undefined as string | undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" || arg === "-p") args.port = Number(argv[++i]);
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--no-open") args.open = false;
    else if (arg === "--help" || arg === "-h") {
      console.log(`metaharness — Duolingo for everything

Usage: metaharness [options]

Options:
  -p, --port <n>   Port to listen on (default ${DEFAULT_PORT})
      --dir <path> Data directory (default ${defaultDataDir()})
      --no-open    Do not open a browser
  -h, --help       Show this help
`);
      process.exit(0);
    }
  }
  return args;
}

async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(command, [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // Opening a browser is a convenience, never a failure condition.
  }
}

const args = parseArgs(process.argv.slice(2));
const store = new Store(args.dir);
await store.init();

const uiRoot = fileURLToPath(new URL("../../ui/dist", import.meta.url));
const app = createApp({
  store,
  port: args.port,
  host: HOST,
  ...(existsSync(uiRoot) ? { uiRoot } : {}),
});

const { url } = await app.listen();

console.log(`\n  Metaharness running at ${url}`);
console.log(`  Data directory: ${store.dir}`);
if (!existsSync(uiRoot)) {
  console.log(`\n  UI not built yet — run: npm run build -w @metaharness/ui`);
}
console.log("");

if (args.open && existsSync(uiRoot)) await openBrowser(url);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
