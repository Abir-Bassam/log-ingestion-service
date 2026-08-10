import { validateEntry } from "./validation.js";
import { insertLogs } from "../repositories/logs.js";
import type { ValidLogEntry } from "../types/log.js";

// نتيجة معالجة دفعة: كم انقبل، وشو اترفض (مع السبب والفهرس).
export interface IngestResult {
  accepted: number;
  rejected: { index: number; reason: string }[];
}

// بتعالج دفعة لوغ تفحص كل انتري تفرز، وتخزّن المقبول بس
//
// سلوك الدفعة المطلوب انتري غلط ما يفشّل الدفعة كلها بنقبل
// الصالح بنرفض الفاسد وبنرجّع لكل مرفوض فهرسه وسببه
export async function ingestBatch(rawLogs: unknown[]): Promise<IngestResult> {
  const accepted: ValidLogEntry[] = [];
  const rejected: { index: number; reason: string }[] = [];

  rawLogs.forEach((raw, index) => {
    const result = validateEntry(raw);
    if (result.ok) {
      accepted.push(result.entry);
    } else {
      rejected.push({ index, reason: result.reason });
    }
  });

  // بنخزّن المقبول بس (لو في مقبول أصلاً).
  await insertLogs(accepted);

  return { accepted: accepted.length, rejected };
}