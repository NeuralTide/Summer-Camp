import { RunCollector, safeJsonParse, spawnLines, summarizeValue, whichBin } from "../process.js";
import { finishRun, readVersion } from "./claude.js";
import type { DriverStatus, HarnessDriver, HarnessRunOptions, HarnessResult } from "../types.js";

/**
 * Cursor CLI driver (`cursor-agent`). Its headless stream-json feed mirrors Claude
 * Code's closely enough to share a parser shape, but MCP servers come from the
 * project's `.cursor/mcp.json` rather than a flag — so the caller writes that file
 * and passes `cwd`. See `writeCursorMcpConfig` in the registry.
 */
export class CursorAgentDriver implements HarnessDriver {
  readonly id = "cursor-agent";
  readonly name = "Cursor CLI";
  readonly bin = "cursor-agent";
  readonly install = "curl https://cursor.com/install -fsS | bash";
  readonly supportsMcp = true;

  async detect(): Promise<DriverStatus> {
    const path = await whichBin(this.bin);
    if (!path) {
      return { id: this.id, name: this.name, available: false, supportsMcp: true, install: this.install };
    }
    const version = await readVersion(path);
    return {
      id: this.id,
      name: this.name,
      available: true,
      supportsMcp: true,
      install: this.install,
      path,
      ...(version ? { version } : {}),
      detail: "MCP servers are read from .cursor/mcp.json in the working directory.",
      // Neither CLI enumerates its models, and neither has an effort setting,
      // so both come back empty and the UI falls back to a plain text field.
      models: [],
      efforts: [],
    };
  }

  async run(options: HarnessRunOptions): Promise<HarnessResult> {
    const collector = new RunCollector(options.onEvent);
    const args = ["-p", "--output-format", "stream-json", "--force"];
    if (options.model) args.push("--model", options.model);

    const prompt = options.systemPrompt ? `${options.systemPrompt}\n\n---\n\n${options.prompt}` : options.prompt;
    collector.emit({ type: "start", driver: this.id, command: `cursor-agent ${args.join(" ")}` });

    const result = await spawnLines({
      command: this.bin,
      args,
      cwd: options.cwd,
      stdin: prompt,
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
        if (block.type === "text" && block.text) collector.emit({ type: "text", text: block.text });
        else if (block.type === "tool_use") collector.emit({ type: "tool", name: block.name, input: block.input });
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
      if (typeof event.result === "string" && !collector.text) {
        collector.emit({ type: "text", text: event.result });
      }
      if (event.is_error) collector.emit({ type: "error", message: summarizeValue(event.result ?? "failed", 400) });
    }
  }
}
