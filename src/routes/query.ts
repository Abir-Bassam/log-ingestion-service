import type { FastifyInstance } from "fastify";
import { parseQueryParams, runQuery } from "../services/query.js";
import { requireAuth } from "../middleware/auth.js";

export function registerQuery(app: FastifyInstance): void {
  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/logs",
    { preHandler: requireAuth },
    async (req, reply) => {
      // بنفحص المعاملات أول — أي معامل غلط بيرجّع 400 بدل ما يوصل للقاعدة.
      const parsed = parseQueryParams(req.query);
      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error });
      }

      const result = await runQuery(parsed.filters);
      return reply.send(result);
    }
  );
}