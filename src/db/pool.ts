// ملف للاتصال بقاعدة البيانات مع بوستجر
// بدل ماكل مرة نفتح اتصال جديد مع قاعدة البيانات و يوخذ وقت و يصير بطئ 
// بفتح عدة اتصالات جاهزة مرة وحدة و كل طلب بوخذ اتصال و لما يخلص برجعه
import pg from "pg";
import { config } from "../config/index.js";

const { Pool } = pg;

// بوول اتصالات وحدة نستخدمها بكل التطبيق حطّينا الحد الأقصى 10
// اتصالات التطبيق عنده نص معالج بس، فلو فتحنا اتصالات
// أكثر رح يقفوا بالطابور جوّا بوستجر بدون فايدة.
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

//  فحص بسيط بنستخدمه بالهيلث بنسأل القاعدة سؤال تافه سيليكت واحد
// وإذا ردّت، معناها الاتصال شغّال. بنرجّع true/false.
export async function isDatabaseReady(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}


// اسم الـ partition ليوم معيّن، مثلاً logs_p20260808 ليوم 2026-08-08.
function partitionName(day: Date): string {
  const y = day.getUTCFullYear();
  const m = String(day.getUTCMonth() + 1).padStart(2, "0");
  const d = String(day.getUTCDate()).padStart(2, "0");
  return `logs_p${y}${m}${d}`;
}

// بترجّع منتصف الليل (بداية اليوم) بتوقيت UTC لأي وقت.
function utcMidnight(t: Date): Date {
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
}

// بتتأكد إنه في partition لكل يوم بنافذة الاستبقاء + يومين مستقبل.
// اليومين المستقبل مهمين: ال logs ممكن تجي بوقت لحد ٥ دقايق قدّام،
// وكمان عشان ما يصير سباق عند منتصف الليل (يجي log ليوم لسا partition-ه
// مش جاهز).
export async function ensurePartitions(retentionDays: number): Promise<void> {
  const today = utcMidnight(new Date());
  // من (اليوم - مدة الاستبقاء) لحد (اليوم + يومين).
  for (let offset = -retentionDays; offset <= 2; offset++) {
    const day = new Date(today.getTime() + offset * 86_400_000); // 86400000 = مللي ثانية باليوم
    const next = new Date(day.getTime() + 86_400_000);
    const name = partitionName(day);
    // الأسماء ما بتنحط كبراميتر بالاس كيو ال بس إحنا مولّدين الاسم
    // من أرقام بأنفسنا (مش إدخال مستخدم)، فآمن نحطه مباشرة.
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF logs
         FOR VALUES FROM ('${day.toISOString()}') TO ('${next.toISOString()}')`
    );
  }
}