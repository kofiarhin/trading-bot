// LEGACY SERVER ENTRY — used only by the deprecated npm run trade / npm run trade:dry scripts.
// The active server is src/server/index.js (npm run server / npm run dev).
// This file does NOT connect to MongoDB explicitly and reads decisions/logs
// through the lib/storage.js bridge (which routes to MongoDB via storageRepo.mongo.js).
// Do not add new features here.  New server work belongs in src/server/.
import 'dotenv/config';

import express from 'express';

import { getPositions } from './lib/alpaca.js';
import { getDailyStoragePath, readJson, sortByTimestampDescending } from './lib/storage.js';
import {
  getClosedTrades,
  getOpenTrades,
  getTradeEvents,
  mergeBrokerPositionsWithJournal,
} from './journal/tradeJournal.js';

const port = Number(process.env.PORT ?? 5000);

function createCorsMiddleware() {
  return (request, response, next) => {
    response.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
      response.status(204).end();
      return;
    }

    next();
  };
}

async function loadDailyDecisions(date) {
  return readJson(getDailyStoragePath('decisions', date), []);
}

async function loadDailyLogs(date) {
  return readJson(getDailyStoragePath('logs', date), []);
}

async function buildActivityFeed() {
  const [logs, decisions, tradeEvents] = await Promise.all([
    loadDailyLogs(new Date()),
    loadDailyDecisions(new Date()),
    getTradeEvents(),
  ]);

  const decisionEvents = decisions.map((decision) => ({
    id: `decision-${decision.id}`,
    type: decision.approved ? 'decision_approved' : 'decision_rejected',
    timestamp: decision.timestamp,
    symbol: decision.symbol,
    strategy: decision.strategy,
    decisionId: decision.id,
    metrics: {
      close: decision.close,
      breakoutLevel: decision.breakoutLevel,
      atr: decision.atr,
      volumeRatio: decision.volumeRatio,
      distanceToBreakoutPct: decision.distanceToBreakoutPct,
    },
  }));

  return sortByTimestampDescending([...logs, ...decisionEvents, ...tradeEvents]).slice(0, 200);
}

async function buildDashboardPayload() {
  const [brokerPositions, openTrades, closedTrades, tradeEvents, decisions, activity] = await Promise.all([
    getPositions().catch(() => []),
    getOpenTrades(),
    getClosedTrades(),
    getTradeEvents(),
    loadDailyDecisions(new Date()),
    buildActivityFeed(),
  ]);

  const positions = await mergeBrokerPositionsWithJournal(brokerPositions);

  return {
    positions,
    trades: {
      open: openTrades,
      closed: closedTrades,
      events: tradeEvents,
    },
    decisions: sortByTimestampDescending(decisions),
    activity,
  };
}

export function createApp() {
  const app = express();

  app.use(createCorsMiddleware());
  app.use(express.json());

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });

  app.get(['/api/positions', '/api/open-positions'], async (_request, response, next) => {
    try {
      const brokerPositions = await getPositions().catch(() => []);
      const positions = await mergeBrokerPositionsWithJournal(brokerPositions);
      response.json(positions);
    } catch (error) {
      next(error);
    }
  });

  app.get(['/api/trades/open', '/api/journal/open'], async (_request, response, next) => {
    try {
      response.json(await getOpenTrades());
    } catch (error) {
      next(error);
    }
  });

  app.get(['/api/trades/closed', '/api/journal/closed'], async (_request, response, next) => {
    try {
      response.json(await getClosedTrades());
    } catch (error) {
      next(error);
    }
  });

  app.get(['/api/trades/events', '/api/journal/events'], async (_request, response, next) => {
    try {
      response.json(await getTradeEvents());
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/journal', async (_request, response, next) => {
    try {
      response.json({
        open: await getOpenTrades(),
        closed: await getClosedTrades(),
        events: await getTradeEvents(),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get(['/api/decisions', '/api/signals'], async (_request, response, next) => {
    try {
      response.json(sortByTimestampDescending(await loadDailyDecisions(new Date())));
    } catch (error) {
      next(error);
    }
  });

  app.get(['/api/activity', '/api/feed'], async (_request, response, next) => {
    try {
      response.json(await buildActivityFeed());
    } catch (error) {
      next(error);
    }
  });

  app.get(['/api/dashboard', '/api/status'], async (_request, response, next) => {
    try {
      response.json(await buildDashboardPayload());
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown server error',
    });
  });

  return app;
}

export function startServer() {
  const app = createApp();
  return app.listen(port, () => {
    console.log(`API listening on ${port}`);
  });
}

export default createApp;

const executedFile = process.argv[1]?.replace(/\\/g, '/');
if (executedFile?.endsWith('/src/index.js')) {
  startServer();
}
