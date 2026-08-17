import { RunCollector, safeJsonParse, spawnLines, summarizeValue, whichBin } from "../process.js";
import { finishRun, readVersion } from "./claude.js";
import type { DriverStatus, HarnessDriver, HarnessRunOptions, HarnessResult } from "../types.js";

/**
 * OpenAI Codex driver, covering both generations of the CLI:
 *
 *  - Modern (Rust) `codex exec --json`: streams JSONL and accepts MCP servers via
 *    `-c mcp_servers.<name>.…` config overrides. Full authoring support.
 *  - Legacy (npm) `codex -q`: non-interactive plain text, no MCP. Detected and
 *    reported as MCP-incapable, so the UI still offers it for short-answer grading
 *    (which is a plain prompt-in/text-out job) but not for authoring courses.
 */
export class CodexDriver implements HarnessDriver {
  readonly id = "codex";
  readonly name = "Codex";
  readonly bin = "codex";
  readonly install = "npm i -g @openai/codex";
  readonly supportsMcp = true;

  private modern: boolean | undefined;

  async detect(): Promise<DriverStatus> {
    const path = await whichBin(this.bin);
    if (!path) {
      return { id: this.id, name: this.name, available: false, supportsMcp: true, install: this.install };
    }
    const modern = await this.isModern(path);
    const version = await readVersion(path);
    return {
      id: this.id,
      name: this.name,
      available: true,
      supportsMcp: modern,
      install: this.install,
      path,
      ...(version ? { version } : {}),
      ...(modern
        ? {}
        : { detail: "This codex build has no `exec`/MCP support; usable for grading but not authoring. Upgrade for authoring." }),
      // Codex names no models in its help — only a default — so unlike Claude
      // Code there is nothing to read off the binary. Declared, therefore, and
      // deliberately short: these are starting points for the picker, not a
      // whitelist, and the UI keeps a free-text field for anything newer.
      models: modern ? ["gpt-5-codex", "gpt-5", "o4-mini", "o3"] : [],
      // `model_reasoning_effort` is a config key rather than a flag, which is
      // why it rides -c alongside the MCP wiring below.
      efforts: modern ? ["low", "medium", "high"] : [],
    };
  }

  /** The modern CLI has an `exec` subcommand; the legacy npm one does not. */
  private async isModern(path: string): Promise<boolean> {
    if (this.modern !== undefined) return this.modern;
    let help = "";
    await spawnLines({
      command: path,
      args: ["exec", "--help"],
      timeoutMs: 15000,
      onStdoutLine: (line) => {
        help += `${line}\n`;
      },
      onStderrLine: (line) => {
        help += `${line}\n`;
      },
    });
    // Legacy prints its generic usage banner and treats "exec" as a prompt.
    this.modern = /--json/.test(help) && /\bexec\b/.test(help) && !/Write and run a python program/.test(help);
    return this.modern;
  }

  async run(options: HarnessRunOptions): Promise<HarnessResult> {
    const collector = new RunCollector(options.onEvent);
    const path = (await whichBin(this.bin)) ?? this.bin;
    const modern = await this.isModern(path);

    const args: string[] = [];
    if (modern) {
      args.push("exec", "--json", "--skip-git-repo-check");
      for (const [name, spec] of Object.entries(options.mcpServers ?? {})) {
        args.push("-c", `mcp_servers.${name}.command=${JSON.stringify(spec.command)}`);
        args.push("-c", `mcp_servers.${name}.args=${JSON.stringify(spec.args)}`);
        if (spec.env && Object.keys(spec.env).length) {
          args.push("-c", `mcp_servers.${name}.env=${JSON.stringify(spec.env)}`);
        }
      }
      // Course authoring writes through MCP only, so the sandbox stays read-only.
      args.push("-c", 'sandbox_mode="read-only"');
      if (options.model) args.push("--model", options.model);
      if (options.effort) args.push("-c", `model_reasoning_effort=${JSON.stringify(options.effort)}`);
    } else {
      if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
        collector.emit({
          type: "error",
          message: "This codex build predates MCP support; choose another driver to author courses.",
        });
        return collector.finish(null, "codex: MCP unsupported");
      }
      args.push("-q");
    }

    const prompt = options.systemPrompt ? `${options.systemPrompt}\n\n---\n\n${options.prompt}` : options.prompt;
    // Legacy codex reads the prompt from argv; modern accepts it on stdin with `-`.
    if (modern) args.push("-");
    else args.push(prompt);

    collector.emit({ type: "start", driver: this.id, command: `codex ${args.slice(0, 4).join(" ")}…` });

    const result = await spawnLines({
      command: path,
      args,
      cwd: options.cwd,
      ...(modern ? { stdin: prompt } : {}),
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onStdoutLine: (line) => (modern ? this.handleJsonLine(line, collector) : collector.emit({ type: "text", text: `${line}\n` })),
      onStderrLine: (text) => collector.emit({ type: "stderr", text }),
    });

    return finishRun(collector, result);
  }

  private handleJsonLine(line: string, collector: RunCollector): void {
    const event = safeJsonParse(line) as Record<string, any> | undefined;
    if (!event) {
      // Non-JSON chatter still belongs in the log.
      collector.emit({ type: "stderr", text: line });
      return;
    }

    // The Rust CLI nests payloads under `msg`; older JSON builds are flat.
    const msg = (event.msg ?? event) as Record<string, any>;
    const type = msg.type ?? event.type;

    switch (type) {
      case "agent_message":
      case "assistant_message":
        if (msg.message ?? msg.text) collector.emit({ type: "text", text: String(msg.message ?? msg.text) });
        break;
      case "agent_reasoning":
      case "reasoning":
        if (msg.text) collector.emit({ type: "reasoning", text: String(msg.text) });
        break;
      case "mcp_tool_call_begin":
      case "exec_command_begin":
      case "tool_call":
        collector.emit({
          type: "tool",
          name: msg.invocation?.tool ?? msg.tool ?? msg.name ?? "tool",
          input: msg.invocation?.arguments ?? msg.arguments,
        });
        break;
      case "mcp_tool_call_end":
      case "exec_command_end":
        collector.emit({
          type: "tool_result",
          name: msg.invocation?.tool ?? msg.tool ?? "tool",
          ok: msg.result?.is_error !== true && msg.exit_code !== 1,
          summary: summarizeValue(msg.result ?? msg.stdout ?? ""),
        });
        break;
      case "token_count":
      case "usage":
        collector.emit({
          type: "usage",
          inputTokens: msg.info?.total_token_usage?.input_tokens ?? msg.input_tokens,
          outputTokens: msg.info?.total_token_usage?.output_tokens ?? msg.output_tokens,
        });
        break;
      case "error":
        collector.emit({ type: "error", message: summarizeValue(msg.message ?? msg, 400) });
        break;
      default:
        break;
    }
  }
}
