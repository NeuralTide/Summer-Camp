import { useCallback, useEffect, useState } from "react";

/**
 * A ~40-line history router. The app has five screens and no nested layouts, so a
 * routing library would be more surface area than the problem has.
 */

export type Route =
  | { name: "library" }
  | { name: "build" }
  | { name: "course"; courseId: string }
  | { name: "settings" }
  | { name: "profile" };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "build") return { name: "build" };
  if (parts[0] === "settings") return { name: "settings" };
  if (parts[0] === "profile") return { name: "profile" };
  if (parts[0] === "course" && parts[1]) return { name: "course", courseId: parts[1] };
  return { name: "library" };
}

export function routeToPath(route: Route): string {
  switch (route.name) {
    case "build":
      return "/build";
    case "settings":
      return "/settings";
    case "profile":
      return "/profile";
    case "course":
      return `/course/${route.courseId}`;
    default:
      return "/";
  }
}

export function useRouter() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: Route, replace = false) => {
    const path = routeToPath(next);
    if (replace) window.history.replaceState({}, "", path);
    else window.history.pushState({}, "", path);
    setRoute(next);
    window.scrollTo(0, 0);
  }, []);

  return { route, navigate };
}
