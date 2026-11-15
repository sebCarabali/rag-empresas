import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/auth.guard';

@Controller()
export class HealthController {
  /** La raíz no es una página: indica que es la API y dónde está la app. */
  @Public()
  @Get()
  root() {
    return {
      name: 'rag-empresas-api',
      status: 'ok',
      message: 'Esta es la API. La aplicación web está en el frontend (WEB_ORIGIN).',
      app: process.env.WEB_ORIGIN?.split(',')[0]?.trim() || null,
    };
  }

  @Public()
  @Get('health')
  health() {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
