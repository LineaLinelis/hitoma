import { CATEGORIES, LIMITS, type Category } from "../src/shared";
import { HttpError } from "./types";

export function sameOrigin(request: Request, origin?: string) {
  if (!origin || request.headers.get("Origin") !== origin) {
    throw new HttpError(
      403,
      "origin_mismatch",
      "この画面から操作をやり直してください。",
    );
  }
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new HttpError(
      403,
      "origin_mismatch",
      "この画面から操作をやり直してください。",
    );
  }
}

/** Read at most the documented limit, including chunked requests without Content-Length. */
export async function jsonBody(
  request: Request,
  maxBytes = 16384,
): Promise<Record<string, unknown>> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("Content-Type") ?? "",
    )
  ) {
    throw new HttpError(
      415,
      "json_required",
      "テキストをJSON形式で送信してください。",
    );
  }
  if (Number(request.headers.get("Content-Length")) > maxBytes) {
    throw new HttpError(413, "body_too_large", "送信内容が大きすぎます。");
  }
  const reader = request.body?.getReader();
  if (!reader)
    throw new HttpError(400, "invalid_json", "送信内容を確認してください。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "body_too_large", "送信内容が大きすぎます。");
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("object_required");
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_json", "送信内容を確認してください。");
  } finally {
    reader.releaseLock();
  }
}

export function textField(value: unknown, name: string, max: number): string {
  if (typeof value !== "string")
    throw new HttpError(400, "invalid_text", `${name}を入力してください。`);
  const text = value.replaceAll("\r\n", "\n").normalize("NFC").trim();
  if (
    !text ||
    [...text].length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)
  ) {
    throw new HttpError(
      400,
      "invalid_text",
      `${name}は1〜${max}文字のテキストで入力してください。`,
    );
  }
  return text;
}

export function newThread(body: Record<string, unknown>) {
  if (
    Object.keys(body).some(
      (key) => !["title", "body", "category"].includes(key),
    )
  ) {
    throw new HttpError(
      400,
      "text_only",
      "投稿できるのはタイトル・本文・話題だけです。",
    );
  }
  if (!CATEGORIES.includes(body.category as Category))
    throw new HttpError(400, "invalid_category", "話題を選んでください。");
  const title = textField(body.title, "タイトル", LIMITS.title);
  if (title.includes("\n"))
    throw new HttpError(
      400,
      "invalid_title",
      "タイトルは1行で入力してください。",
    );
  return {
    title,
    body: textField(body.body, "本文", LIMITS.body),
    category: body.category as Category,
  };
}

export function validId(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new HttpError(404, "not_found", "投稿が見つかりません。");
  }
  return value;
}
