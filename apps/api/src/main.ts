import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import compression = require("compression");
import { json, urlencoded } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const express = app.getHttpAdapter().getInstance() as { set?: (key: string, value: unknown) => void };
  express.set?.("trust proxy", 1);
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: false
    })
  );
  app.use(compression());
  app.use(json({ limit: config.get<string>("JSON_BODY_LIMIT", "25mb") }));
  app.use(urlencoded({ extended: true, limit: config.get<string>("FORM_BODY_LIMIT", "25mb") }));
  app.enableCors({
    origin: allowedOrigins(config),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Accept"],
    maxAge: 86400
  });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );
  app.enableShutdownHooks();
  await app.listen(config.get<number>("PORT", 4000));
}

void bootstrap();

function allowedOrigins(config: ConfigService) {
  const configured = splitCsv(config.get<string>("CORS_ORIGINS"));
  return configured.length > 0 ? configured : true;
}

function splitCsv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is string => part.length > 0);
}

