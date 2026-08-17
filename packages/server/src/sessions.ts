import { prefixedId, type Session } from "@metaharness/core";

/**
 * In-memory record of an in-flight lesson attempt.
 *
 * The server keeps this rather than trusting the client because it is what makes
 * the lesson score, heart charges, and XP tamper-resistant: the browser only ever
 * says "here is my answer to exercise X", and the server decides what that means.
 */
export interface ActiveSession {
  id: string;
  kind: Session["kind"];
  courseId: string;
  lessonId: string | null;
  exerciseIds: string[];
  /** Exercises answered correctly with no prior wrong attempt — the XP basis. */
  firstTryCorrect: Set<string>;
  attempted: Set<string>;
  wrongCount: number;
  startedAt: number;
  completedAt?: number;
}

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SESSIONS = 200;

export class SessionRegistry {
  private sessions = new Map<string, ActiveSession>();

  create(input: { kind: Session["kind"]; courseId: string; lessonId: string | null; exerciseIds: string[] }): ActiveSession {
    this.evictStale();
    const session: ActiveSession = {
      id: prefixedId("ses"),
      kind: input.kind,
      courseId: input.courseId,
      lessonId: input.lessonId,
      exerciseIds: input.exerciseIds,
      firstTryCorrect: new Set(),
      attempted: new Set(),
      wrongCount: 0,
      startedAt: Date.now(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): ActiveSession | undefined {
    return this.sessions.get(id);
  }

  /** Score is first-try accuracy: retries within a session don't inflate it. */
  score(session: ActiveSession): number {
    if (session.exerciseIds.length === 0) return 0;
    return session.firstTryCorrect.size / session.exerciseIds.length;
  }

  private evictStale(): void {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, session] of this.sessions) {
      if (session.startedAt < cutoff) this.sessions.delete(id);
    }
    // Hard cap as a backstop against unbounded growth from abandoned sessions.
    if (this.sessions.size > MAX_SESSIONS) {
      const oldest = [...this.sessions.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt);
      for (const [id] of oldest.slice(0, this.sessions.size - MAX_SESSIONS)) this.sessions.delete(id);
    }
  }
}
