// Entry point: `npm run dev` / `npm start`.
import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`CivicFix API listening on http://localhost:${config.port} (${config.env})`);
});

// Close cleanly on Ctrl+C or when the host stops the container.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
  });
}
