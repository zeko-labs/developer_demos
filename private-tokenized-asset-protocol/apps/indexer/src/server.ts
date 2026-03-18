import express from 'express';

const app = express();
const port = Number(process.env.INDEXER_PORT || 7002);

app.get('/health', (_req, res) => {
  res.json({ service: 'indexer', status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/events', (_req, res) => {
  res.json({
    data: [
      { id: 'evt_idx_1', type: 'mint', blockHeight: 0 },
      { id: 'evt_idx_2', type: 'transfer', blockHeight: 0 }
    ]
  });
});

app.listen(port, () => {
  console.log(`indexer listening on http://localhost:${port}`);
});
