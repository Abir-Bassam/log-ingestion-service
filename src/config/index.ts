export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? "",
  retentionDays: Number(process.env.RETENTION_DAYS ?? 30),
};