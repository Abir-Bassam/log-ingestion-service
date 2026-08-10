// بدل ما نفتح المنفذ على طول صار عندي دالة ستارت بتستنى القاعدة تفتح و بعدين بتطبق الماجريشن و بعدها بس بتفتح البورت 
// هيك ما برجع 200 الا بعد ما تكون الجداول جاهزة فعلا 
// 200 = health
import Fastify from "fastify";
import { config } from "./config/index.js";
import { isDatabaseReady, pool, ensurePartitions, startRetentionJob } from "./db/pool.js";
import { runMigrations } from "./db/migrations.js";
import { registerIngest } from "./routes/ingest.js";
import { registerQuery } from "./routes/query.js";
import { registerAggregate } from "./routes/aggregate.js";

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
  startRetentionJob(config.retentionDays);  // بتعمل الأجزاء + بتحذف القديمة، وبتتكرّر كل ساعة
    
 registerIngest(app);
 registerQuery(app);
 registerAggregate(app);

 
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`listening on :${config.port}`);
}

start().catch((err) => {
  console.error("fatal startup error:", err);
  process.exit(1);
});