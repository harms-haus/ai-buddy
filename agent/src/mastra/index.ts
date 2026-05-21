import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import path from 'path';
import { fileURLToPath } from 'url';

import { kidsAgent } from './agents/kids-agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../../data/mastra.db');

export const mastra = new Mastra({
  agents: { kidsAgent },
  storage: new LibSQLStore({
    id: 'kids-agent-storage',
    url: `file:${dbPath}`,
  }),
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 4111,
    host: '0.0.0.0',
  },
});
