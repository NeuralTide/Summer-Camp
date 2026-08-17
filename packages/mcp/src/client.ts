/** Thin HTTP client for the metaharness daemon. */
export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | undefined,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.token ? { "x-metaharness-token": this.token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Daemon returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
    }

    if (!res.ok) {
      const err = parsed as { error?: string; detail?: string };
      // The daemon puts schema validation failures in `detail`; they are the whole
      // point of the round trip, so they must survive back to the agent verbatim.
      throw new Error(err.detail ? `${err.error ?? "Request failed"}\n${err.detail}` : (err.error ?? `HTTP ${res.status}`));
    }
    return parsed as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }
  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }
}
