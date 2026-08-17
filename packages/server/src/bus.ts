import type { ServerResponse } from "node:http";
import type { CourseSummary } from "@metaharness/core";

/** Everything the UI reacts to. One channel keeps the client's state model simple. */
export type AppEvent =
  | { type: "course.updated"; course: CourseSummary }
  | { type: "course.deleted"; courseId: string }
  | { type: "build.started"; jobId: string; courseId: string; driver: string }
  | { type: "build.log"; jobId: string; courseId: string; entry: BuildLogEntry }
  | { type: "build.progress"; jobId: string; courseId: string; authored: number; total: number; phase: BuildPhase }
  | { type: "build.finished"; jobId: string; courseId: string; ok: boolean; error?: string }
  | { type: "progress.updated" }
  | { type: "grade.updated"; exerciseId: string; correct: boolean; score: number; feedback: string };

export type BuildPhase = "starting" | "researching" | "planning" | "authoring" | "finishing" | "done" | "failed";

export interface BuildLogEntry {
  at: string;
  level: "info" | "tool" | "text" | "warn" | "error";
  message: string;
  /** Which parallel authoring worker produced this, for the UI's lane display. */
  worker?: number;
}

type Subscriber = { id: number; res: ServerResponse };

export class EventBus {
  private subscribers: Subscriber[] = [];
  private nextId = 1;
  /** Recent events, replayed to clients that connect mid-build. */
  private recent: AppEvent[] = [];

  subscribe(res: ServerResponse): () => void {
    const id = this.nextId++;
    this.subscribers.push({ id, res });
    return () => {
      this.subscribers = this.subscribers.filter((s) => s.id !== id);
    };
  }

  emit(event: AppEvent): void {
    this.recent.push(event);
    if (this.recent.length > 300) this.recent.shift();

    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const sub of [...this.subscribers]) {
      try {
        sub.res.write(payload);
      } catch {
        // A dead connection shouldn't take down the emitter; drop the subscriber.
        this.subscribers = this.subscribers.filter((s) => s.id !== sub.id);
      }
    }
  }

  get subscriberCount(): number {
    return this.subscribers.length;
  }

  closeAll(): void {
    for (const sub of this.subscribers) {
      try {
        sub.res.end();
      } catch {
        /* already gone */
      }
    }
    this.subscribers = [];
  }
}
