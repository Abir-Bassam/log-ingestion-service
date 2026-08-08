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