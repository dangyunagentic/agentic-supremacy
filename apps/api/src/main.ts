import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');
  // Auth uses a Bearer header (not cookies), so credentials are not needed.
  // Reflect-reflect CORS (`origin: true`) echoes any origin and is unsafe with
  // credentialed requests — replace with an explicit allowlist.
  const allowedOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    credentials: false,
  });

  // Rate limiting keys off `req.ip`. Trust proxy defaults to OFF (safe for
  // direct exposure — X-Forwarded-For cannot be spoofed). When a reverse proxy
  // (Caddy) is placed in front, set TRUST_PROXY to the proxy's subnet allowlist
  // (e.g. "172.16.0.0/12") so the real client IP is used WITHOUT letting direct
  // clients forge X-Forwarded-For. Never use `true` or a bare hop count.
  const trustProxy = (process.env.TRUST_PROXY ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (trustProxy.length > 0) {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.set('trust proxy', trustProxy);
  }
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);
  new Logger('Bootstrap').log(`API listening on ${host}:${port}`);
}

void bootstrap();
