import { api } from '../lib/api.js';

export const cycleService = {
  getRuntime: () => api.get('/cycle/runtime').then((r) => r.data),
  runCycle: () => api.post('/cycle/run').then((r) => r.data),
  manualRunCycle: () => api.post('/cycle/manual-run').then((r) => r.data),
};
