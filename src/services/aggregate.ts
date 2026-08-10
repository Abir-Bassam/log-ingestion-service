import { LEVELS, type Level } from "../types/log.js";
import { aggregateLogs, type AggregateFilters } from "../repositories/aggregate.js";

// قوائم بيضاء صارمة: قيم المستخدم بتتحوّل لقيم إحنا كاتبينها.
// هيك مستحيل يوصل نص من المستخدم للاستعلام.
const BUCKETS: Record<string, string> = {
  "1m": "1 minute",
  "5m": "5 minutes",
  "1h": "1 hour",
  "1d": "1 day",
};

const GROUP_COLUMNS: Record<string, string> = {
  service: "service",
  level: "level",
};

export type ParseResult =
  | { ok: true; filters: AggregateFilters }
  | { ok: false; error: string };

function parseIso(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function parseAggregateParams(
  qs: Record<string, string | undefined>
): ParseResult {
  // هون since/until/bucket إجبارية — بعكس GET /logs.
  if (!qs.since || !qs.until || !qs.bucket) {
    return { ok: false, error: "'since', 'until', and 'bucket' are required" };
  }

  const since = parseIso(qs.since);
  if (!since) return { ok: false, error: "invalid 'since' timestamp" };
  const until = parseIso(qs.until);
  if (!until) return { ok: false, error: "invalid 'until' timestamp" };
  if (until < since) {
    return { ok: false, error: "'until' must not be earlier than 'since'" };
  }

  const interval = BUCKETS[qs.bucket];
  if (!interval) {
    return {
      ok: false,
      error: `bucket must be one of: ${Object.keys(BUCKETS).join(", ")}`,
    };
  }

  const filters: AggregateFilters = { since, until, interval, attrs: [] };

  if (qs.group_by !== undefined) {
    const col = GROUP_COLUMNS[qs.group_by];
    if (!col) return { ok: false, error: "group_by must be 'service' or 'level'" };
    filters.groupColumn = col;
  }

  if (qs.service !== undefined) filters.service = qs.service;

  if (qs.level !== undefined) {
    if (!LEVELS.includes(qs.level as Level)) {
      return { ok: false, error: `unsupported level: '${qs.level}'` };
    }
    filters.level = qs.level;
  }

  if (qs.q !== undefined) filters.q = qs.q;

  for (const [param, value] of Object.entries(qs)) {
    if (!param.startsWith("attr.") || value === undefined) continue;
    const key = param.slice(5);
    if (key.length === 0) return { ok: false, error: "empty attribute key" };
    filters.attrs.push({ key, value });
  }

  return { ok: true, filters };
}

export async function runAggregate(filters: AggregateFilters) {
  const rows = await aggregateLogs(filters);
  return {
    buckets: rows.map((r) => ({
      start: r.start.toISOString(),
      group: r.grp,          // null لما ما في group_by، حسب المواصفات
      count: Number(r.count),
    })),
  };
}