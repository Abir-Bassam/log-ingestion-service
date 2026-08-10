import type { FastifyInstance } from "fastify";
import { ingestBatch } from "../services/ingest.js";

// شكل الجسم المتوقّع: { "logs": [...] }
interface IngestBody {
  logs?: unknown;
}

export function registerIngest(app: FastifyInstance): void {
  app.post<{ Body: IngestBody }>("/logs", async (req, reply) => {
    const body = req.body;

    // فحص الشكل العام للجسم. 
    // (Fastify بيرجّع 400 لوحده 
    //لو الجيسون نفسه مكسور 

    if (typeof body !== "object" || body === null || !Array.isArray(body.logs)) {
      return reply
        .code(400)
        .send({ error: 'request body must be { "logs": [...] }' });
    }

    const result = await ingestBatch(body.logs);

    // لو كلهم انرفضو او الجسم شكله غلط برجع 400
    if (result.accepted === 0) {
      return reply.code(400).send({ accepted: 0, rejected: result.rejected });
    }
    // لو انقبل واحد ع الاقل برجع 200
    return reply
      .code(200)
      .send({ accepted: result.accepted, rejected: result.rejected });
  });
}