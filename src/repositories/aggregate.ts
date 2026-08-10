import { pool } from "../db/pool.js";

export interface AggregateFilters {
  since: string;
  until: string;
  interval: string;      // فترة SQL مثل "1 minute" — من قائمة بيضاء
  groupColumn?: string;  // "service" أو "level" — من قائمة بيضاء
  service?: string;
  level?: string;
  q?: string;
  attrs: { key: string; value: string }[];
}

export interface BucketRow {
  start: Date;
  grp: string | null;
  count: string;
}

// التجميع الزمني. بننفّذه كله جوّا Postgres باستخدام date_bin:
// عدّ الصفوف بالقاعدة أرخص بكتير من جلبهم لـ Node وعدّهم — خصوصاً
// وإحنا عنا نص CPU بس.
export async function aggregateLogs(f: AggregateFilters): Promise<BucketRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  // مساعد: بياخد قيمة، بيضيفها للمعاملات، وبيرجّع رمزها ($n).
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  where.push(`ts >= ${bind(f.since)}`);
  where.push(`ts < ${bind(f.until)}`);
  if (f.service !== undefined) where.push(`service = ${bind(f.service)}`);
  if (f.level !== undefined) where.push(`level = ${bind(f.level)}`);

  if (f.q !== undefined) {
    // بنهرّب رموز LIKE الخاصة عشان تنطابق حرفياً.
    const escaped = f.q.replace(/([%_\\])/g, "\\$1");
    where.push(`message ILIKE ${bind(`%${escaped}%`)}`);
  }

  for (const { key, value } of f.attrs) {
    where.push(`attributes ->> ${bind(key)} = ${bind(value)}`);
  }

  // بنثبّت بداية السِلال على الحقبة (epoch) عشان الحدود تكون ثابتة
  // ومحاذية دايماً، مش معتمدة على وقت الطلب.
  // interval و groupColumn جايين من قائمة بيضاء بالـ service، مش من
  // المستخدم مباشرة — لهيك آمن نحطهم بالنص.
  const bucketExpr = `date_bin(interval '${f.interval}', ts, timestamptz 'epoch')`;
  const groupSelect = f.groupColumn ? `${f.groupColumn}::text` : "NULL::text";
  const groupBy = f.groupColumn ? "GROUP BY 1, 2" : "GROUP BY 1";

  const { rows } = await pool.query<BucketRow>(
    `SELECT ${bucketExpr} AS start, ${groupSelect} AS grp, count(*) AS count
       FROM logs
      WHERE ${where.join(" AND ")}
      ${groupBy}
      ORDER BY 1 ASC`,
    params
  );

  return rows;
}