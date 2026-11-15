import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApplicationModule } from './composition/application.module';
import { IngestionQueueService } from './infrastructure/queue/ingestion-queue.service';
import { CoreModule } from './composition/core.module';

/** Módulo mínimo del worker: sin controladores HTTP, solo los servicios de ingesta. */
@Module({ imports: [CoreModule, ApplicationModule] })
class WorkerModule {}

type NodeConsumer = ReturnType<IngestionQueueService['createNodeConsumer']>;

let consumerPromise: Promise<NodeConsumer> | null = null;

/**
 * Contexto de Nest (inyección de dependencias sin servidor HTTP) para la
 * función que consume la cola. Se crea una vez por instancia.
 */
export function getIngestionConsumer(): Promise<NodeConsumer> {
  if (!consumerPromise) {
    consumerPromise = (async () => {
      const ctx = await NestFactory.createApplicationContext(WorkerModule, {
        logger: ['log', 'warn', 'error'],
      });
      return ctx.get(IngestionQueueService).createNodeConsumer();
    })().catch((err) => {
      consumerPromise = null;
      throw err;
    });
  }
  return consumerPromise;
}
