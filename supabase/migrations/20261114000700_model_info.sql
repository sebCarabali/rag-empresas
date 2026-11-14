-- =====================================================================
-- Modelo que generó cada respuesta (Gemini o el respaldo en Groq) y el
-- motivo del cambio, para mostrarlo en el chat.
-- =====================================================================

alter table public.messages add column model_info jsonb;
alter table public.answer_cache add column model_info jsonb;
