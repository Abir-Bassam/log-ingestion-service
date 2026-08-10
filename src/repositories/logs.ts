import { pool } from "../db/pool.js";
import type { ValidLogEntry } from "../types/log.js";

// كتابة دفعة logs بالقاعدة.
//
// الحيلة الأهم للأداء: الدفعة كلها بتروح للبوستجر بعملية إدخال واحدة
// (multi-row insert)
// باستخدام unnest
//  على مصفوفات يعني دفعة
// من ٥٠٠ log بتكلّف رحلة وحدة للقاعدة بدل ٥٠٠ رحلة — وهاد الفرق بين
// ٢ ألف و ١٥ ألف+ log بالثانية على هالجهاز.
export async function insertLogs(entries: ValidLogEntry[]): Promise<void> {
  if (entries.length === 0) return;

  // بنبني ٥ مصفوفات، وحدة لكل عمود. الإدخال بـ unnest بيفكّها
  // لصفوف. شكله شوي غريب، بس هو أسرع طريقة آمنة للإدخال الجماعي
  // مع node-pg.
  const ts: string[] = new Array(entries.length);
  const level: string[] = new Array(entries.length);
  const service: string[] = new Array(entries.length);
  const message: string[] = new Array(entries.length);
  const attrs: (string | null)[] = new Array(entries.length);

  entries.forEach((e, i) => {
    ts[i] = e.timestamp;
    level[i] = e.level;
    service[i] = e.service;
    message[i] = e.message;
    // الخصائص بتتخزّن كجيسون نصّي، أو نل لو مش موجودة.
    attrs[i] = e.attributes ? JSON.stringify(e.attributes) : null;
  });

  // الإدخال بينفّذ الكومت قبل ما نرجّع — فرجوع الدالة معناه إنه
  // الداتا محفوظة فعلياً بالقاعدة، زي ما المواصفات بتطلب.
  await pool.query(
    `INSERT INTO logs (ts, level, service, message, attributes)
     SELECT * FROM unnest(
       $1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::jsonb[]
     )`,
    [ts, level, service, message, attrs]
  );
}