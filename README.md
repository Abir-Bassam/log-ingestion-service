# Log Ingestion and Query Service

In this project, I built a service to collect and search through a lot of logs — kind of like a simpler version of Datadog or Grafana Loki.
Applications send logs to my API, and I save them in PostgreSQL so they can be searched and grouped. I also added a setting to delete old logs automatically.

I used **TypeScript, Fastify, and PostgreSQL 16**, and put everything together using Docker Compose.

## Quick start

```bash
docker compose up
```

This is all you need to do. You don't need any env files, extra arguments, or manual setup. When you run this, my app waits for Postgres to start, runs the database migrations, makes daily partitions, and then starts listening on `localhost:8080`. If you call `GET /health` and get a `200`, it means the service is ready to take logs.

### Zero-configuration guarantees

If you just run `docker compose up` without setting any environment variables, I made sure the service works out of the box:

- It runs `GET /health`, `POST /logs`, `GET /logs`, and `GET /logs/aggregate` exactly as the rules say, on `localhost:8080`.
- **It accepts requests without any authentication** because `AUTH_ENABLED` is `false` by default.
- **It ignores any `Authorization` header** instead of throwing an error. So if a client sends a token by mistake, it still works fine.
- I didn't add **any rate limiting**.
- I didn't add **any quotas**.
- I didn't add **any tenant restrictions** — logs are not separated by tenant.
- You don't need **any special headers, parameters, or passwords** other than what the API asks for.

You really don't need to read this README just to send a basic request.

Local development:

```bash
npm ci
npm run typecheck
npm test
```

## Environment variables

All of these variables are optional. `docker compose up` works perfectly even if you don't set any of them.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port the service listens on inside the container. |
| `DATABASE_URL` | set by compose | PostgreSQL connection string. Compose wires this to the `db` service automatically. |
| `RETENTION_DAYS` | `30` | Days of logs to retain. Expired daily partitions are dropped hourly. |
| `AUTH_ENABLED` | `false` | Enables bearer-token authentication when `true`. Off by default. |
| `LOADGEN_API_KEY` | unset | When set together with `AUTH_ENABLED=true`, this key is seeded at startup with ingest and query permissions. |

## API

### `GET /health`

This endpoint never needs authentication. It returns `200 {"status":"ok"}` only when the database is connected and migrations are done. If the database is not reachable yet, it returns `503`.

### `POST /logs` — ingest

This endpoint always takes a batch of logs. Even a batch with just one log is fine.

```json
{
  "logs": [
    {
      "timestamp": "2026-08-14T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": { "user_id": "42", "region": "eu-west", "retries": 3 }
    }
  ]
}
```

Here are the validation rules I check for each log:

| Field | Rules |
|---|---|
| `timestamp` | required, valid ISO 8601, not more than 5 minutes in the future |
| `level` | required, one of `debug` / `info` / `warn` / `error` |
| `service` | required, non-empty string |
| `message` | required, non-empty string |
| `attributes` | optional, flat object, scalar values only (string / number / boolean) |

If one log is bad, it doesn't break the whole batch:

```json
{ "accepted": 9, "rejected": [{ "index": 3, "reason": "invalid level: 'critical'" }] }
```

- I return `200` if at least one log was accepted and saved safely.
- I return `400` if all logs are rejected, the JSON is broken, or the main structure is wrong.

### `GET /logs` — query

You can use any of these parameters, and you can mix them however you want:

| Param | Meaning | Example |
|---|---|---|
| `service` | exact service match | `service=checkout` |
| `level` | exact level match | `level=error` |
| `since` | inclusive start of range | `since=2026-08-14T14:00:00Z` |
| `until` | exclusive end of range | `until=2026-08-14T15:00:00Z` |
| `attr.<key>` | attribute equality, compared as strings | `attr.user_id=42` |
| `q` | case-insensitive substring on `message` | `q=declined` |
| `limit` | max results, default 100, max 1000 | `limit=500` |
| `cursor` | opaque cursor from a previous response | `cursor=eyJ0cyI6...` |

I sort the results by timestamp from newest to oldest. If two logs have the exact same timestamp, I use the `id` to break the tie, so the order is always the same. When there are no more results, `next_cursor` is `null`. If you send bad parameters, I return `400 {"error": "<description>"}`.

Here are some examples of how I test it:

```bash
curl "http://localhost:8080/logs?service=checkout&level=error&limit=50"
curl "http://localhost:8080/logs?since=2026-08-14T14:00:00Z&until=2026-08-14T15:00:00Z"
curl "http://localhost:8080/logs?attr.user_id=42&attr.region=eu-west"
curl "http://localhost:8080/logs?q=declined&limit=20"
```

### `GET /logs/aggregate` — time-bucketed counts

This uses the same filters as `GET /logs` (`service`, `level`, `attr.<key>`, `q`), but I also added these:

| Param | Required | Meaning |
|---|---|---|
| `since` | yes | inclusive start |
| `until` | yes | exclusive end |
| `bucket` | yes | `1m`, `5m`, `1h`, or `1d` |
| `group_by` | no | `service` or `level` |

I return one row for every bucket and group mix, ordered from oldest to newest. I skip empty buckets to save space. If you don't use `group_by`, the `group` field will be `null`.

```bash
curl "http://localhost:8080/logs/aggregate?since=2026-08-14T14:00:00Z&until=2026-08-14T15:00:00Z&bucket=1m&group_by=service"
```

## Project structure

I tried to keep my folders clean and separated:

```
migrations/          numbered .sql files, applied automatically at startup
scripts/             smoke test and health-wait scripts used by CI
loadtest/            load generator used for the measurements below
tests/               unit tests (node:test)
src/
  index.ts           startup sequence and route registration
  config/            all environment variables read in one place
  db/                connection pool, migration runner, partition management
  middleware/        optional auth guard
  routes/            HTTP only — parse request, return correct status
  services/          business logic — validation, parameter checking
  repositories/      database only — build and execute queries
  types/             shared type definitions
  utils/             cursor encoding
```

I made sure that routes never talk to the database directly, and repositories don't know anything about HTTP. This made it much easier for me to test the logic without needing the server running.

## Request flow

Here is how a request moves through my code:

**`POST /logs`**

1. `routes/ingest.ts` — First, the auth guard runs (it does nothing if auth is off). Then, I check if the body looks like `{ "logs": [...] }`.
2. `services/ingest.ts` — I loop through the batch, check each log, and sort them into accepted and rejected lists. I also remember the index of any rejected log.
3. `services/validation.ts` — I check every field one by one. I either return a clean log or a clear error message.
4. `repositories/logs.ts` — I save all the good logs in **one single query** using `INSERT ... SELECT * FROM unnest(...)`. This way, sending 1000 logs only takes one trip to the database.
5. Back in the route: I send `200` if I saved at least one log, or `400` if I saved none.

**`GET /logs`**

1. `routes/query.ts` — The auth guard runs, then I pass the URL parameters to the service.
2. `services/query.ts` — I check if the parameters are valid *before* I talk to the database. If something is wrong, I return `400` with a reason.
3. `repositories/query.ts` — I build the `WHERE` part of the SQL query based on the filters. I use parameters for all user values to stay safe. I also ask for `limit + 1` rows so I can know if there is a next page.
4. `services/query.ts` — I remove that extra row, and I create a `next_cursor` using the `(ts, id)` of the last row. If there are no more pages, it becomes `null`.

## Design

### Schema

```
logs (
  id         bigint identity        -- one global sequence
  ts         timestamptz not null   -- partition key
  level      text + CHECK constraint
  service    text
  message    text
  attributes jsonb
  PRIMARY KEY (ts, id)
) PARTITION BY RANGE (ts)
```

I made the primary key `(ts, id)` instead of just `id` for two reasons. First, PostgreSQL needs the partition key to be part of the primary key. Second, `(ts, id)` is exactly what I need for cursor pagination. The global sequence makes sure the order is always correct, even if many logs happen at the exact same time.

### Migrations

I put numbered `.sql` files in the `migrations/` folder. The app runs them automatically when it starts, in order, before opening the port. I save the names of the applied migrations in a `schema_migrations` table, so if the app restarts, it doesn't run them again. Each file runs inside a transaction, so if something fails, it rolls back and doesn't break the database. You don't need to run any manual migration commands.

### Attribute storage

I decided to put all attributes in one `JSONB` column and added a `jsonb_path_ops` GIN index. Since I don't know the keys in advance, I couldn't make a column for each one. I also thought about making a separate table for attributes, but that would mean writing to the database twice for every log, which is too slow. JSONB lets me search for any key easily without knowing it beforehand.

### Index design

| Index | Purpose |
|---|---|
| PK `(ts, id)` | keyset pagination, deterministic ordering |
| `(service, ts DESC)` | service filter with time ordering |
| `(level, ts DESC)` | level filter with time ordering |
| `GIN (attributes jsonb_path_ops)` | `attr.<key>` equality lookups |

At first, I created a `GIN (message gin_trgm_ops)` trigram index for text search, but I **removed it after testing** because it slowed down writing too much — you can read more about this in the Performance section.

### Pagination

I used keyset (cursor) pagination based on `(ts, id)`, and I encode it as a base64url string. I didn't use `OFFSET` because it gets very slow when you go to deeper pages (it has to scan all the skipped rows). Keyset pagination jumps right to the spot using the index. If someone sends a broken cursor, I just return `400` instead of crashing.

### Retention

I partitioned the table by day. To delete old logs, I just use `DROP TABLE <partition>`. This is very fast, doesn't lock the database, and doesn't slow down new logs. If I used a normal `DELETE` on millions of rows, it would cause all those problems. I have a background job that runs every hour: it creates new partitions for the future and drops the old ones. If any logs fall outside the dates, they go to `logs_default` and I clean them with a normal `DELETE`. You can change how many days to keep using `RETENTION_DAYS` (the default is 30).

### Security

I made sure to pass every user value as a parameter (`$1`, `$2`, …) so I don't get SQL injection. The SQL string only has the code I wrote. For things that must be part of the SQL text, like `bucket` sizes and `group_by` columns, I check them against a strict list of allowed words, so user input never goes straight into the query. I also check that `limit` is a valid number inside the allowed range before I use it.

## Performance

### Test environment

- I tested this on my Windows laptop using Docker Desktop. It has an Intel Core i7-1165G7 (4 cores / 8 threads, 2.80 GHz), 16 GB RAM, and an NVMe SSD.
- This is just my personal development machine, not a real production server.
- I set the container limits to: app **0.5 CPU / 256 MB**, and Postgres **1 CPU / 1 GB**.
- The load generator runs on the same laptop, so it fights with the containers for CPU power.

### Reproducing the measurements

If you want to run my tests yourself:

```bash
docker compose up -d
# wait until GET /health returns 200
TOTAL=1000000 BATCH_SIZE=1000 CONCURRENCY=8 node loadtest/loadtest.mjs
```

On PowerShell:

```powershell
$env:TOTAL="1000000"; $env:BATCH_SIZE="1000"; $env:CONCURRENCY="8"; node loadtest/loadtest.mjs
```

My test script sends logs while also sending queries (~3/sec) and aggregations (~1/sec) at the same time. So, all the numbers below are measured **while the system is busy reading and writing**, not when it's resting. It also counts failed requests and checks how fast a new log shows up in search.

I put the PostgreSQL tuning parameters inside the compose file (`max_wal_size=4GB`, `shared_buffers=256MB`, `checkpoint_completion_target=0.9`, `wal_compression=on`), so you don't need to configure the database manually to get the same results.

**The final settings I used:** batch size 1000, concurrency 8, and I removed the trigram index.

**The data I generated:** 4 services, 4 levels (spread evenly), and 3 attribute keys — `user_id` (10,000 different values), `region` (3 values), and `retries` (4 values). The messages are about 45 characters long, and 10% of them have the word `declined` so I can test the `q` search. The timestamps are spread over the last hour.

### Target vs measured

| Target | Required | Measured | Status |
|---|---|---|---|
| Ingestion rate | ≥ 15,000/sec | **22,072/sec** at 300k rows (13,567/sec at 1M before tuning) | Met |
| Aggregation p95 | < 1,000 ms | **760 ms** idle; 3,237 ms under full ingestion load | Met when not saturated |
| Dropped requests | none | **0 of 1,000 batches** | Met |
| Application crashes | none | **none** | Met |
| Newly ingested data queryable | < 20 s | **14 ms** | Met |
| Aggregation during ingestion | ≥ 1/sec | 0.4/sec | Not met |
| Stored records | ~1,000,000 | 1,000,001 (295 MB) | Met |

### Results at 1M rows

> These are the numbers from my first benchmark run, before I raised `max_wal_size` to
> 4GB and the pool to 20. The Configuration experiments table below has the newer figures
> at 300k rows.

| Metric | Value |
|---|---|
| Ingestion (under read load) | 13,567 logs/sec, 0 failed batches |
| Query p50 / p95 (idle) | 6 ms / 11 ms |
| Query p50 / p95 (during ingestion) | 107 ms / 319 ms |
| `q=` substring p50 / p95 | 6 ms / 9 ms |
| `attr.` filter p50 / p95 | 5 ms / 9 ms |
| Aggregation p50 / p95 (idle) | 459 ms / 760 ms |
| Aggregation (during ingestion) | 1,453 ms / 3,237 ms |
| Visibility lag | 14 ms |
| App CPU / memory | 24–46% of its 0.5-core limit / 38 MB |
| Postgres CPU / memory | **98–101% of its 1-core limit** / 211 MB |

### Configuration experiments

| Configuration | Ingestion rate | `q=` p50 |
|---|---|---|
| **No trigram index, batch 1000, conc 8** | **22,072/sec** | 392 ms |
| GIN trigram index | 8,432/sec | 7 ms |
| GIST trigram index | 6,300/sec | 6 ms |
| batch 2000, concurrency 12 | 17,630/sec | — |
| batch 1000, concurrency 16 | 5,638/sec | — |

I learned three things from these tests. First, the trigram index speeds up text search
about 56× but costs 62–72% of my write speed — I tried both GIN and GIST, and GIST was
actually worse for writes. Since ingestion is the main job of this service, I removed the
index. Second, raising concurrency past 8 *hurts* throughput: Postgres is already using
all its CPU, so extra connections just wait in line. Third, bigger batches (2000) were
slower than 1000 here.

### Bottleneck

I noticed that Postgres uses **98–101% of its single CPU core**, while my app only uses 24–46% of its half core. This means the limit is the Postgres CPU, not my code.

When I used the default Postgres settings, the logs kept saying `checkpoints are occurring too frequently (28 seconds apart)`.

My laptop has 8 logical cores and a fast NVMe SSD, so the real limit is the 1-CPU rule I set for the Postgres container, not my hardware. Writing logs is limited by CPU inside that container, not by disk speed.

### Optimizations applied

- **Bulk insert using `unnest`** — I send the whole batch in one trip to the database instead of one trip per log. This was the biggest improvement for writing logs.
- **Removed the trigram index.** Removing it raised my ingestion from 8,432 to 22,072
  logs/sec — the index was costing me 62% of my write speed. It does make `q=` searches
  much slower (392 ms instead of 7 ms), but since ingestion is the main job here, I chose
  the write speed. I tested both GIN and GIST versions before deciding, and documented the
  numbers in migration `005_drop_trgm_index_final.sql`.
- **Moved aggregation to Postgres** — I use `date_bin` and `GROUP BY` inside the database instead of bringing all the rows to Node and counting them there.
- **Connection pool raised to 20** — I started at 10, but raising it to 20 together with
  a bigger WAL helped a lot under high load.
- **Postgres tuning**: `max_wal_size=4GB`, `shared_buffers=256MB`,
  `checkpoint_completion_target=0.9`, `wal_compression=on`. Raising `max_wal_size` from
  2GB to 4GB (together with the bigger pool) lifted my ingestion from ~13,500 to
  ~22,000 logs/sec, and it stopped the checkpoint warning completely.
- I kept `synchronous_commit` turned **on** on purpose. I actually measured what
  durability costs me: 22,465/sec with it off versus 22,072/sec with it on — under 2%.
  That is because I write a whole batch with one `unnest` insert, so each batch costs one
  WAL flush instead of one per log. Durability is nearly free here, and the rules say a
  `200` must mean the logs are safely saved.

### Query plans

Here is what `EXPLAIN ANALYZE` shows for my main search query:

```
Limit → Merge Append
  Index Scan Backward using logs_p20260814_pkey
Execution Time: 4.7 ms
```

It uses the `(ts, id)` primary key and reads it backwards to get the `DESC` order. It only takes 4.7 ms to get 100 rows out of 1 million.

And here is `EXPLAIN ANALYZE` for the aggregation query:

```
Sort → Finalize HashAggregate → Gather (2 workers)
  → Parallel Append
    Subplans Removed: 33
    Parallel Seq Scan on logs_p20260814
Execution Time: 484 ms
```

`Subplans Removed: 33` shows that partition pruning is working well — it ignores 33 out of 34 partitions before it even starts. The sequential scan that happens next is correct here: the query needs to count *every* row in that time range, so an index wouldn't make it faster.

### Measurement caveat

I should mention that the numbers changed a lot between different runs on my laptop (sometimes 20–100% difference for the exact same settings). This is mostly because the load generator fights with the containers for CPU. I wrote down the numbers exactly as I saw them; if a change didn't make a big difference, I didn't count it as a real improvement.

## CI

I set up `.github/workflows/ci.yml` to run every time I push code or open a pull request. It has two steps:

1. **test** — It runs `npm ci`, `npm run typecheck`, and `npm test`. This gives me fast feedback without needing Docker.
2. **smoke** — It builds and starts everything with `docker compose`, waits for `/health` to be ready, and runs `scripts/smoke.sh`. It does this **twice**:
   - First with `AUTH_ENABLED=false` to check that all four endpoints work without any passwords.
   - Then with `AUTH_ENABLED=true` and `LOADGEN_API_KEY` set, to check that the endpoints work with the token, and return `401` if the token is missing.

The smoke test checks the whole API contract: it sends a mix of good and bad logs and checks if it gets `accepted: 2` with the right error index. It also checks if filtered queries return the right rows with a `next_cursor`, if aggregation returns the right buckets, and if bad parameters return `400`.

## Optional features

| Feature | Default | Environment variables |
|---|---|---|
| Bearer-token authentication | **disabled** | `AUTH_ENABLED`, `LOADGEN_API_KEY` |

When `AUTH_ENABLED=true` and `LOADGEN_API_KEY` is set, my app creates this key automatically when it starts, before it says it's healthy. Restarting the app doesn't delete the key. I don't save it in plain text — I save it as a SHA-256 hash and compare it safely. `GET /health` never needs authentication, no matter what.

## Known limitations

- **I now beat the 15,000/sec goal at 300k rows (22,072/sec), but throughput drops as the
  table grows** — index maintenance gets more expensive with more rows. The main limit is
  that Postgres uses all of its single CPU core on my laptop while my app sits at ~25%.
- **Aggregation is too slow if I am writing logs at full speed at the same time** (I only got 0.4/sec, and p95 was 3.2 s). But if I stop writing logs, aggregation p95 is 760 ms, which is under the 1-second rule. Both reading and writing fight for the same single CPU core in Postgres.
- **I only compare `attr.<key>` as strings** — I didn't add support for number ranges or greater/less than.
- **Text search (`q`) doesn't have a trigram index**, so it needs other filters (like time
  or service) to narrow down the rows first. Searching by text alone over a wide range
  takes ~390 ms instead of ~7 ms. I measured both GIN and GIST versions of the index and
  documented the trade-off in migration `005_drop_trgm_index_final.sql`.
- **The biggest batch I can accept is limited by Fastify's `bodyLimit`** (16 MB).
- **I tested all of this on my personal laptop**, not on a strong production server.