import { useState } from "react";
import { IconKebab, IconPlus, IconTrash } from "../components/Icons";
import { api } from "../lib/api";
import type { BuildJob, CourseSummary, Progress } from "../lib/types";

interface Props {
  courses: CourseSummary[];
  progress: Progress;
  jobs: BuildJob[];
  onOpen: (course: CourseSummary) => void;
  onNew: () => void;
  onDeleted: (courseId: string) => void;
}

const STATUS_LABEL: Record<CourseSummary["status"], string> = {
  planning: "Planning",
  reviewing: "Awaiting review",
  authoring: "Authoring",
  ready: "Ready",
  failed: "Failed",
};

export function LibraryScreen({ courses, progress, jobs, onOpen, onNew, onDeleted }: Props) {
  const jobFor = (courseId: string) => jobs.find((j) => j.courseId === courseId && j.phase !== "done" && j.phase !== "failed");

  return (
    <div className="page page--wide">
      <div className="pagehead" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div className="eyebrow">Summer Camp</div>
          <h1>Your courses</h1>
          <p>View and manage everything you're learning.</p>
        </div>
        <button className="btn btn--primary" onClick={onNew}>
          <IconPlus size={15} />
          New course
        </button>
      </div>

      {courses.length === 0 ? (
        <Empty onNew={onNew} />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Done lessons</th>
                <th>Total lessons</th>
                <th>Created</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <Row
                  key={course.id}
                  course={course}
                  building={Boolean(jobFor(course.id))}
                  due={progress.dueByCourse[course.id] ?? 0}
                  onOpen={() => onOpen(course)}
                  onDeleted={() => onDeleted(course.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({
  course,
  building,
  due,
  onOpen,
  onDeleted,
}: {
  course: CourseSummary;
  building: boolean;
  due: number;
  onOpen: () => void;
  onDeleted: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const remove = async () => {
    await api.deleteCourse(course.id);
    onDeleted();
  };

  return (
    <tr>
      <td>
        <button className="row-title" onClick={onOpen} style={{ textAlign: "left" }}>
          {course.title}
        </button>
      </td>
      <td>
        <span className="status-pill" data-status={building ? "authoring" : course.status}>
          {building ? "Building…" : STATUS_LABEL[course.status]}
        </span>
      </td>
      <td className="tabular">{course.authoredCount}</td>
      <td className="tabular">{course.lessonCount}</td>
      <td className="faint">{new Date(course.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td>
      <td>
        <div className="row-actions">
          <button className="btn btn--sm" onClick={onOpen}>
            Open
          </button>
          <button className="btn btn--sm" disabled={due === 0} style={due > 0 ? { background: "var(--accent)", color: "var(--accent-text)" } : undefined} onClick={onOpen}>
            {due > 0 ? `Review (${due})` : "No reviews"}
          </button>
          <div style={{ position: "relative" }}>
            <button className="btn btn--icon btn--ghost" onClick={() => setMenuOpen((v) => !v)} aria-label="More">
              <IconKebab />
            </button>
            {menuOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setMenuOpen(false)} />
                <div
                  className="card"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 6px)",
                    zIndex: 11,
                    padding: 8,
                    minWidth: 150,
                  }}
                >
                  <button
                    className="tab-btn"
                    style={{ width: "100%", color: "var(--wrong)" }}
                    onClick={remove}
                  >
                    <IconTrash size={14} />
                    Delete course
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

function Empty({ onNew }: { onNew: () => void }) {
  return (
    <div className="empty">
      <div style={{ fontSize: 40, marginBottom: 12 }}>🧭</div>
      <h2>Nothing here yet</h2>
      <p className="muted" style={{ maxWidth: 380, margin: "0 auto 22px" }}>
        Tell it any topic and an agent will research it and build you a full interactive course.
      </p>
      <button className="btn btn--primary" onClick={onNew}>
        Start a course
      </button>
    </div>
  );
}
