export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      signal: options.signal ?? controller.signal,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    const body = (await response.json().catch(() => null)) as
      | (T & { error?: string; message?: string })
      | null;
    if (!response.ok)
      throw new ApiError(
        body?.error ?? "unavailable",
        body?.message ??
          "接続できませんでした。少し時間をおいてお試しください。",
        response.status,
      );
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "network_error",
      "接続できませんでした。通信状態を確認して、もう一度お試しください。",
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}

export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
