// فحص كل اللوغ انتري لحاله
// مكتوب بإيدنا عشان الرسائل تكون
// دقيقة والأداء تحت السيطرة هاد بينفّذ لكل لوغ بكل دفعة

import { LEVELS, type Level, type ValidLogEntry, type EntryResult } from "../types/log.js";

// فحص شكل ISO-8601 قبل ما نسلّم ل 
// Date. Date.parse
//  لحاله متساهل جداً
// (بيقبل "2026" أو "Jul 20")، فبنتحقّق من الشكل بـ regex أول.
const ISO_RE =
  /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:?\d{2})?$/;

// أقصى تسامح للمستقبل: ٥ دقايق (بالمللي ثانية).
const FUTURE_SKEW_MS = 5 * 60 * 1000;

export function validateEntry(raw: unknown): EntryResult {
  // لازم يكون كائن (object)، مش null ولا مصفوفة.
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "entry must be an object" };
  }
  const e = raw as Record<string, unknown>;

  // /timestamp
  if (e.timestamp === undefined || e.timestamp === null) {
    return { ok: false, reason: "missing required field: timestamp" };
  }
  if (typeof e.timestamp !== "string" || !ISO_RE.test(e.timestamp)) {
    return { ok: false, reason: `invalid timestamp: ${JSON.stringify(e.timestamp)}` };
  }
  const ms = Date.parse(e.timestamp);
  if (Number.isNaN(ms)) {
    return { ok: false, reason: `invalid timestamp: ${JSON.stringify(e.timestamp)}` };
  }
  if (ms > Date.now() + FUTURE_SKEW_MS) {
    return { ok: false, reason: "timestamp is more than five minutes in the future" };
  }

  // /level
  if (e.level === undefined || e.level === null) {
    return { ok: false, reason: "missing required field: level" };
  }
  if (typeof e.level !== "string" || !LEVELS.includes(e.level as Level)) {
    return { ok: false, reason: `invalid level: '${String(e.level)}'` };
  }

  // /service / message: نصوص غير فاضية
  if (typeof e.service !== "string" || e.service.length === 0) {
    return { ok: false, reason: "service must be a non-empty string" };
  }
  if (typeof e.message !== "string" || e.message.length === 0) {
    return { ok: false, reason: "message must be a non-empty string" };
  }

  // / attributes: اختيارية، مسطّحة، قيم بسيطة بس
  let attributes: ValidLogEntry["attributes"] = null;
  if (e.attributes !== undefined && e.attributes !== null) {
    if (typeof e.attributes !== "object" || Array.isArray(e.attributes)) {
      return { ok: false, reason: "attributes must be a flat object" };
    }
    for (const [key, value] of Object.entries(e.attributes)) {
      const t = typeof value;
      // لا كائنات متداخلة ولا مصفوفات — قيم بسيطة بس.
      if (t !== "string" && t !== "number" && t !== "boolean") {
        return {
          ok: false,
          reason: `attribute '${key}' must be a string, number, or boolean`,
        };
      }
    }
    attributes = e.attributes as ValidLogEntry["attributes"];
  }

  // نجح كل شي → بنرجّع نسخة نظيفة، مع توحيد ال timestamp لـ ISO.
  return {
    ok: true,
    entry: {
      timestamp: new Date(ms).toISOString(),
      level: e.level as Level,
      service: e.service,
      message: e.message,
      attributes,
    },
  };
}