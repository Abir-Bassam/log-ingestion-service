import { pool } from "../db/pool.js";

// معايير البحث بعد ما تنفحص بالـ service.
export interface QueryFilters {
  service?: string;
  level?: string;
  since?: string;
  until?: string;
  q?: string;
  attrs: { key: string; value: string }[];
  limit: number;
  cursor?: { ts: string; id: string };
}

export interface LogRow {
  id: string;
  ts: Date;
  level: string;
  service: string;
  message: string;
  attributes: Record<string, unknown> | null;
}

// بناء الاستعلام ديناميكياً حسب الفلاتر الموجودة.
//
// قاعدة أمان صارمة: بنية الاستعلام (أسماء الأعمدة، العمليات) إحنا
// كاتبينها بأنفسنا. كل قيمة جاية من المستخدم بتنحط كـ parameter
// ($1, $2...) — أبداً ما بتنحقن بالنص. هيك SQL injection مستحيل.
export async function queryLogs(f: QueryFilters): Promise<LogRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  // مساعد صغير: بياخد قيمة، بيضيفها للمعاملات، وبيرجّع رمزها ($n).
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (f.service !== undefined) where.push(`service = ${bind(f.service)}`);
  if (f.level !== undefined) where.push(`level = ${bind(f.level)}`);
  if (f.since !== undefined) where.push(`ts >= ${bind(f.since)}`);
  if (f.until !== undefined) where.push(`ts < ${bind(f.until)}`);

  if (f.q !== undefined) {
    // بحث نصّي جزئي غير حسّاس لحالة الأحرف. بنهرّب رموز LIKE
    // الخاصة (% و _) عشان تنطابق حرفياً لو المستخدم كتبها.
    const escaped = f.q.replace(/([%_\\])/g, "\\$1");
    where.push(`message ILIKE ${bind(`%${escaped}%`)}`);
  }

  // فلاتر الخصائص: attr.<key>=<value>، أي عدد منها، دايماً كنصوص.
  for (const { key, value } of f.attrs) {
    where.push(`attributes ->> ${bind(key)} = ${bind(value)}`);
  }

  // استكمال من موقع الصفحة السابقة. المقارنة بصفّ كامل (ts, id)
  // بتضل تستفيد من الفهرس.
  if (f.cursor) {
    where.push(`(ts, id) < (${bind(f.cursor.ts)}, ${bind(f.cursor.id)})`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  // بنجيب صف زيادة: لو رجع، معناه في صفحة تانية.
  const { rows } = await pool.query<LogRow>(
    `SELECT id, ts, level, service, message, attributes
       FROM logs
       ${whereSql}
      ORDER BY ts DESC, id DESC
      LIMIT ${f.limit + 1}`,
    params
  );

  return rows;
}