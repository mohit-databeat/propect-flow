import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { loadEnv } from "./config/env";

async function bootstrap() {
  const env = loadEnv();

  const { AppModule } = await import("./app.module");
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });

  app.setGlobalPrefix(env.API_PREFIX);
  app.enableCors({ origin: env.WEB_URL, credentials: true });

  await app.listen(env.API_PORT);
  Logger.log(`API listening on http://localhost:${env.API_PORT}/${env.API_PREFIX} (AI provider: ${env.AI_PROVIDER})`, "Bootstrap");
}

bootstrap().catch((err) => {

  console.error("Failed to start API:", err instanceof Error ? err.message : err);
  process.exit(1);
});
