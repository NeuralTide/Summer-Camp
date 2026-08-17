import { RunCollector, spawnLines, whichBin } from "../process.js";
import { finishRun } from "./claude.js";
import type { DriverStatus, HarnessDriver, HarnessRunOptions, HarnessResult } from "../types.js";

/**
 * Gemini CLI driver. Emits plain text rather than a structured stream, so the
 * activity log shows prose only — no per-tool-call detail. MCP servers are read
 * from `.gemini/settings.json` in the working directory, which the registry writes.
 */
export class GeminiDriver implements HarnessDriver {
  readonly id = "gemini";
  readonly name = "Gemini CLI";
  readonly bin = "gemini";
  readonly install = "npm i -g @google/gemini-cli";
  readonly supportsMcp = true;

  async detect(): Promise<DriverStatus> {
    const path = await whichBin(this.bin);
    if (!path) {
      return { id: this.id, name: this.name, available: false, supportsMcp: true, install: this.install };
    }
    return {
      id: this.id,
      name: this.name,
      available: true,
      supportsMcp: true,
      install: this.install,
      path,
      detail: "MCP servers are read from .gemini/settings.json in the working directory.",
      // Neither CLI enumerates its models, and neither has an effort setting,
      // so both come back empty and the UI falls back to a plain text field.
      models: [],
      efforts: [],
    };
  }

  async run(options: HarnessRunOptions): Promise<HarnessResult> {
    const collector = new RunCollector(options.onEvent);
    const prompt = options.systemPrompt ? `${options.systemPrompt}\n\n---\n\n${options.prompt}` : options.prompt;
    const args = ["-p", prompt, "--yolo"];
    if (options.model) args.push("--model", options.model);

    collector.emit({ type: "start", driver: this.id, command: "gemini -p …" });

    const result = await spawnLines({
      command: this.bin,
      args,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onStdoutLine: (line) => collector.emit({ type: "text", text: `${line}\n` }),
      onStderrLine: (text) => collector.emit({ type: "stderr", text }),
    });

    return finishRun(collector, result);
  }
}

/**
 * Escape hatch for any other agent CLI.
 *
 * The user supplies a command template; `{prompt}` is replaced with the prompt and
 * `{mcp}` with the MCP config as inline JSON. Anything not matching a placeholder is
 * passed through as a literal argument. Nothing is run through a shell, so a stray
 * quote or semicolon in a prompt can't turn into a command.
 */
export class CustomDriver implements HarnessDriver {
  readonly id = "custom";
  readonly name = "Custom command";
  readonly bin = "";
  readonly install = "Set a command template in Settings.";
  readonly supportsMcp = true;

  constructor(private template: string) {}

  setTemplate(template: string): void {
    this.template = template;
  }

  async detect(): Promise<DriverStatus> {
    const parts = tokenize(this.template);
    const bin = parts[0];
    if (!bin) {
      return {
        id: this.id,
        name: this.name,
        available: false,
        supportsMcp: true,
        install: this.install,
        detail: "No command template configured.",
      };
    }
    const path = await whichBin(bin);
    return {
      id: this.id,
      name: this.name,
      available: Boolean(path),
      supportsMcp: true,
      install: this.install,
      ...(path ? { path } : {}),
      detail: path ? `Runs: ${this.template}` : `Command not found on PATH: ${bin}`,
    };
  }

  async run(options: HarnessRunOptions): Promise<HarnessResult> {
    const collector = new RunCollector(options.onEvent);
    const prompt = options.systemPrompt ? `${options.systemPrompt}\n\n---\n\n${options.prompt}` : options.prompt;
    const mcpJson = JSON.stringify({ mcpServers: options.mcpServers ?? {} });

    const tokens = tokenize(this.template);
    const bin = tokens[0];
    if (!bin) {
      collector.emit({ type: "error", message: "No custom command configured." });
      return collector.finish(null, "no command");
    }

    let usedStdin = true;
    const args = tokens.slice(1).map((token) => {
      if (token.includes("{prompt}")) {
        usedStdin = false;
        return token.replace("{prompt}", prompt);
      }
      return token.replace("{mcp}", mcpJson);
    });

    collector.emit({ type: "start", driver: this.id, command: this.template });

    const result = await spawnLines({
      command: bin,
      args,
      cwd: options.cwd,
      // If the template has no {prompt} placeholder, feed the prompt on stdin.
      ...(usedStdin ? { stdin: prompt } : {}),
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onStdoutLine: (line) => collector.emit({ type: "text", text: `${line}\n` }),
      onStderrLine: (text) => collector.emit({ type: "stderr", text }),
    });

    return finishRun(collector, result);
  }
}

/** Split a command template on whitespace, honouring single and double quotes. */
export function tokenize(template: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let has = false;

  for (const char of template.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      has = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (current || has) tokens.push(current);
      current = "";
      has = false;
      continue;
    }
    current += char;
  }
  if (current || has) tokens.push(current);
  return tokens;
}
