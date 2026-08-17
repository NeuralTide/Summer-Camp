import { useState } from "react";
import { api } from "../lib/api";
import type { AppConfig, DriverStatus } from "../lib/types";

interface Props {
  drivers: DriverStatus[];
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
}

export function SettingsScreen({ drivers, config, onConfigChange }: Props) {
  const [customCommand, setCustomCommand] = useState(config.customCommand);
  const [saved, setSaved] = useState(false);

  // The driver that will actually run, resolving "auto" the way the server
  // does, so the model and effort choices below are the ones its CLI accepts
  // rather than a list that fits no harness in particular.
  const active =
    drivers.find((d) => d.id === config.driver) ?? drivers.find((d) => d.available && d.supportsMcp);
  const models = active?.models ?? [];
  const efforts = active?.efforts ?? [];

  const patch = async (partial: Partial<AppConfig>) => {
    const { config: next } = await api.updateConfig(partial);
    onConfigChange(next);
  };

  const saveCustomCommand = async () => {
    await patch({ customCommand });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="page page--narrow">
      <div className="pagehead">
        <div className="eyebrow">Summer Camp</div>
        <h1>Settings</h1>
      </div>

      <div className="stack">
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            Authoring harness
          </div>
          <p className="faint" style={{ fontSize: 13, margin: "0 0 14px" }}>
            Summer Camp is harness-agnostic — it shells out to whichever agent CLI you already have installed and signed in.
          </p>

          {drivers.map((d) => (
            <div key={d.id} className="driver-row">
              <span className="dot" data-on={d.available && d.supportsMcp} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>
                  {d.name} {d.version && <span className="faint">· {d.version}</span>}
                </div>
                {!d.available && (
                  <div className="faint" style={{ fontSize: 12 }}>
                    Not found. Install: <code>{d.install}</code>
                  </div>
                )}
                {d.available && !d.supportsMcp && d.detail && (
                  <div className="faint" style={{ fontSize: 12 }}>
                    {d.detail}
                  </div>
                )}
              </div>
              {d.available && d.supportsMcp && config.driver === d.id && <span className="status-pill" data-status="ready">Active</span>}
            </div>
          ))}

          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="driver-select">Preferred driver</label>
            <select id="driver-select" className="select" value={config.driver} onChange={(e) => patch({ driver: e.target.value })}>
              <option value="auto">Auto (first available)</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="model">Model</label>
            <p className="faint" style={{ fontSize: 12.5, margin: "-3px 0 3px" }}>
              {models.length > 0 ? (
                <>
                  Read off {active?.name}'s own <code>--help</code>, so the list follows the CLI you have installed rather than
                  one baked in here. A name it hasn't advertised still works — type it in.
                </>
              ) : (
                <>
                  Spelled the way the driver's own CLI expects it. Summer Camp passes it straight through as <code>--model</code>{" "}
                  and never talks to a provider itself, and {active?.name ?? "this harness"} doesn't advertise its model names,
                  so there's nothing to offer here. Leave it empty to use whatever the CLI defaults to.
                </>
              )}
            </p>
            {models.length > 0 && (
              <div className="tray__group" style={{ marginBottom: 8 }}>
                <button className="tray__opt" aria-pressed={!config.model} onClick={() => void patch({ model: "" })}>
                  Default
                </button>
                {models.map((m) => (
                  <button key={m} className="tray__opt" aria-pressed={config.model === m} onClick={() => void patch({ model: m })}>
                    {m}
                  </button>
                ))}
              </div>
            )}
            <input
              id="model"
              className="input"
              placeholder="Default"
              value={config.model}
              onChange={(e) => patch({ model: e.target.value })}
            />
          </div>

          {efforts.length > 0 && (
            <div className="field" style={{ marginTop: 16 }}>
              <label>Effort</label>
              <p className="faint" style={{ fontSize: 12.5, margin: "-3px 0 3px" }}>
                How hard {active?.name} thinks before it answers. Higher is slower and costs more; it mostly pays off on the
                planning pass, where one bad outline shapes every lesson after it.
              </p>
              <div className="tray__group">
                <button className="tray__opt" aria-pressed={!config.effort} onClick={() => void patch({ effort: "" })}>
                  Default
                </button>
                {efforts.map((e) => (
                  <button key={e} className="tray__opt" aria-pressed={config.effort === e} onClick={() => void patch({ effort: e })}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            Custom command
          </div>
          <p className="faint" style={{ fontSize: 13, margin: "0 0 14px" }}>
            Point Summer Camp at any other agent CLI. Use <code>{"{prompt}"}</code> for the prompt text (omit it to send the
            prompt on stdin) and <code>{"{mcp}"}</code> for the MCP server config as inline JSON.
          </p>
          <div className="field">
            <input
              className="input"
              placeholder="my-agent --mcp-config '{mcp}' {prompt}"
              value={customCommand}
              onChange={(e) => setCustomCommand(e.target.value)}
            />
          </div>
          <button className="btn btn--sm" style={{ marginTop: 10 }} onClick={saveCustomCommand}>
            {saved ? "Saved" : "Save"}
          </button>
        </div>

        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 14 }}>
            Learning
          </div>

          <Row
            label="Unlimited hearts"
            detail="Practice without losing hearts on wrong answers."
            checked={config.unlimitedHearts}
            onChange={(v) => patch({ unlimitedHearts: v })}
          />
          <Row
            label="Double-check short answers with the model"
            detail="Free-text answers get an offline heuristic grade instantly, then an LLM pass confirms it."
            checked={config.llmGrading}
            onChange={(v) => patch({ llmGrading: v })}
          />

          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="goal">Daily XP goal</label>
            <input
              id="goal"
              className="input"
              type="number"
              min={10}
              max={500}
              step={10}
              value={config.dailyGoalXp}
              onChange={(e) => patch({ dailyGoalXp: Number(e.target.value) })}
            />
          </div>

          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="concurrency">Parallel authoring workers</label>
            <input
              id="concurrency"
              className="input"
              type="number"
              min={1}
              max={8}
              value={config.authorConcurrency}
              onChange={(e) => patch({ authorConcurrency: Number(e.target.value) })}
            />
            <span className="faint" style={{ fontSize: 12 }}>
              How many lessons a course build writes at once. Higher is faster but noisier.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "10px 0", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3, width: 17, height: 17, accentColor: "var(--ink)" }} />
      <span>
        <div>{label}</div>
        <div className="faint" style={{ fontSize: 12.5 }}>
          {detail}
        </div>
      </span>
    </label>
  );
}
