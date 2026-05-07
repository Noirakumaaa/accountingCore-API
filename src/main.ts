import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware.js';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { isLocalUrl, isProductionMode } from './config/runtime-env.js';

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

function parseOrigins(raw?: string): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (origin): origin is string => typeof origin === 'string',
      );
    }
    return typeof parsed === 'string' ? [parsed] : [];
  } catch {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

const allowedOrigins = new Set(
  [
    ...parseOrigins(process.env.CORS_ORIGIN),
    process.env.FRONTEND_URL,
    'https://solvercore.solverous.com',
    'https://solvecore.solverous.com',
    'http://localhost:7000',
  ].filter((o): o is string => Boolean(o)),
);

const allowLocalCorsOrigins =
  !isProductionMode() ||
  isLocalUrl(process.env.FRONTEND_URL) ||
  isLocalUrl(process.env.BACKEND_URL);

const isAllowedCorsOrigin = (origin: string): boolean => {
  return (
    allowedOrigins.has(origin) || (allowLocalCorsOrigins && isLocalUrl(origin))
  );
};

const corsOrigin = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean | string) => void,
) => {
  if (!origin) {
    callback(null, true);
    return;
  }

  if (isAllowedCorsOrigin(origin)) {
    callback(null, origin);
    return;
  }

  callback(new Error(`CORS origin not allowed: ${origin}`), false);
};

async function bootstrap() {
  getRequiredEnv('DATABASE_URL');
  getRequiredEnv('JWT_SECRET');
  getRequiredEnv('JWT_REFRESH_SECRET');

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(helmet());
  app.use(cookieParser());
  app.use(RequestLoggerMiddleware);

  app.enableCors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());

  if (!isProductionMode()) {
    const config = new DocumentBuilder()
      .setTitle('SolveCore API')
      .setDescription('Payroll & HR management API')
      .setVersion('1.0')
      .addCookieAuth('access_token')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(process.env.PORT ?? 9001);
}
void bootstrap();
