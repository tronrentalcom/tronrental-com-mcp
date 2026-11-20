/** What a tool answered, for a person (indented key: value) or a script (`--json`). */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** The answer as data: the structured content, else the text parsed as JSON, else the text. */
export function resultData(result: CallToolResult): unknown {
  if (result.structuredContent !== undefined) {
    const sc = result.structuredContent as Record<string, unknown>;
    // The server wraps a non-object answer as {"result": …}.
    return Object.keys(sc).length === 1 && "result" in sc ? sc.result : sc;
  }
  const text = result.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { text: string }).text)
    .join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "-";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function human(value: unknown, indent = ""): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}(none)`;
    return value
      .map((item) =>
        item !== null && typeof item === "object"
          ? `${indent}-\n${human(item, indent + "  ")}`
          : `${indent}- ${scalar(item)}`,
      )
      .join("\n");
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${indent}(empty)`;
    return entries
      .map(([k, v]) =>
        v !== null && typeof v === "object" && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0)
          ? `${indent}${k}:\n${human(v, indent + "  ")}`
          : `${indent}${k}: ${Array.isArray(v) ? "(none)" : scalar(v)}`,
      )
      .join("\n");
  }
  return `${indent}${scalar(value)}`;
}

/** A tool error as `{code, message, status}` when the server sent ours. */
export function errorData(result: CallToolResult): { code?: string; message: string; status?: number; [k: string]: unknown } {
  const data = resultData(result);
  const error = (data as { error?: unknown })?.error;
  if (error && typeof error === "object") return error as { message: string };
  return { message: typeof data === "string" ? data : JSON.stringify(data) };
}
