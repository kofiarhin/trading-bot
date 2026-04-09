import { randomUUID } from 'node:crypto';

import { isDryRunEnabled, submitOrder } from '../lib/alpaca.js';

function toNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function roundPrice(value) {
  return Number(toNumber(value, 0).toFixed(2));
}

export function buildOrderPayload(decision) {
  const quantity = Math.max(1, Math.floor(toNumber(decision.qty ?? decision.quantity, 1)));
  const payload = {
    symbol: decision.symbol,
    qty: String(quantity),
    side: decision.side ?? 'buy',
    type: 'market',
    time_in_force: 'day',
    client_order_id: (decision.clientOrderId ?? `decision-${decision.id ?? randomUUID()}`).slice(0, 48),
  };

  if (decision.stop && decision.target) {
    payload.order_class = 'bracket';
    payload.take_profit = {
      limit_price: roundPrice(decision.target),
    };
    payload.stop_loss = {
      stop_price: roundPrice(decision.stop),
    };
  }

  return payload;
}

export async function placeOrder(decision, options = {}) {
  if (!decision?.symbol) {
    return {
      placed: false,
      dryRun: false,
      message: 'Decision missing symbol',
    };
  }

  if (!decision.approved) {
    return {
      placed: false,
      dryRun: false,
      message: 'Decision not approved',
    };
  }

  if (isDryRunEnabled(options)) {
    return {
      placed: false,
      dryRun: true,
      order: buildOrderPayload(decision),
      message: 'Dry-run mode prevented order submission',
    };
  }

  const orderPayload = buildOrderPayload(decision);
  const order = await submitOrder(orderPayload);

  return {
    placed: true,
    dryRun: false,
    order,
    orderPayload,
  };
}

export default placeOrder;
