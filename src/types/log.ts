// الأنواع المشتركة للوغ بمكان واحد عشان باقي الملفات تستوردها.

// المستويات المسموحة — الأربعة بس. `as const` بتخلّيها قيم ثابتة
// نقدر نشتق منها نوع.
export const LEVELS = ["debug", "info", "warn", "error"] as const;

// نوع مشتق من المصفوفة فوق: "debug" | "info" | "warn" | "error".
export type Level = (typeof LEVELS)[number];

// شكل اللوغ انتري بعد ما يجتاز الفحص بنجاح (نسخة نظيفة ومضمونة).
export interface ValidLogEntry {
  timestamp: string; // نص ISO موحّد
  level: Level;
  service: string;
  message: string;
  attributes: Record<string, string | number | boolean> | null;
}

// نتيجة الفحص: إما نجح (ومعه الانتري النظيف)، أو فشل (ومعه السبب).
export type EntryResult =
  | { ok: true; entry: ValidLogEntry }
  | { ok: false; reason: string };