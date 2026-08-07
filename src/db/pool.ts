import pg from "pg";
import { config } from "../config/index.js";

const { Pool } = pg;

// بركة اتصالات وحدة نستخدمها بكل التطبيق. حطّينا الحد الأقصى 10
// اتصالات — التطبيق عنده نص معالج (0.5 CPU) بس، فلو فتحنا اتصالات
// أكثر رح يقفوا بالطابور جوّا Postgres بدون فايدة.
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

// فحص بسيط بنستخدمه بالـ health: بنسأل القاعدة سؤال تافه (SELECT 1)
// وإذا ردّت، معناها الاتصال شغّال. بنرجّع true/false.
export async function isDatabaseReady(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}