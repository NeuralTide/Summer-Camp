import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { HarnessEvent, HarnessResult } from "./types.js";

/** Resolve a binary on PATH without shelling out. */
export async function whichBin(bin: string): Promise<string | undefined> {
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of paths) {
    for (const ext of exts) {
      const candidate = join(dir, bin + ext);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return undefined;
}

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Written to the child's stdin, then closed. Avoids arg-length limits on long prompts. */
  stdin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStdoutLine: (line: string) => void;
  onStderrLine: (line: string) => void;
}

export interface SpawnResult {
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  error?: string;
}

/**
 * Run a child process, delivering stdout/stderr a line at a time. Agent CLIs emit
 * newline-delimited JSON, and a chunk boundary can land mid-line, so partial lines
 * are buffered until a newline arrives.
 */
export function spawnLines(options: SpawnOptions): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let settled = false;
    let timedOut = false;
    let aborted = false;
    let spawnError: string | undefined;

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      // Flush whatever is left in the line buffers.
      if (outBuf) options.onStdoutLine(outBuf);
      if (errBuf) options.onStderrLine(errBuf);
      resolve({ exitCode, timedOut, aborted, error: spawnError });
    };

    const kill = () => {
      child.kill("SIGTERM");
      // Escalate if the agent ignores SIGTERM (some CLIs trap it for cleanup).
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 3000).unref?.();
    };

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          kill();
        }, options.timeoutMs)
      : undefined;
    timer?.unref?.();

    const onAbort = () => {
      aborted = true;
      kill();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    let outBuf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      outBuf += chunk;
      let idx: number;
      while ((idx = outBuf.indexOf("\n")) >= 0) {
        const line = outBuf.slice(0, idx);
        outBuf = outBuf.slice(idx + 1);
        if (line.trim()) options.onStdoutLine(line);
      }
    });

    let errBuf = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      errBuf += chunk;
      let idx: number;
      while ((idx = errBuf.indexOf("\n")) >= 0) {
        const line = errBuf.slice(0, idx);
        errBuf = errBuf.slice(idx + 1);
        if (line.trim()) options.onStderrLine(line);
      }
    });

    child.on("error", (err) => {
      spawnError = err.message;
      finish(null);
    });
    child.on("close", (code) => finish(code));

    if (options.stdin !== undefined) {
      child.stdin.on("error", () => {
        /* the child may exit before reading stdin; not fatal */
      });
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }
  });
}

/** Collects events and assistant text so each driver doesn't repeat the bookkeeping. */
export class RunCollector {
  readonly events: HarnessEvent[] = [];
  private texts: string[] = [];
  private startedAt = Date.now();

  constructor(private readonly onEvent?: (event: HarnessEvent) => void) {}

  emit(event: HarnessEvent): void {
    this.events.push(event);
    if (event.type === "text" && event.text) this.texts.push(event.text);
    try {
      this.onEvent?.(event);
    } catch {
      // A misbehaving listener must not abort the run.
    }
  }

  get text(): string {
    return this.texts.join("");
  }

  finish(exitCode: number | null, failure?: string): HarnessResult {
    const ok = !failure && exitCode === 0;
    this.emit({ type: "done", ok, exitCode });
    return {
      ok,
      text: this.text,
      exitCode,
      events: this.events,
      durationMs: Date.now() - this.startedAt,
      ...(failure ? { error: failure } : {}),
    };
  }
}

export function safeJsonParse(line: string): unknown | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/** Trim a value to a short one-line summary for the activity log. */
export function summarizeValue(value: unknown, max = 140): string {
  let s: string;
  if (typeof value === "string") s = value;
  else {
    try {
      s = JSON.stringify(value) ?? String(value);
    } catch {
      s = String(value);
    }
  }
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
