import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

process.env.SUPABASE_URL ??= 'https://x.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'x';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'sb_secret_test';
process.env.GEMINI_API_KEY ??= 'x';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppConfig } = require('../../config/app-config');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GeminiWebResearcher } = require('./gemini-web-researcher');

test('describe: usa Google Search, toma el texto y deduplica las fuentes', async () => {
  const service = new GeminiWebResearcher(new AppConfig());
  let request: Record<string, any> = {};
  service.client = () => ({
    models: {
      generateContent: async (req: Record<string, unknown>) => {
        request = req;
        return {
          text: ' El chalis es una tela liviana de viscosa. ',
          candidates: [
            {
              groundingMetadata: {
                webSearchQueries: ['tela chalis viscosa características'],
                groundingChunks: [
                  { web: { uri: 'https://a.com', title: 'A' } },
                  { web: { uri: 'https://a.com', title: 'A' } },
                  { web: { uri: 'https://b.com', domain: 'b.com' } },
                ],
              },
            },
          ],
        };
      },
    },
  });

  const result = await service.describe('Familia', 'Chalis', { composiciones: ['Viscosa 100%'], tipos_de_tejido: ['Plano'] }, 'k');
  assert.deepEqual(request.config.tools, [{ googleSearch: {} }]);
  assert.match(request.contents, /"Chalis"/);
  assert.match(request.contents, /Viscosa 100%/);
  assert.equal(result.description, 'El chalis es una tela liviana de viscosa.');
  assert.deepEqual(result.sources, [
    { title: 'A', url: 'https://a.com' },
    { title: 'b.com', url: 'https://b.com' },
  ]);
  assert.deepEqual(result.queries, ['tela chalis viscosa características']);
});
