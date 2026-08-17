# Summer Camp

An open-source course generator that runs on the coding agent you already have.

Ask it about anything — Bayesian statistics, the French Revolution, how compilers
work — and it interviews you for a minute, then builds a full course: units,
lessons, notes, and exercises you actually answer, on a path you work down with
XP, hearts, streaks and spaced repetition.

**It has no API key.** Summer Camp never talks to a model provider. It drives
whichever agent CLI is installed on your machine — Claude Code, Codex, Cursor,
or Gemini — through an MCP toolset, so course generation is spent from the
subscription you already pay for and nothing is metered by this project.

---

## Why it's built this way

Every other AI course generator is a hosted service holding its own API key,
which is why they all charge per seat. Pointing an agent CLI at the problem
instead makes the marginal cost of a course zero to whoever runs it, and means
your courses are plain JSON files on your own disk rather than rows in someone
else's database.

The harness layer is deliberately generic. Adding a driver is one file — see
`packages/harness/src/drivers/` — and the app degrades gracefully to whatever a
given CLI can do, rather than requiring a specific vendor.

## Requirements

- **Node 20+**
- **At least one agent CLI**, installed and authenticated:

  | CLI | Authoring | Notes |
  | --- | --- | --- |
  | [Claude Code](https://claude.com/claude-code) | yes | the only one with a first-party web-search tool for the research pass |
  | [Codex](https://github.com/openai/codex) | yes | needs a build with `exec` and MCP support |
  | Cursor CLI | yes | reads MCP servers from `.cursor/mcp.json` |
  | Gemini CLI | yes | reads MCP servers from `.gemini/settings.json` |

  Models and reasoning effort are detected from the installed binary where it
  advertises them, so the picker follows your CLI rather than a list baked in
  here.

## Quickstart

```bash
npm install
npm run build
npm start          # serves the app and opens it
```

Then describe what you want to learn. The agent asks a couple of questions,
proposes a plan, and writes the lessons in parallel once you approve it.

Data lives in `~/.metaharness` — one JSON file per course, plus your progress.
Delete the directory to start over; copy a course file to share it.

## Layout

| Package | What it holds |
| --- | --- |
| `core` | course/exercise schema, SM-2 scheduling, deterministic grading, progress and gamification rules, JSON persistence |
| `harness` | driver layer over the agent CLIs, with capability detection read off each binary |
| `mcp` | the authoring toolset the agent calls to plan a course and write lessons |
| `server` | build pipeline, HTTP API, SSE event bus, tamper-resistant session and grading endpoints |
| `ui` | React app — the lesson path, the player, the build interview |

Grading is local and deterministic for every exercise type except short answers,
so the player never blocks on a model. Short answers get an instant heuristic
verdict and an optional model second opinion in the background.

The server holds session state rather than trusting the browser: the client only
ever says "here is my answer to exercise X", and the server decides what that
means for your score, hearts and XP.

```bash
npm test          # server + core test suite
npm run typecheck
npm run dev       # server with reload
npm run dev:ui    # Vite dev server for the UI
```

## Courses are AI-generated

Read them that way. The agent writes confidently and is sometimes wrong — in
testing, a lesson on attention asserted that self-attention is bidirectional,
which is true of BERT and false of the decoder-only models the course was
actually about.

Nothing here has been reviewed by a subject expert. If you show a generated
course to anyone else, tell them where it came from.

## Licensing

Code is MIT — see [LICENSE](LICENSE).

Bundled assets are **not** all under that licence, and anyone forking this
should know which is which:

| Asset | Licence |
| --- | --- |
| Instrument Sans (`packages/ui/src/fonts/`) | SIL Open Font License 1.1 — see `InstrumentSans-OFL.txt` beside it |
| IBM Plex Sans / Mono | SIL Open Font License 1.1, via `@fontsource` |
| KaTeX fonts | MIT, via `katex` |
| Scenery art (`packages/ui/src/assets/scenery/*.svg`) | **generated with Higgsfield; redistribution terms unresolved** |

That last row is a genuine open question, not boilerplate. Resolve it or replace
those five files before publishing a fork.

## Status

Early. The generator works and the app around it is complete enough to use
daily, but it has not been run by anyone but its author. Known gaps are tracked
as issues; the largest is that there is no way to tell the app a lesson is wrong
and have it fixed.
