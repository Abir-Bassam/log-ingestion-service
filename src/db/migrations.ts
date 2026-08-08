// هذا الملف عشان يشغل الماجيريشن تلقائيا اول ما التطبيق يشتغل 
// هذا الكود رح يقرا ملفات الsql
// بيشوف شو اللي اتطبق من قبل من جدول السكيم ماجريشن و بيطبق الجديد بس
// كل واحد داخل الترانزاكشن عشان لو صار خطا ما يترك القاعدة نص مبنية

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "./pool.js";

// بيشغّل ملفات الاس كيو ال بمجلد ماجريشن بالترتيب. بنسجّل شوانطبّق بجدول
// صغير، عشان لو التطبيق أعاد الإقلاع ما يعيد تشغيل نفس الماجريشن.
export async function runMigrations(dir = "migrations"): Promise<void> {
  const client = await pool.connect();
  try {
    // جدول بسيط بيتذكّر أسماء الـ migrations اللي طبّقناها.
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`
    );

    // شو انطبّق من قبل؟
    const applied = new Set(
      (await client.query("SELECT name FROM schema_migrations")).rows.map(
        (r) => r.name as string
      )
    );

    // كل ملفات .sql مرتّبة بالاسم (001, 002, ...).
    const files = (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;  // انطبّق من قبل، تجاهله

      const sql = await readFile(path.join(dir, file), "utf8");
      // كل migration بمعاملة (transaction): إما ينجح كامل أو يتراجع كامل.
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (name) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
        console.log(`migration applied: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");  // صار خطأ → تراجعي عن كل شي
        throw err;
      }
    }
  } finally {
    client.release();  // رجّعي الاتصال للبركة دايماً
  }
}