import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { IconChevronDown, IconChevronUp, IconPlus, IconTrash } from "./Icons";
import type { CourseTree, PlanLesson, PlanUnit } from "../lib/types";

/**
 * The editable outline shown for both "Build with me" (agent-drafted, full
 * of content already) and "Let me build it" (one empty starter unit/lesson).
 * Everything here is local state until "Write these lessons" is pressed —
 * that single action saves the outline and immediately kicks off authoring
 * (via the existing resume() codepath), so there's no separate save step.
 */

interface Props {
  course: CourseTree;
}

interface EditableSource {
  title: string;
  url: string;
  note: string;
}

function unitsFromCourse(course: CourseTree): PlanUnit[] {
  return course.units.map((u) => ({
    title: u.title,
    description: u.description,
    lessons: u.lessons.map((l) => ({ title: l.title, objective: l.objective, kind: l.kind })),
  }));
}

function sourcesFromCourse(course: CourseTree): EditableSource[] {
  return course.sources.map((s) => ({ title: s.title, url: s.url ?? "", note: s.note ?? "" }));
}

const KIND_LABEL: Record<PlanLesson["kind"], string> = {
  concept: "Concept",
  practice: "Practice",
  checkpoint: "Checkpoint",
};
const KINDS = Object.keys(KIND_LABEL) as PlanLesson["kind"][];

export function OutlineEditor({ course }: Props) {
  const [units, setUnits] = useState<PlanUnit[]>(() => unitsFromCourse(course));
  const [sources, setSources] = useState<EditableSource[]>(() => sourcesFromCourse(course));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { maxUnits, maxLessonsPerUnit } = course.buildConfig;
  const lessonCount = units.reduce((n, u) => n + u.lessons.length, 0);

  const patchUnit = (i: number, patch: Partial<PlanUnit>) => setUnits((prev) => prev.map((u, idx) => (idx === i ? { ...u, ...patch } : u)));

  const patchLesson = (ui: number, li: number, patch: Partial<PlanLesson>) =>
    setUnits((prev) =>
      prev.map((u, idx) => (idx !== ui ? u : { ...u, lessons: u.lessons.map((l, lidx) => (lidx === li ? { ...l, ...patch } : l)) })),
    );

  const addUnit = () => {
    if (units.length >= maxUnits) return;
    setUnits((prev) => [...prev, { title: "New unit", description: "", lessons: [{ title: "New lesson", objective: "", kind: "concept" }] }]);
  };

  const removeUnit = (i: number) => {
    if (units.length <= 1) return;
    setUnits((prev) => prev.filter((_, idx) => idx !== i));
  };

  const moveUnit = (i: number, dir: -1 | 1) => {
    setUnits((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };

  const addLesson = (ui: number) => {
    setUnits((prev) =>
      prev.map((u, idx) => {
        if (idx !== ui || u.lessons.length >= maxLessonsPerUnit) return u;
        return { ...u, lessons: [...u.lessons, { title: "New lesson", objective: "", kind: "concept" }] };
      }),
    );
  };

  const removeLesson = (ui: number, li: number) => {
    setUnits((prev) =>
      prev.map((u, idx) => {
        if (idx !== ui || u.lessons.length <= 1) return u;
        return { ...u, lessons: u.lessons.filter((_, lidx) => lidx !== li) };
      }),
    );
  };

  const moveLesson = (ui: number, li: number, dir: -1 | 1) => {
    setUnits((prev) =>
      prev.map((u, idx) => {
        if (idx !== ui) return u;
        const j = li + dir;
        if (j < 0 || j >= u.lessons.length) return u;
        const lessons = [...u.lessons];
        [lessons[li], lessons[j]] = [lessons[j]!, lessons[li]!];
        return { ...u, lessons };
      }),
    );
  };

  const addSource = () => setSources((prev) => [...prev, { title: "", url: "", note: "" }]);
  const patchSource = (i: number, patch: Partial<EditableSource>) => setSources((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const removeSource = (i: number) => setSources((prev) => prev.filter((_, idx) => idx !== i));

  const invalid = units.some((u) => !u.title.trim() || u.lessons.some((l) => !l.title.trim() || !l.objective.trim()));

  const approve = async () => {
    if (invalid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.saveOutline(course.id, {
        sources: sources
          .filter((s) => s.title.trim())
          .map((s) => ({ title: s.title.trim(), ...(s.url.trim() ? { url: s.url.trim() } : {}), ...(s.note.trim() ? { note: s.note.trim() } : {}) })),
        units,
      });
      await api.resume(course.id);
      // CourseScreen's existing SSE listeners pick up the status flip to
      // "authoring" from here and swap this screen out on their own — no
      // local navigation needed.
    } catch (err) {
      setError(err instanceof ApiError ? [err.message, err.detail].filter(Boolean).join("\n") : "Something went wrong.");
      setSubmitting(false);
    }
  };

  return (
    <div className="stack">
      <div className="card outline-head">
        <div>
          <div className="eyebrow">{course.curation === "manual" ? "Build your own outline" : "Review the plan"}</div>
          <p className="faint" style={{ margin: "4px 0 0", fontSize: 13 }}>
            {lessonCount} lesson{lessonCount === 1 ? "" : "s"} across {units.length} unit{units.length === 1 ? "" : "s"} · up to {maxUnits} units,{" "}
            {maxLessonsPerUnit} lessons each
          </p>
        </div>
        <button className="btn btn--primary" onClick={approve} disabled={invalid || submitting}>
          {submitting ? "Starting…" : "Write these lessons →"}
        </button>
      </div>

      {error && (
        <div className="notice" style={{ whiteSpace: "pre-line" }}>
          {error}
        </div>
      )}

      {units.map((unit, ui) => (
        <div className="card outline-unit" key={ui}>
          <div className="outline-unit__head">
            <input className="input outline-unit__title" value={unit.title} onChange={(e) => patchUnit(ui, { title: e.target.value })} placeholder="Unit title" />
            <div className="outline-row__actions">
              <button className="btn btn--icon btn--ghost" disabled={ui === 0} onClick={() => moveUnit(ui, -1)} title="Move unit up">
                <IconChevronUp size={15} />
              </button>
              <button className="btn btn--icon btn--ghost" disabled={ui === units.length - 1} onClick={() => moveUnit(ui, 1)} title="Move unit down">
                <IconChevronDown size={15} />
              </button>
              <button className="btn btn--icon btn--ghost" disabled={units.length <= 1} onClick={() => removeUnit(ui)} title="Remove unit">
                <IconTrash size={15} />
              </button>
            </div>
          </div>
          <input
            className="input"
            style={{ marginTop: 8 }}
            value={unit.description}
            onChange={(e) => patchUnit(ui, { description: e.target.value })}
            placeholder="One line on what this unit covers (optional)"
          />

          <div className="outline-lessons">
            {unit.lessons.map((lesson, li) => (
              <div className="outline-lesson-row" key={li}>
                <div className="outline-lesson-row__fields">
                  <input className="input" value={lesson.title} onChange={(e) => patchLesson(ui, li, { title: e.target.value })} placeholder="Lesson title" />
                  <input
                    className="input"
                    value={lesson.objective}
                    onChange={(e) => patchLesson(ui, li, { objective: e.target.value })}
                    placeholder="Objective — what can the learner do after this?"
                  />
                  <select className="select" value={lesson.kind} onChange={(e) => patchLesson(ui, li, { kind: e.target.value as PlanLesson["kind"] })}>
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="outline-row__actions">
                  <button className="btn btn--icon btn--ghost" disabled={li === 0} onClick={() => moveLesson(ui, li, -1)} title="Move lesson up">
                    <IconChevronUp size={14} />
                  </button>
                  <button
                    className="btn btn--icon btn--ghost"
                    disabled={li === unit.lessons.length - 1}
                    onClick={() => moveLesson(ui, li, 1)}
                    title="Move lesson down"
                  >
                    <IconChevronDown size={14} />
                  </button>
                  <button className="btn btn--icon btn--ghost" disabled={unit.lessons.length <= 1} onClick={() => removeLesson(ui, li)} title="Remove lesson">
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button className="btn btn--sm btn--flat" style={{ marginTop: 10 }} onClick={() => addLesson(ui)} disabled={unit.lessons.length >= maxLessonsPerUnit}>
            <IconPlus size={14} />
            {unit.lessons.length >= maxLessonsPerUnit ? "At lesson limit" : "Add lesson"}
          </button>
        </div>
      ))}

      <button className="btn" onClick={addUnit} disabled={units.length >= maxUnits}>
        <IconPlus size={16} />
        {units.length >= maxUnits ? "At unit limit" : "Add unit"}
      </button>

      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          Sources
        </div>
        {sources.length === 0 && (
          <p className="faint" style={{ fontSize: 13, margin: 0 }}>
            No sources yet — optional.
          </p>
        )}
        <div className="stack" style={{ gap: 8 }}>
          {sources.map((s, i) => (
            <div className="outline-source-row" key={i}>
              <input className="input" value={s.title} onChange={(e) => patchSource(i, { title: e.target.value })} placeholder="Source title" />
              <input className="input" value={s.url} onChange={(e) => patchSource(i, { url: e.target.value })} placeholder="URL (optional)" />
              <button className="btn btn--icon btn--ghost" onClick={() => removeSource(i)} title="Remove source">
                <IconTrash size={14} />
              </button>
            </div>
          ))}
        </div>
        <button className="btn btn--sm btn--flat" style={{ marginTop: 10 }} onClick={addSource}>
          <IconPlus size={14} />
          Add source
        </button>
      </div>
    </div>
  );
}
