import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ClaudeDriver } from "./drivers/claude.js";
import { CodexDriver } from "./drivers/codex.js";
import { CursorAgentDriver } from "./drivers/cursorAgent.js";
import { CustomDriver, GeminiDriver } from "./drivers/generic.js";
import type { DriverStatus, HarnessDriver, McpServerSpec } from "./types.js";

export class DriverRegistry {
  private drivers = new Map<string, HarnessDriver>();
  private custom: CustomDriver;

  constructor(customCommand = "") {
    this.custom = new CustomDriver(customCommand);
    for (const driver of [
      new ClaudeDriver(),
      new CodexDriver(),
      new CursorAgentDriver(),
      new GeminiDriver(),
      this.custom,
    ]) {
      this.drivers.set(driver.id, driver);
    }
  }

  setCustomCommand(template: string): void {
    this.custom.setTemplate(template);
  }

  get(id: string): HarnessDriver | undefined {
    return this.drivers.get(id);
  }

  list(): HarnessDriver[] {
    return [...this.drivers.values()];
  }

  async statuses(): Promise<DriverStatus[]> {
    return Promise.all(this.list().map((d) => d.detect()));
  }

  /**
   * Resolve the driver to use. `"auto"` picks the first installed driver that can
   * speak MCP, in preference order — so a fresh checkout works with whatever the
   * user already has, without any configuration at all.
   */
  async resolve(preferred: string, opts: { requireMcp?: boolean } = {}): Promise<{ driver: HarnessDriver; status: DriverStatus }> {
    const requireMcp = opts.requireMcp ?? true;

    if (preferred && preferred !== "auto") {
      const driver = this.get(preferred);
      if (!driver) throw new Error(`Unknown harness driver "${preferred}".`);
      const status = await driver.detect();
      if (!status.available) {
        throw new Error(`${driver.name} is not installed or not on PATH. Install it with: ${driver.install}`);
      }
      if (requireMcp && !status.supportsMcp) {
        throw new Error(`${driver.name} cannot author courses: ${status.detail ?? "no MCP support"}`);
      }
      return { driver, status };
    }

    const order = ["claude", "codex", "cursor-agent", "gemini", "custom"];
    const problems: string[] = [];
    for (const id of order) {
      const driver = this.get(id);
      if (!driver) continue;
      const status = await driver.detect();
      if (!status.available) continue;
      if (requireMcp && !status.supportsMcp) {
        problems.push(`${driver.name}: ${status.detail ?? "no MCP support"}`);
        continue;
      }
      return { driver, status };
    }

    const detail = problems.length ? ` Found but unusable — ${problems.join("; ")}.` : "";
    throw new Error(
      `No usable agent CLI found. Install one of: claude, codex, cursor-agent, gemini — or set a custom command in Settings.${detail}`,
    );
  }
}

/**
 * Some CLIs take MCP servers as a flag; others only read a file in the working
 * directory. This writes the file-based configs so every driver sees the same
 * servers, and returns the directory to run in.
 */
export async function prepareWorkspace(
  baseDir: string,
  driverId: string,
  mcpServers: Record<string, McpServerSpec>,
): Promise<string> {
  await mkdir(baseDir, { recursive: true });

  if (driverId === "cursor-agent") {
    const dir = join(baseDir, ".cursor");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "mcp.json"), JSON.stringify({ mcpServers }, null, 2), "utf8");
  }

  if (driverId === "gemini") {
    const dir = join(baseDir, ".gemini");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "settings.json"), JSON.stringify({ mcpServers }, null, 2), "utf8");
  }

  return baseDir;
}
