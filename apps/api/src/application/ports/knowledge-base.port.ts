import type { ExtraContext, RetrievedChunk, Source } from '../../domain/chat/prompt';
import type { ToolDeclaration, ToolExecutor } from '../../domain/llm/llm';
import type { DataScope } from './data-scope';

export interface CatalogToolCall {
  name: string;
  args: Record<string, unknown>;
  total: number | null;
  summary: string;
  error?: string;
}

/** Herramientas del catálogo para el modelo, ligadas a una pregunta. */
export interface CatalogTools {
  declarations: ToolDeclaration[];
  instructions: string;
  /** Ejecuta una herramienta; agrega fuentes y deja constancia de la llamada. */
  createExecutor(sources: Source[], calls: CatalogToolCall[]): ToolExecutor;
}

export interface WebDescription extends ExtraContext {
  field: string;
  value: string;
  sources: Array<{ title: string; url: string }>;
}

/** Puerto de salida: lo que el asistente sabe de un proyecto, leído dentro de un ámbito de datos. */
export interface KnowledgeBase {
  searchChunks(params: { projectId: string; question: string; embedding: number[]; embeddingModel: string; limit: number }): Promise<RetrievedChunk[]>;
  /** Versión del contenido (documentos y descripciones web): cambia cuando cambia lo que se sabe. */
  contentVersion(projectId: string): Promise<string>;
  /** Términos distintivos del catálogo (para no confundir preguntas parecidas). */
  catalogVocabulary(projectId: string, version: string): Promise<Set<string>>;
  webDescriptions(projectId: string, question: string, chunks: RetrievedChunk[]): Promise<WebDescription[]>;
  catalogTools(projectId: string): Promise<CatalogTools | null>;
}

/** Fábrica de KnowledgeBase por ámbito de datos (Abstract Factory). */
export interface KnowledgeBaseFactory {
  forScope(scope: DataScope): KnowledgeBase;
}

export const KNOWLEDGE_BASE_FACTORY = Symbol('KNOWLEDGE_BASE_FACTORY');
