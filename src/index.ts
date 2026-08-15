import Fastify from "fastify";
import { config } from "./config/index.js";
import { isDatabaseReady, pool, startRetentionJob } from "./db/pool.js";
import { runMigrations } from "./db/migrations.js";
import { registerIngest } from "./routes/ingest.js";
import { registerQuery } from "./routes/query.js";
import { registerAggregate } from "./routes/aggregate.js";
import { seedLoadgenKey, authEnabled } from "./middleware/auth.js";

const app = Fastify({ logger: false });

// /health دايماً بدون مصادقة — المولّد بيسأله قبل ما يكون عنده مفتاح.
app.get("/health", async (_req, reply) => {
  const dbReady = await isDatabaseReady();
  if (!dbReady) {
    return reply.code(503).send({ status: "database not ready" });
  }
  return reply.code(200).send({ status: "ok" });
});

// ترتيب الإقلاع مهم: ننتظر القاعدة → migrations → زرع المفتاح →
// الصيانة → نفتح المنفذ. هيك أول ما /health يرجّع 200، كل شي جاهز فعلاً.
async function start(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (err) {
      if (attempt >= 30) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  await runMigrations();
  // نزرع مفتاح المولّد قبل ما نقول إننا جاهزين، حسب المواصفات.
  if (authEnabled()) await seedLoadgenKey();
  startRetentionJob(config.retentionDays);

  registerIngest(app);
  registerQuery(app);
  registerAggregate(app);

  app.setErrorHandler((err: { statusCode?: number }, _req, reply) => {
    if (err.statusCode === 400) {
      return reply.code(400).send({ error: "malformed JSON body" });
    }
    console.error(err);
    return reply.code(500).send({ error: "internal server error" });
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`listening on :${config.port} (auth=${authEnabled()})`);
}

start().catch((err) => {
  console.error("fatal startup error:", err);
  process.exit(1);
});