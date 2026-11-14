// Vercel Function: toda la API HTTP de NestJS.
// `pnpm build` compila src/ a dist/ antes de empaquetar esta función.
const { getHttpHandler } = require('../dist/serverless');

module.exports = async (req, res) => {
  const handler = await getHttpHandler();
  return handler(req, res);
};
