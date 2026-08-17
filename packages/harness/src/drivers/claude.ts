import { RunCollector, safeJsonParse, spawnLines, summarizeValue, whichBin } from "../process.js";
import type { DriverStatus, HarnessDriver, HarnessRunOptions, HarnessResult } from "../types.js";

/**
 * Claude Code driver.
 *
 * Runs headless with `-p --output-format stream-json`, which emits one JSON object
 * per line describing every assistant message and tool call — exactly the feed the
 * build screen renders live.
 *
 * The prompt goes in over stdin rather than as an argv entry: course-authoring
 * prompts embed a full lesson plan and comfortably exceed ARG_MAX on some systems.
 */
export class ClaudeDriver implements HarnessDriver {
  readonly id = "claude";
  readonly name = "Claude Code";
  readonly bin = "claude";
  readonly install = "npm i -g @anthropic-ai/claude-code";
  readonly supportsMcp = true;

  async detect(): Promise<DriverStatus> {
    const path = await whichBin(this.bin);
    if (!path) {
      return { id: this.id, name: this.name, available: false, supportsMcp: true, install: this.install };
    }
    const version = await readVersion(path);
    const help = await readHelp(path);
    return {
      id: this.id,
      name: this.name,
      available: true,
      supportsMcp: true,
      install: this.install,
      path,
      ...(version ? { version } : {}),
      models: claudeModels(help),
      // Claude Code documents --effort in its help but not the values it takes;
      // the binary only names them when it rejects one, and finding that out
      // costs a real request. Declared here, gated on the flag actually being
      // present, so an older install that predates --effort offers nothing
      // rather than offering something that will be ignored.
      efforts: /--effort\b/.test(help) ? ["low", "medium", "high", "xhigh", "max"] : [],
    };
  }

  async run(options: HarnessRunOptions): Promise<HarnessResult> {
    const collector = new RunCollector(options.onEvent);
    const args = ["-p", "--output-format", "stream-json", "--verbose"];

    if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
      args.push("--mcp-config", JSON.stringify({ mcpServers: options.mcpServers }));
      // Ignore the user's globally configured MCP servers: authoring should not
      // depend on, or be slowed down by, whatever else they have installed.
      args.push("--strict-mcp-config");
    }
    if (options.allowedTools?.length) {
      args.push("--allowedTools", options.allowedTools.join(","));
    }
    if (options.systemPrompt) {
      args.push("--append-system-prompt", options.systemPrompt);
    }
    if (options.model) {
      args.push("--model", options.model);
    }
    if (options.effort) {
      args.push("--effort", options.effort);
    }

    collector.emit({ type: "start", driver: this.id, command: `claude ${args.join(" ")}` });

    const result = await spawnLines({
      command: this.bin,
      args,
      cwd: options.cwd,
      stdin: options.prompt,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onStdoutLine: (line) => this.handleLine(line, collector),
      onStderrLine: (text) => collector.emit({ type: "stderr", text }),
    });

    return finishRun(collector, result);
  }

  private handleLine(line: string, collector: RunCollector): void {
    const event = safeJsonParse(line) as Record<string, any> | undefined;
    if (!event) return;

    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content as any[]) {
        if (block.type === "text" && block.text) {
          collector.emit({ type: "text", text: block.text });
        } else if (block.type === "thinking" && block.thinking) {
          collector.emit({ type: "reasoning", text: block.thinking });
        } else if (block.type === "tool_use") {
          collector.emit({ type: "tool", name: block.name, input: block.input });
        }
      }
      return;
    }

    if (event.type === "user" && event.message?.content) {
      for (const block of event.message.content as any[]) {
        if (block.type === "tool_result") {
          collector.emit({
            type: "tool_result",
            name: block.name ?? "tool",
            ok: !block.is_error,
            summary: summarizeValue(block.content),
          });
        }
      }
      return;
    }

    if (event.type === "result") {
      if (typeof event.total_cost_usd === "number" || event.usage) {
        collector.emit({
          type: "usage",
          inputTokens: event.usage?.input_tokens,
          outputTokens: event.usage?.output_tokens,
          costUsd: event.total_cost_usd,
        });
      }
      // `result` carries the final answer; capture it when nothing streamed.
      if (event.subtype !== "success" && event.is_error) {
        collector.emit({ type: "error", message: summarizeValue(event.result ?? "run failed", 400) });
      } else if (typeof event.result === "string" && !collector.text) {
        collector.emit({ type: "text", text: event.result });
      }
    }
  }
}

export async function readVersion(path: string): Promise<string | undefined> {
  let out = "";
  const res = await spawnLines({
    command: path,
    args: ["--version"],
    timeoutMs: 15000,
    onStdoutLine: (line) => {
      out += `${line} `;
    },
    onStderrLine: () => {},
  });
  if (res.exitCode !== 0) return undefined;
  return out.trim().split("\n")[0]?.trim() || undefined;
}

export function finishRun(
  collector: RunCollector,
  result: { exitCode: number | null; timedOut: boolean; aborted: boolean; error?: string },
): HarnessResult {
  if (result.aborted) return collector.finish(result.exitCode, "cancelled");
  if (result.timedOut) return collector.finish(result.exitCode, "timed out");
  if (result.error) {
    collector.emit({ type: "error", message: result.error });
    return collector.finish(result.exitCode, result.error);
  }
  if (result.exitCode !== 0) {
    return collector.finish(result.exitCode, `exited with code ${result.exitCode}`);
  }
  return collector.finish(result.exitCode);
}

/** `--help` text, or "" if the binary won't produce any. */
async function readHelp(path: string): Promise<string> {
  let out = "";
  const res = await spawnLines({
    command: path,
    args: ["--help"],
    timeoutMs: 15000,
    onStdoutLine: (line) => {
      out += `${line}\n`;
    },
    onStderrLine: () => {},
  });
  return res.exitCode === 0 ? out : "";
}

/**
 * The tier aliases Claude Code accepts, smallest first.
 *
 * Needed because `--help` gives *examples*, not an enumeration: the --model
 * paragraph reads "e.g. 'fable', 'opus', or 'sonnet'", and `haiku` appears
 * nowhere in the help text despite being perfectly valid. Parsing alone
 * therefore under-reports, and a picker built from it silently loses a model.
 *
 * These fill that gap without overriding detection — anything the binary does
 * name still comes through, and the free-text field beside the picker is what
 * covers whatever neither source knows about.
 */
const CLAUDE_TIERS = ["haiku", "sonnet", "opus", "fable"];

/** Detected names, with any missing tier alias folded in and tiers ordered. */
export function claudeModels(help: string): string[] {
  const found = parseModelAliases(help);
  // Full names (claude-opus-5 and friends) keep whatever order help gave them
  // and sit after the aliases, which are what anyone actually picks.
  const rest = found.filter((m) => !CLAUDE_TIERS.includes(m));
  return [...CLAUDE_TIERS, ...rest];
}

/**
 * Model names out of Claude Code's own `--help`.
 *
 * The --model entry reads "Provide an alias for the latest model (e.g. 'fable',
 * 'opus', or 'sonnet') or a model's full name (e.g. 'claude-fable-5')", so the
 * quoted run inside that paragraph is the installed binary's own answer to what
 * it accepts — which is the point of reading it rather than hardcoding a list
 * that ages out with every release.
 *
 * Returns [] when the shape changes, and callers treat that as "no list", not
 * as "no models": the field is advisory and a typed-in name still works.
 */
export function parseModelAliases(help: string): string[] {
  const start = help.indexOf("--model");
  if (start < 0) return [];
  // Up to the next option, so quotes from unrelated flags can't leak in.
  const block = help.slice(start, start + 600).split(/\n\s{2,}-/)[0] ?? "";
  const quoted = block.match(/'([a-z0-9][a-z0-9.\-]{1,40})'/gi) ?? [];
  const seen = new Set<string>();
  for (const q of quoted) {
    const name = q.slice(1, -1).toLowerCase();
    seen.add(name);
  }
  return [...seen];
}
