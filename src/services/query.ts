import { LEVELS, type Level } from "../types/log.js";
import { decodeCursor, encodeCursor } from "../utils/cursor.js";
import { queryLogs, type QueryFilters } from "../repositories/query.js";

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;

// نتيجة الفحص: إما فلاتر جاهزة، أو رسالة خطأ نرجّعها ب 400.
export type ParseResult =
  | { ok: true; filters: QueryFilters }
  | { ok: false; error: string };

function parseIso(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// بنفحص معاملات الكويري سترينج ونحوّلها لفلاتر نظيفة.
// أي معامل غلط بيرجّع رسالة خطأ بدل ما نمرّره للقاعدة.
export function parseQueryParams(
  qs: Record<string, string | undefined>
): ParseResult {
  const filters: QueryFilters = { attrs: [], limit: DEFAULT_LIMIT };

  if (qs.service !== undefined) filters.service = qs.service;

  if (qs.level !== undefined) {
    if (!LEVELS.includes(qs.level as Level)) {
      return { ok: false, error: `unsupported level: '${qs.level}'` };
    }
    filters.level = qs.level;
  }

  if (qs.since !== undefined) {
    const since = parseIso(qs.since);
    if (!since) return { ok: false, error: "invalid 'since' timestamp" };
    filters.since = since;
  }

  if (qs.until !== undefined) {
    const until = parseIso(qs.until);
    if (!until) return { ok: false, error: "invalid 'until' timestamp" };
    filters.until = until;
  }

  // النطاق لازم يكون منطقي.
  if (filters.since && filters.until && filters.until < filters.since) {
    return { ok: false, error: "'until' must not be earlier than 'since'" };
  }

  if (qs.q !== undefined) filters.q = qs.q;

  // أي معامل بيبدأ بـ "attr." هو فلتر خاصية.
  for (const [param, value] of Object.entries(qs)) {
    if (!param.startsWith("attr.") || value === undefined) continue;
    const key = param.slice(5);
    if (key.length === 0) return { ok: false, error: "empty attribute key" };
    filters.attrs.push({ key, value });
  }

  if (qs.limit !== undefined) {
    if (!/^\d+$/.test(qs.limit)) {
      return { ok: false, error: "limit must be a positive integer" };
    }
    const limit = Number(qs.limit);
    if (limit < 1 || limit > MAX_LIMIT) {
      return { ok: false, error: `limit must be between 1 and ${MAX_LIMIT}` };
    }
    filters.limit = limit;
  }

  if (qs.cursor !== undefined) {
    const pos = decodeCursor(qs.cursor);
    if (!pos) return { ok: false, error: "invalid cursor" };
    filters.cursor = pos;
  }

  return { ok: true, filters };
}

// بننفّذ الاستعلام ونجهّز الرد بشكله النهائي.
export async function runQuery(filters: QueryFilters) {
  const rows = await queryLogs(filters);

  // جبنا صف زيادة: لو موجود، في صفحة تانية.
  const page = rows.slice(0, filters.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > filters.limit && last
      ? encodeCursor({ ts: last.ts.toISOString(), id: String(last.id) })
      : null;

  return {
    logs: page.map((r) => ({
      id: String(r.id),
      timestamp: r.ts.toISOString(),
      level: r.level,
      service: r.service,
      message: r.message,
      attributes: r.attributes ?? {},
    })),
    next_cursor: nextCursor,
  };
}