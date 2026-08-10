/*
import Fastify from "fastify";
import { config } from "./config/index.js";
// بنستورد الاعدادات طبعا جافا لانه بدنا نترجمه 

const app = Fastify({ logger: false });// بننشا نسخة من السيرفر و ماي طبع سجل لكل طلب لانه رح يكون تحت ضغط و رح يقلل الاداء
// بدنا نعرف الاندبوينت ال4
app.get("/health", async (_req, reply) => {//بيستقبل طلبات من نوع جت و من مسار هيلث
    // _req معناها مش رح نستخدمه   
  return reply.code(200).send({ status: "ok" });
});

app.listen({ port: config.port, host: "0.0.0.0" })// بيشغل السيرفر على المنفذ من الاعدادات اللي عمناها 
// الهوست عشان ضروري داخل الدوكر عشان الحاوية تكون موصولة من برا
  .then(() => console.log(`listening on :${config.port}`));// طباعة رسالة تاكيد لما السيرفر يشتغل بنجاح
*/
/*
import Fastify from "fastify";
import { config } from "./config/index.js"; // بنستورد الاعدادات طبعا جافا لانه بدنا نترجمه 
import { isDatabaseReady } from "./db/pool.js";

const app = Fastify({ logger: false });

// health endpoint:
//المولّد بيسأله قبل ما يبعت أي لوغ عشان يتأكد
// إنه الخدمة جاهزة فعلاً. لهيك ما بنكتفي ب "السيرفر شغّال" 
// بنتأكد كمان إنه الاتصال بقاعدة البيانات ثابت.
app.get("/health", async (_req, reply) => {
  const dbReady = await isDatabaseReady();
  if (!dbReady) {
    return reply.code(503).send({ status: "database not ready" });
  }
  return reply.code(200).send({ status: "ok" });
});

app.listen({ port: config.port, host: "0.0.0.0" })
  .then(() => console.log(`listening on :${config.port}`));
  */

// بدل ما نفتح المنفذ على طول صار عندي دالة ستارت بتستنى القاعدة تفتح و بعدين بتطبق الماجريشن و بعدها بس بتفتح البورت 
// هيك ما برجع 200 الا بعد ما تكون الجداول جاهزة فعلا 
// 200 = health
import Fastify from "fastify";
import { config } from "./config/index.js";
import { isDatabaseReady, pool, ensurePartitions } from "./db/pool.js";
import { runMigrations } from "./db/migrations.js";
import { registerIngest } from "./routes/ingest.js";

const app = Fastify({ logger: false });

app.get("/health", async (_req, reply) => {
  const dbReady = await isDatabaseReady();
  if (!dbReady) {
    return reply.code(503).send({ status: "database not ready" });
  }
  return reply.code(200).send({ status: "ok" });
});

// ترتيب الإقلاع مهم: ننتظر القاعدة → نطبّق الـ migrations → نفتح المنفذ.
// هيك أول ما /health يرجّع 200، معناه فعلاً الجداول جاهزة.
async function start(): Promise<void> {
  // ننتظر القاعدة تجهز.
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (err) {
      if (attempt >= 30) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  await runMigrations();     // السكيم               
  await ensurePartitions(config.retentionDays);  // الاجزاء اليومية
  
  
  registerIngest(app);
  
  
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`listening on :${config.port}`);
}

start().catch((err) => {
  console.error("fatal startup error:", err);
  process.exit(1);
});