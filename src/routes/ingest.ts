import type { FastifyInstance } from "fastify";
import { ingestBatch } from "../services/ingest.js";
import { requireAuth } from "../middleware/auth.js";

// شكل الجسم المتوقّع: { "logs": [...] }
interface IngestBody {
  logs?: unknown;
}

export function registerIngest(app: FastifyInstance): void {
  // preHandler بينفّذ قبل المعالِج. لما المصادقة مطفية (الافتراضي)
  // بيخرج فوراً بدون أي فحص، فالسلوك بيضل زي الخدمة المفتوحة تماماً.
  app.post<{ Body: IngestBody }>(
    "/logs",
    { preHandler: requireAuth },
    async (req, reply) => {
      const body = req.body;

      // فحص الشكل العام للجسم. (Fastify بيرجّع 400 لوحده لو الـ JSON
      // نفسه مكسور.)
      if (typeof body !== "object" || body === null || !Array.isArray(body.logs)) {
        return reply
          .code(400)
          .send({ error: 'request body must be { "logs": [...] }' });
      }

      const result = await ingestBatch(body.logs);

      // لو كل الـ entries اترفضت (أو المصفوفة فاضية) → 400.
      if (result.accepted === 0) {
        return reply.code(400).send({ accepted: 0, rejected: result.rejected });
      }

      // في مقبول واحد على الأقل → 200، مع تفاصيل المقبول والمرفوض.
      return reply
        .code(200)
        .send({ accepted: result.accepted, rejected: result.rejected });
    }
  );
}