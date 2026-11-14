// Vercel Function privada: consumidor de Vercel Queues (topic "document-ingestion").
// No tiene URL pública; solo la invoca la infraestructura de colas (ver vercel.json).
const { getIngestionConsumer } = require('../../dist/worker');

module.exports = async (req, res) => {
  const consume = await getIngestionConsumer();
  return consume(req, res);
};
