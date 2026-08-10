import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db/pool.js";

// مصادقة اختيارية، حسب عقد مولّد الحمل:
//  * AUTH_ENABLED افتراضياً false → الخدمة مفتوحة تماماً، وأي
//    Authorization header بينتجاهل ولا بينرفض أبداً.
//  * لما تنفعّل، LOADGEN_API_KEY بينزرع عند الإقلاع بشكل idempotent،
//    قبل ما الخدمة تقول إنها جاهزة.
//  * /health دايماً بدون مصادقة.

export const authEnabled = (): boolean =>
  (process.env.AUTH_ENABLED ?? "false").toLowerCase() === "true";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// زرع المفتاح: آمن يتكرّر كل إقلاع، وإعادة التشغيل ما بتبطّله.
export async function seedLoadgenKey(): Promise<void> {
  const key = process.env.LOADGEN_API_KEY;
  if (!key) return; // مسموح: auth مفعّل بدون مفتاح مزروع
  await pool.query(
    `INSERT INTO api_keys (key_hash, scopes)
     VALUES ($1, '{ingest,query}')
     ON CONFLICT (key_hash) DO NOTHING`,
    [sha256(key)]
  );
}

// حارس بينفّذ قبل معالِج الطلب.
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // ⚠️ أهم سطر بالملف: لما المصادقة مطفية، بنخرج فوراً بدون أي
  // فحص. أي Authorization header بينتجاهل تماماً.
  if (!authEnabled()) return;

  let key: string | undefined;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    key = header.slice(7).trim();
  } else if (typeof req.headers["x-api-key"] === "string") {
    key = req.headers["x-api-key"].trim();
  }

  if (!key) {
    await reply.code(401).send({ error: "missing or malformed credential" });
    return;
  }

  const hash = sha256(key);
  const { rows } = await pool.query<{ key_hash: string }>(
    "SELECT key_hash FROM api_keys WHERE key_hash = $1",
    [hash]
  );
  const row = rows[0];
  // مقارنة بزمن ثابت — بتمنع استنتاج المفتاح من فروقات التوقيت.
  const valid =
    row !== undefined &&
    timingSafeEqual(Buffer.from(row.key_hash), Buffer.from(hash));

  if (!valid) {
    await reply.code(401).send({ error: "invalid credential" });
  }
}