import type { FastifyInstance } from "fastify";
import { parseQueryParams, runQuery } from "../services/query.js";

export function registerQuery(app: FastifyInstance): void {
  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/logs",
    async (req, reply) => {
      const parsed = parseQueryParams(req.query);
      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error });
      }
      const result = await runQuery(parsed.filters);
      return reply.send(result);
    }
  );
}