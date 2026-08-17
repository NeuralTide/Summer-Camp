/**
 * The harness abstraction.
 *
 * A "harness" is any coding agent that can be run headlessly with a prompt and a
 * set of MCP servers. Metaharness never talks to a model provider directly — it
 * shells out to whatever agent CLI the user already has installed and
 * authenticated. That is what makes the system harness-agnostic: swapping Claude
 * Code for Codex is a config change, not a code change, and metaharness needs no
 * API key of its own.
 */

export interface McpServerSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface HarnessRunOptions {
  prompt: string;
  /** Prepended as a system/steering instruction where the CLI supports it. */
  systemPrompt?: string;
  /**
   * Model to run, in whatever spelling the CLI expects — "opus", "sonnet",
   * "gpt-5", a full API id. Metaharness does not validate or map these: it
   * never talks to a provider, so the set of valid names belongs to whichever
   * CLI is installed, and a fixed list here would go stale the moment one of
   * them shipped a new model. Empty means "whatever the CLI defaults to".
   */
  model?: string;
  /**
   * Reasoning effort, in the CLI's own vocabulary. Same reasoning as `model`:
   * the vocabulary belongs to whichever agent is installed, so this stays a
   * free string and each driver drops it if its CLI has no equivalent. Empty
   * means "whatever the CLI defaults to".
   */
  effort?: string;
  cwd?: string;
  /** MCP servers the agent should be able to call, keyed by server name. */
  mcpServers?: Record<string, McpServerSpec>;
  /**
   * Tool names the agent may use without prompting. Metaharness always passes an
   * explicit allowlist rather than a blanket "skip all permissions" flag: course
   * authoring only needs its own MCP tools plus web search, so there is no reason
   * to hand an autonomous agent file-write or shell access.
   */
  allowedTools?: string[];
  /** Hard ceiling on wall-clock time; the process is killed when it elapses. */
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: HarnessEvent) => void;
}

export type HarnessEvent =
  | { type: "start"; driver: string; command: string }
  /** Assistant prose, streamed as it arrives. */
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; name: string; input?: unknown }
  | { type: "tool_result"; name: string; ok: boolean; summary?: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { type: "stderr"; text: string }
  | { type: "done"; ok: boolean; exitCode: number | null }
  | { type: "error"; message: string };

export interface HarnessResult {
  ok: boolean;
  /** Concatenated assistant text output. */
  text: string;
  exitCode: number | null;
  events: HarnessEvent[];
  durationMs: number;
  error?: string;
}

export interface HarnessDriver {
  readonly id: string;
  readonly name: string;
  /** Binary looked up on PATH to decide availability. */
  readonly bin: string;
  /** Human-readable note shown in the UI when the driver is unavailable. */
  readonly install: string;
  /** Whether this driver can be given MCP servers. */
  readonly supportsMcp: boolean;
  detect(): Promise<DriverStatus>;
  run(options: HarnessRunOptions): Promise<HarnessResult>;
}

export interface DriverStatus {
  id: string;
  name: string;
  available: boolean;
  version?: string;
  path?: string;
  supportsMcp: boolean;
  install: string;
  detail?: string;
  /**
   * Model names this CLI accepts, for the UI to offer instead of a text field.
   *
   * Read off the installed binary wherever it will say — Claude Code advertises
   * its aliases in `--help` — and declared by the driver only where it won't.
   * That ordering matters: a list baked into our source goes stale the moment a
   * CLI ships a new model, so anything we can ask the binary for, we ask. The
   * field stays advisory either way, and every caller must still accept a name
   * that isn't in it.
   */
  models?: string[];
  /** Effort levels this CLI accepts, or empty where it has no such concept. */
  efforts?: string[];
}
