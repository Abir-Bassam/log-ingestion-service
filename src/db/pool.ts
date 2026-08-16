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
  max: 20,
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

// حذف الأجزاء الأقدم من نافذة الاستبقاء.
//
// إسقاط partition عملية metadata بحتة: ما في حذف صف صف، ولا دَين
// vacuum، والاستقبال بالكاد بيحس فيها. هاد بالظبط سبب اختيارنا
// التقسيم بالتاريخ من البداية.
export async function dropExpiredPartitions(retentionDays: number): Promise<void> {
  const cutoff = new Date(
    utcMidnight(new Date()).getTime() - retentionDays * 86_400_000
  );

  // بنجيب أسماء كل الأجزاء اليومية تبعت جدول logs.
  const { rows } = await pool.query<{ relname: string }>(
    `SELECT c.relname
       FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'logs' AND c.relname ~ '^logs_p[0-9]{8}$'`
  );

  for (const { relname } of rows) {
    // بنستخرج التاريخ من اسم الجزء: logs_p20260701 → 2026-07-01
    const digits = relname.slice(6);
    const day = new Date(
      Date.UTC(
        Number(digits.slice(0, 4)),
        Number(digits.slice(4, 6)) - 1,
        Number(digits.slice(6, 8))
      )
    );
    if (day < cutoff) {
      await pool.query(`DROP TABLE IF EXISTS ${relname}`);
      console.log(`retention: dropped ${relname}`);
    }
  }

  // الجزء الاحتياطي (logs_default) بياخد حذف عادي — هو بس بيمسك
  // الشوارد، فحجمه صغير ومش مشكلة.
  await pool.query(`DELETE FROM logs_default WHERE ts < $1`, [cutoff]);
}

// مهمة الصيانة: بتشتغل مرة عند الإقلاع وبعدها كل ساعة.
export function startRetentionJob(retentionDays: number): void {
  const tick = async () => {
    try {
      await ensurePartitions(retentionDays);      // اعملي أجزاء الأيام الجديدة
      await dropExpiredPartitions(retentionDays); // احذفي القديمة
    } catch (err) {
      // خطأ بالصيانة ما يوقّف الخدمة أبداً — بنسجّله وبنكمّل.
      console.error("retention job failed:", err);
    }
  };
  void tick();
  // unref() بتخلّي المؤقّت ما يمنع العملية من الإغلاق.
  setInterval(tick, 60 * 60 * 1000).unref();
}