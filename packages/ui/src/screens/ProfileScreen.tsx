import { IconBolt, IconBook, IconFlame, IconTrophy } from "../components/Icons";
import { Meter, monogram } from "../components/Chrome";
import type { CourseSummary, Progress } from "../lib/types";

interface Props {
  progress: Progress;
  courses: CourseSummary[];
  onOpenCourse: (course: CourseSummary) => void;
}

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ProfileScreen({ progress, courses, onOpenCourse }: Props) {
  const lessonsDone = Object.values(progress.lessons).filter((l) => l.completions > 0).length;
  const crownsEarned = Object.values(progress.lessons).reduce((n, l) => n + l.crowns, 0);
  const inProgress = courses.filter((c) => c.id in progress.courses);
  const todayXp = progress.dailyXp[todayKey()] ?? 0;

  return (
    <div className="page page--narrow">
      <div className="card profile-head">
        <div className="avatar">M</div>
        <h1>Your learning</h1>

        <div className="stat-line">
          <div className="stat-line__item">
            <strong className="tabular">{progress.streak.current}</strong>
            <span>Day streak</span>
          </div>
          <div className="stat-line__item">
            <strong className="tabular">{progress.xp}</strong>
            <span>Total XP</span>
          </div>
          <div className="stat-line__item">
            <strong className="tabular">{lessonsDone}</strong>
            <span>Lessons done</span>
          </div>
          <div className="stat-line__item">
            <strong className="tabular">{crownsEarned}</strong>
            <span>Crowns</span>
          </div>
        </div>
      </div>

      <div className="stack" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            Today's goal
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Meter value={todayXp} max={progress.dailyGoalXp} />
            <span className="tabular faint" style={{ fontSize: 13, flex: "none" }}>
              {todayXp} / {progress.dailyGoalXp} XP
            </span>
          </div>
        </div>

        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Progress
          </div>
          <div className="list-row">
            <span className="list-row__icon">
              <IconFlame size={15} />
            </span>
            <span style={{ flex: 1 }}>Longest streak</span>
            <strong className="tabular">{progress.streak.longest} days</strong>
          </div>
          <div className="list-row">
            <span className="list-row__icon">
              <IconBolt size={15} />
            </span>
            <span style={{ flex: 1 }}>Total XP earned</span>
            <strong className="tabular">{progress.xp}</strong>
          </div>
          <div className="list-row">
            <span className="list-row__icon">
              <IconTrophy size={15} />
            </span>
            <span style={{ flex: 1 }}>Courses in progress</span>
            <strong className="tabular">{inProgress.length}</strong>
          </div>
        </div>

        {inProgress.length > 0 && (
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              Learning
            </div>
            <div className="learning-grid">
              {/* --mark-accent rides the button, not just the tile: the chip's
                  ledge is cut from the same course colour. */}
              {inProgress.map((c) => (
                <button key={c.id} className="learning-chip" onClick={() => onOpenCourse(c)} style={{ ["--mark-accent" as string]: c.color }}>
                  <span className="learning-chip__mark course-mark">{monogram(c.title)}</span>
                  {c.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {courses.length === 0 && (
          <div className="empty">
            <IconBook size={28} />
            <p className="muted" style={{ marginTop: 10 }}>
              Nothing started yet — build your first course to see progress here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
