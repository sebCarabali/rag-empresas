import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfig } from './infrastructure/config/app-config';

/** Crea y configura la app HTTP (compartido entre desarrollo local y Vercel). */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(AppConfig);

  // La configuración pública del widget la pide widget.js desde el sitio de la
  // empresa (cualquier dominio). El resto de la API solo acepta la app web.
  const PUBLIC_WIDGET_CONFIG = /^\/widget\/[^/]+\/config\/?(\?.*)?$/;
  app.enableCors((req: { url?: string; method?: string }, callback: (err: Error | null, options: object) => void) => {
    const isPublicConfig = PUBLIC_WIDGET_CONFIG.test(req.url ?? '') && ['GET', 'OPTIONS'].includes(req.method ?? '');
    callback(null, {
      origin: isPublicConfig ? '*' : config.webOrigins,
      methods: isPublicConfig ? ['GET', 'OPTIONS'] : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Widget-Token'],
      maxAge: 86400,
    });
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
  return app;
}
