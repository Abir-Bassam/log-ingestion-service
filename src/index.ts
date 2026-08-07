import Fastify from "fastify";
import { config } from "./config/index.js";

const app = Fastify({ logger: false });

app.get("/health", async (_req, reply) => {
  return reply.code(200).send({ status: "ok" });
});

app.listen({ port: config.port, host: "0.0.0.0" })
  .then(() => console.log(`listening on :${config.port}`));