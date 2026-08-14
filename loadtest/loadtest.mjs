// مولّد حمل بسيط لقياس الاستقبال والاستعلام.
// بيشتغل بـ Node مباشرة (بدون ترجمة) — أداة تطوير مش جزء من الخدمة.

const BASE = process.env.BASE ?? "http://localhost:8080";
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 500);
const TOTAL = Number(process.env.TOTAL ?? 100_000);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8);

const SERVICES = ["checkout", "auth", "search", "payments"];
const LEVELS = ["debug", "info", "warn", "error"];

// بنولّد دفعة logs عشوائية بشكل واقعي.
function makeBatch(size) {
  const logs = new Array(size);
  const now = Date.now();
  for (let i = 0; i < size; i++) {
    logs[i] = {
      // بنوزّع الأوقات على آخر ساعة عشان يصير في تنوّع بالـ buckets
      timestamp: new Date(now - Math.floor(Math.random() * 3_600_000)).toISOString(),
      level: LEVELS[Math.floor(Math.random() * LEVELS.length)],
      service: SERVICES[Math.floor(Math.random() * SERVICES.length)],
      message: `request processed id=${Math.floor(Math.random() * 1e6)}`,
      attributes: {
        user_id: String(Math.floor(Math.random() * 10_000)),
        region: Math.random() > 0.5 ? "eu-west" : "us-east",
      },
    };
  }
  return { logs };
}

async function sendBatch() {
  const res = await fetch(`${BASE}/logs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(makeBatch(BATCH_SIZE)),
  });
  if (!res.ok) throw new Error(`ingest failed: ${res.status}`);
  await res.json();
}

// قياس الاستقبال: بنبعت دفعات بالتوازي ونحسب المعدّل.
async function measureIngestion() {
  const batches = Math.ceil(TOTAL / BATCH_SIZE);
  console.log(`ingesting ${TOTAL} logs in ${batches} batches of ${BATCH_SIZE}...`);

  const start = Date.now();
  let sent = 0;

  // بنشغّل CONCURRENCY عمّال بالتوازي، كل واحد بياخد دفعة تلو الأخرى.
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const mine = sent++;
      if (mine >= batches) break;
      await sendBatch();
    }
  });
  await Promise.all(workers);

  const seconds = (Date.now() - start) / 1000;
  const rate = Math.round(TOTAL / seconds);
  console.log(`\n=== INGESTION ===`);
  console.log(`total:    ${TOTAL} logs`);
  console.log(`duration: ${seconds.toFixed(1)}s`);
  console.log(`rate:     ${rate} logs/sec`);
  return rate;
}

// قياس زمن التجميع: بننفّذه كذا مرة ونحسب المئينات.
async function measureAggregation(runs = 20) {
  const until = new Date().toISOString();
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const url = `${BASE}/logs/aggregate?since=${since}&until=${until}&bucket=1m&group_by=service`;

  const timings = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const res = await fetch(url);
    await res.json();
    timings.push(performance.now() - t0);
  }

  timings.sort((a, b) => a - b);
  // المئين: القيمة اللي تحتها نسبة معيّنة من القياسات.
  const pct = (p) => timings[Math.floor((timings.length - 1) * p)].toFixed(0);
  console.log(`\n=== AGGREGATION (${runs} runs) ===`);
  console.log(`p50: ${pct(0.5)}ms`);
  console.log(`p95: ${pct(0.95)}ms`);
  console.log(`max: ${timings[timings.length - 1].toFixed(0)}ms`);
}

// قياس زمن الاستعلام العادي.
async function measureQuery(runs = 20) {
  const timings = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const res = await fetch(`${BASE}/logs?service=checkout&level=error&limit=100`);
    await res.json();
    timings.push(performance.now() - t0);
  }
  timings.sort((a, b) => a - b);
  const pct = (p) => timings[Math.floor((timings.length - 1) * p)].toFixed(0);
  console.log(`\n=== QUERY (${runs} runs) ===`);
  console.log(`p50: ${pct(0.5)}ms`);
  console.log(`p95: ${pct(0.95)}ms`);
}

await measureIngestion();
await measureQuery();
await measureAggregation();