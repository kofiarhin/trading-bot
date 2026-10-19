// Trade lifecycle statuses.
//
//   pending → open → closing → (archived as closed)
//
// "closing" means an exit order was accepted by the broker but has not filled
// yet. The position still exists, so it still counts for risk, duplicates and
// the protection gate.
export const ACTIVE_TRADE_STATUSES = Object.freeze(['pending', 'open', 'closing']);

export function isActiveTradeStatus(status) {
  return ACTIVE_TRADE_STATUSES.includes(status);
}

// Consecutive failed exit attempts before an "exit_failing" alert is raised.
export const EXIT_FAILURE_ALERT_THRESHOLD = 3;
