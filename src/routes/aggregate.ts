import type { FastifyInstance } from "fastify";
import { parseAggregateParams, runAggregate } from "../services/aggregate.js";

export function registerAggregate(app: FastifyInstance): void {
  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/logs/aggregate",
    async (req, reply) => {
      const parsed = parseAggregateParams(req.query);
      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error });
      }
      const result = await runAggregate(parsed.filters);
      return reply.send(result);
    }
  );
}