export const CYCLE_STAGES = {
  STARTING: 'starting',
  SYNCING_BROKER: 'syncing_broker',
  MONITORING_POSITIONS: 'monitoring_positions',
  FETCHING_MARKET_DATA: 'fetching_market_data',
  EVALUATING_SIGNALS: 'evaluating_signals',
  APPLYING_RISK_GUARDS: 'applying_risk_guards',
  PLACING_ORDERS: 'placing_orders',
  FINAL_SYNC: 'final_sync',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export const ORDERED_CYCLE_STAGES = [
  CYCLE_STAGES.STARTING,
  CYCLE_STAGES.SYNCING_BROKER,
  CYCLE_STAGES.MONITORING_POSITIONS,
  CYCLE_STAGES.FETCHING_MARKET_DATA,
  CYCLE_STAGES.EVALUATING_SIGNALS,
  CYCLE_STAGES.APPLYING_RISK_GUARDS,
  CYCLE_STAGES.PLACING_ORDERS,
  CYCLE_STAGES.FINAL_SYNC,
  CYCLE_STAGES.COMPLETED,
];

export function stageToProgress(stage) {
  if (stage === CYCLE_STAGES.FAILED) return 100;
  const index = ORDERED_CYCLE_STAGES.indexOf(stage);
  if (index === -1) return 0;
  return Math.round((index / (ORDERED_CYCLE_STAGES.length - 1)) * 100);
}
