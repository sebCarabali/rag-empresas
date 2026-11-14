import { createApp } from './bootstrap';

/** Servidor para desarrollo local: `pnpm dev:api`. En Vercel se usa serverless.ts. */
async function main() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`API escuchando en http://localhost:${port}`);
}

void main();
