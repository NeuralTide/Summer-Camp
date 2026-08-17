import { useEffect, useState } from "react";
import { IconGear, IconHome, IconPlus, IconUser } from "./components/Icons";
import { IconBook as IconLibrary } from "./components/Icons";
import { api } from "./lib/api";
import { parseRoute, useRouter } from "./lib/router";
import { useEvents } from "./lib/useEvents";
import { BuildScreen } from "./screens/BuildScreen";
import { CourseScreen } from "./screens/CourseScreen";
import { LessonPlayer } from "./screens/LessonPlayer";
import { LibraryScreen } from "./screens/LibraryScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { ResultsScreen } from "./screens/ResultsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import type { AppConfig, AppEvent, BuildJob, CompleteResponse, CourseSummary, DriverStatus, Progress, Session } from "./lib/types";

interface Bootstrap {
  courses: CourseSummary[];
  progress: Progress;
  config: AppConfig;
  drivers: DriverStatus[];
  jobs: BuildJob[];
}

const LAST_COURSE_KEY = "metaharness.lastCourseId";

export default function App() {
  const { route, navigate } = useRouter();
  const [state, setState] = useState<Bootstrap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [session, setSession] = useState<Session | null>(null);
  const [result, setResult] = useState<CompleteResponse | null>(null);
  const [sessionCourseColor, setSessionCourseColor] = useState("#769826");

  const load = async () => {
    try {
      const boot = await api.state();
      setState(boot);
      setLoadError(null);
    } catch {
      setLoadError("Can't reach the Summer Camp server. Make sure it's running, then reload.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEvents((event: AppEvent) => {
    setState((prev) => {
      if (!prev) return prev;
      switch (event.type) {
        case "course.updated": {
          const exists = prev.courses.some((c) => c.id === event.course.id);
          const courses = exists
            ? prev.courses.map((c) => (c.id === event.course.id ? event.course : c))
            : [event.course, ...prev.courses];
          return { ...prev, courses };
        }
        case "course.deleted":
          return { ...prev, courses: prev.courses.filter((c) => c.id !== event.courseId) };
        case "build.started":
          return {
            ...prev,
            jobs: [
              { id: event.jobId, courseId: event.courseId, courseTitle: "", phase: "starting", driver: event.driver, startedAt: new Date().toISOString(), log: [], authored: 0, total: 0 },
              ...prev.jobs,
            ],
          };
        case "build.finished":
          return { ...prev, jobs: prev.jobs.filter((j) => j.id !== event.jobId) };
        case "progress.updated":
          void refreshProgress();
          return prev;
        default:
          return prev;
      }
    });
  });

  const refreshProgress = async () => {
    try {
      const boot = await api.state();
      setState((prev) => (prev ? { ...prev, progress: boot.progress } : boot));
    } catch {
      // A transient failure here just means stats stay slightly stale; not worth surfacing.
    }
  };

  const openCourse = (course: CourseSummary) => {
    localStorage.setItem(LAST_COURSE_KEY, course.id);
    navigate({ name: "course", courseId: course.id });
  };

  const goHome = () => {
    const lastId = localStorage.getItem(LAST_COURSE_KEY);
    const target = state?.courses.find((c) => c.id === lastId) ?? state?.courses[0];
    if (target) navigate({ name: "course", courseId: target.id });
    else navigate({ name: "library" });
  };

  const startLesson = async (courseId: string, lessonId: string, courseColor: string) => {
    const { session: s } = await api.startSession({ courseId, lessonId, kind: "lesson" });
    setSessionCourseColor(courseColor);
    setSession(s);
  };

  const startPractice = async (courseId: string, courseColor: string) => {
    const { session: s } = await api.startSession({ courseId, kind: "practice" });
    setSessionCourseColor(courseColor);
    setSession(s);
  };

  const finishSession = (res: CompleteResponse) => {
    setSession(null);
    setResult(res);
    setState((prev) => (prev ? { ...prev, progress: res.progress } : prev));
  };

  if (loadError) {
    return (
      <div className="page" style={{ maxWidth: 480, margin: "80px auto" }}>
        <div className="notice">{loadError}</div>
      </div>
    );
  }

  if (!state) return null;

  return (
    <>
      <Shell route={route.name} onNavigate={navigate} onHome={goHome}>
        {route.name === "library" && (
          <LibraryScreen
            courses={state.courses}
            progress={state.progress}
            jobs={state.jobs}
            onOpen={openCourse}
            onNew={() => navigate({ name: "build" })}
            onDeleted={() => void load()}
          />
        )}

        {route.name === "build" && (
          <BuildScreen
            drivers={state.drivers}
            config={state.config}
            onBuilding={(course) => openCourse(course)}
          />
        )}

        {route.name === "course" && (
          <CourseScreen
            key={route.courseId}
            courseId={route.courseId}
            progress={state.progress}
            onStartLesson={(lessonId) => {
              const course = state.courses.find((c) => c.id === route.courseId);
              void startLesson(route.courseId, lessonId, course?.color ?? "#769826");
            }}
            onStartPractice={() => {
              const course = state.courses.find((c) => c.id === route.courseId);
              void startPractice(route.courseId, course?.color ?? "#769826");
            }}
            onDeleted={() => navigate({ name: "library" })}
            onBack={() => navigate({ name: "library" })}
          />
        )}

        {route.name === "settings" && (
          <SettingsScreen
            drivers={state.drivers}
            config={state.config}
            onConfigChange={(config) => setState((prev) => (prev ? { ...prev, config } : prev))}
          />
        )}

        {route.name === "profile" && (
          <ProfileScreen progress={state.progress} courses={state.courses} onOpenCourse={openCourse} />
        )}
      </Shell>

      {session && (
        <LessonPlayer
          session={session}
          hearts={state.progress.hearts}
          unlimitedHearts={state.config.unlimitedHearts}
          onExit={() => setSession(null)}
          onFinish={finishSession}
        />
      )}

      {result && (
        <ResultsScreen
          result={result}
          courseColor={sessionCourseColor}
          onContinue={() => {
            setResult(null);
            void load();
          }}
        />
      )}
    </>
  );
}

function Shell({
  route,
  onNavigate,
  onHome,
  children,
}: {
  route: ReturnType<typeof parseRoute>["name"];
  onNavigate: ReturnType<typeof useRouter>["navigate"];
  onHome: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__brand-name">Summer Camp</span>
        </div>

        <div className="sidebar__nav">
          {/* Home lands on the course you were last in, so the course route is
              what marks it current. With no courses at all it falls through to
              the library instead, and Courses below owns that route — better
              the highlight follows where you actually are than where the
              button usually goes. */}
          <button className="nav-item" data-nav="home" aria-current={route === "course" ? "page" : undefined} onClick={onHome}>
            <IconHome size={19} />
            Home
          </button>
          <button className="nav-item" data-nav="build" aria-current={route === "build" ? "page" : undefined} onClick={() => onNavigate({ name: "build" })}>
            <IconPlus size={19} />
            Create
          </button>
          <button className="nav-item" data-nav="library" aria-current={route === "library" ? "page" : undefined} onClick={() => onNavigate({ name: "library" })}>
            <IconLibrary size={19} />
            Courses
          </button>
          <button className="nav-item" data-nav="profile" aria-current={route === "profile" ? "page" : undefined} onClick={() => onNavigate({ name: "profile" })}>
            <IconUser size={19} />
            Profile
          </button>
        </div>

        <div className="sidebar__spacer" />

        <button className="nav-item" data-nav="settings" aria-current={route === "settings" ? "page" : undefined} onClick={() => onNavigate({ name: "settings" })}>
          <IconGear size={19} />
          Settings
        </button>
      </nav>
      <div className="main">{children}</div>
    </div>
  );
}
