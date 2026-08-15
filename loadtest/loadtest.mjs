// مولّد حمل شامل: بيقيس الاستقبال، الاستعلام والتجميع أثناء الاستقبال،
// زمن ظهور البيانات الجديدة، والطلبات الفاشلة.

const BASE = process.env.BASE ?? "http://localhost:8080";
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 500);
const TOTAL = Number(process.env.TOTAL ?? 100_000);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8);

// شكل البيانات المولّدة — موثّق بالـ README تحت "Dataset shape".
const SERVICES = ["checkout", "auth", "search", "payments"];
const LEVELS = ["debug", "info", "warn", "error"];
const REGIONS = ["eu-west", "us-east", "ap-south"];
const USER_IDS = 10_000;

// عدّادات عامة للطلبات الفاشلة (المواصفات بتطلب: لا طلبات مفقودة).
const counters = { ingestOk: 0, ingestFail: 0, queryOk: 0, queryFail: 0, aggOk: 0, aggFail: 0 };

function makeBatch(size) {
  const logs = new Array(size);
  const now = Date.now();
  for (let i = 0; i < size; i++) {
    logs[i] = {
      timestamp: new Date(now - Math.floor(Math.random() * 3_600_000)).toISOString(),
      level: LEVELS[Math.floor(Math.random() * LEVELS.length)],
      service: SERVICES[Math.floor(Math.random() * SERVICES.length)],
      message: `request processed id=${Math.floor(Math.random() * 1e6)} status=${Math.random() > 0.9 ? "declined" : "ok"}`,
      attributes: {
        user_id: String(Math.floor(Math.random() * USER_IDS)),
        region: REGIONS[Math.floor(Math.random() * REGIONS.length)],
        retries: Math.floor(Math.random() * 4),
      },
    };
  }
  return { logs };
}

async function sendBatch() {
  try {
    const res = await fetch(`${BASE}/logs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeBatch(BATCH_SIZE)),
    });
    if (!res.ok) { counters.ingestFail++; return; }
    await res.json();
    counters.ingestOk++;
  } catch {
    counters.ingestFail++;   // انقطاع اتصال = طلب مفقود
  }
}

const pct = (arr, p) =>
  arr.length ? arr.slice().sort((a, b) => a - b)[Math.floor((arr.length - 1) * p)].toFixed(0) : "n/a";

// قياس زمن ظهور البيانات الجديدة: بنبعت log بعلامة فريدة، وبنسأل عنه
// كل نص ثانية لحد ما يظهر. المواصفات بتطلب < 20 ثانية.
async function measureVisibilityLag() {
  const marker = `visibility-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const t0 = performance.now();

  await fetch(`${BASE}/logs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      logs: [{
        timestamp: new Date().toISOString(),
        level: "info",
        service: "probe",
        message: marker,
      }],
    }),
  });

  for (let i = 0; i < 60; i++) {          // بحد أقصى ٣٠ ثانية
    const res = await fetch(`${BASE}/logs?service=probe&q=${encodeURIComponent(marker)}&limit=1`);
    const body = await res.json();
    if (body.logs?.length > 0) return performance.now() - t0;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;   // ما ظهر بالوقت المسموح
}

// الحمل الرئيسي: استقبال + استعلام + تجميع، كلهم بنفس الوقت.
// هيك بنقيس الأداء تحت الضغط الحقيقي زي ما المواصفات بتطلب.
async function runCombinedLoad() {
  const batches = Math.ceil(TOTAL / BATCH_SIZE);
  console.log(`ingesting ${TOTAL} logs in ${batches} batches of ${BATCH_SIZE}`);
  console.log(`(queries and aggregations run concurrently during ingestion)\n`);

  const queryTimings = [];
  const aggTimings = [];
  let running = true;
  const start = Date.now();

  // عمّال الاستقبال
  let sent = 0;
  const ingestWorkers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const mine = sent++;
      if (mine >= batches) break;
      await sendBatch();
    }
  });

  // استعلام كل ٢٠٠ms (≈ 5 استعلامات بالثانية) أثناء الاستقبال
  const queryLoop = (async () => {
    while (running) {
      const t0 = performance.now();
      try {
        const res = await fetch(`${BASE}/logs?service=checkout&level=error&limit=100`);
        await res.json();
        queryTimings.push(performance.now() - t0);
        counters.queryOk++;
      } catch { counters.queryFail++; }
      await new Promise((r) => setTimeout(r, 200));
    }
  })();

  // تجميع كل ثانية — المواصفات بتطلب دعم طلب تجميع واحد بالثانية
  const aggLoop = (async () => {
    while (running) {
      const until = new Date().toISOString();
      const since = new Date(Date.now() - 3_600_000).toISOString();
      const t0 = performance.now();
      try {
        const res = await fetch(
          `${BASE}/logs/aggregate?since=${since}&until=${until}&bucket=1m&group_by=service`
        );
        await res.json();
        aggTimings.push(performance.now() - t0);
        counters.aggOk++;
      } catch { counters.aggFail++; }
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();

  await Promise.all(ingestWorkers);
  running = false;
  await Promise.all([queryLoop, aggLoop]);

  const seconds = (Date.now() - start) / 1000;
  const ingestRate = Math.round(TOTAL / seconds);
  const queryRate = (counters.queryOk / seconds).toFixed(1);
  const aggRate = (counters.aggOk / seconds).toFixed(1);

  console.log(`=== INGESTION (with concurrent read load) ===`);
  console.log(`total:        ${TOTAL} logs`);
  console.log(`duration:     ${seconds.toFixed(1)}s`);
  console.log(`rate:         ${ingestRate} logs/sec`);
  console.log(`batches ok:   ${counters.ingestOk}`);
  console.log(`batches FAIL: ${counters.ingestFail}`);

  console.log(`\n=== QUERY (during ingestion) ===`);
  console.log(`requests:     ${counters.queryOk} (${queryRate}/sec), failed: ${counters.queryFail}`);
  console.log(`p50: ${pct(queryTimings, 0.5)}ms | p95: ${pct(queryTimings, 0.95)}ms | max: ${pct(queryTimings, 1)}ms`);

  console.log(`\n=== AGGREGATION (during ingestion) ===`);
  console.log(`requests:     ${counters.aggOk} (${aggRate}/sec), failed: ${counters.aggFail}`);
  console.log(`p50: ${pct(aggTimings, 0.5)}ms | p95: ${pct(aggTimings, 0.95)}ms | max: ${pct(aggTimings, 1)}ms`);
}

// قياس بدون ضغط، للمقارنة
async function measureIdle(label, url, runs = 20) {
  const timings = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const res = await fetch(url);
    await res.json();
    timings.push(performance.now() - t0);
  }
  console.log(`\n=== ${label} (idle, ${runs} runs) ===`);
  console.log(`p50: ${pct(timings, 0.5)}ms | p95: ${pct(timings, 0.95)}ms`);
}

await runCombinedLoad();

const until = new Date().toISOString();
const since = new Date(Date.now() - 3_600_000).toISOString();
await measureIdle("QUERY", `${BASE}/logs?service=checkout&level=error&limit=100`);
await measureIdle("QUERY q= substring", `${BASE}/logs?q=declined&limit=100`);
await measureIdle("QUERY attr filter", `${BASE}/logs?attr.region=eu-west&limit=100`);
await measureIdle("AGGREGATION", `${BASE}/logs/aggregate?since=${since}&until=${until}&bucket=1m&group_by=service`);

const lag = await measureVisibilityLag();
console.log(`\n=== VISIBILITY LAG ===`);
console.log(lag === null ? `NOT VISIBLE within 30s` : `newly ingested log queryable after ${lag.toFixed(0)}ms`);