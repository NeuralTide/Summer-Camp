import type {
  AnswerResponse,
  Answer,
  AppConfig,
  ChatTurn,
  InterviewReply,
  BuildConfig,
  BuildJob,
  CompleteResponse,
  CourseProgressView,
  CourseSummary,
  CourseTree,
  CurationMode,
  DriverStatus,
  PlanUnit,
  Progress,
  Session,
  WeakArea,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError("Can't reach the Summer Camp server. Is it still running?", 0);
  }

  const text = await res.text();
  const parsed = text ? safeParse(text) : undefined;

  if (!res.ok) {
    const err = parsed as { error?: string; detail?: string } | undefined;
    throw new ApiError(err?.error ?? `Request failed (${res.status})`, res.status, err?.detail);
  }
  return parsed as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface BootstrapState {
  courses: CourseSummary[];
  progress: Progress;
  config: AppConfig;
  drivers: DriverStatus[];
  jobs: BuildJob[];
}

export const api = {
  state: () => call<BootstrapState>("GET", "/api/state"),
  drivers: () => call<{ drivers: DriverStatus[] }>("GET", "/api/drivers"),
  updateConfig: (patch: Partial<AppConfig>) => call<{ config: AppConfig }>("PATCH", "/api/config", patch),

  courseView: (id: string) =>
    call<{ course: CourseTree; view: CourseProgressView; weakAreas: WeakArea[]; job: { id: string } | null }>(
      "GET",
      `/api/courses/${id}/view`,
    ),
  deleteCourse: (id: string) => call<{ deleted: boolean }>("DELETE", `/api/courses/${id}`),
  build: (input: {
    topic: string;
    level: string;
    focus?: string;
    driver?: string;
    model?: string;
    curation: CurationMode;
    buildConfig: BuildConfig;
  }) => call<{ job: BuildJob; course: CourseSummary }>("POST", "/api/courses/build", input),

  /** One turn of the setup interview. The whole transcript goes every time —
   *  the server is stateless between turns, see chatReplyPrompt. */
  chat: (input: { messages: ChatTurn[]; driver?: string; model?: string }) =>
    call<InterviewReply>("POST", "/api/build/chat", input),
  resume: (id: string) => call<{ job: BuildJob }>("POST", `/api/courses/${id}/resume`, {}),

  manualCreate: (input: { title: string; level: string; icon?: string; color?: string; buildConfig: BuildConfig; units: PlanUnit[] }) =>
    call<{ course: CourseSummary }>("POST", "/api/courses/manual", input),
  saveOutline: (id: string, input: { title?: string; description?: string; sources?: Array<{ title: string; url?: string; note?: string }>; units: PlanUnit[] }) =>
    call<{ course: CourseSummary }>("PATCH", `/api/courses/${id}/outline`, input),

  job: (id: string) => call<{ job: BuildJob }>("GET", `/api/jobs/${id}`),
  cancelJob: (id: string) => call<{ cancelled: boolean }>("POST", `/api/jobs/${id}/cancel`, {}),

  startSession: (input: { courseId: string; lessonId?: string; kind?: "lesson" | "practice" }) =>
    call<{ session: Session }>("POST", "/api/sessions", input),
  answer: (sessionId: string, exerciseId: string, answer: Answer) =>
    call<AnswerResponse>("POST", `/api/sessions/${sessionId}/answer`, { exerciseId, answer }),
  complete: (sessionId: string) => call<CompleteResponse>("POST", `/api/sessions/${sessionId}/complete`, {}),

  refillHearts: () => call<{ progress: Progress }>("POST", "/api/progress/refill-hearts", {}),
};
