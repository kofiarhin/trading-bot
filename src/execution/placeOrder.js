// Compatibility wrapper — all execution flows through orderManager.
// This file exists only for legacy callers; do not add new logic here.
import { placeOrder as _placeOrder } from './orderManager.js';

export async function placeOrder(...args) {
  return _placeOrder(...args);
}

export default async function legacyPlaceOrder(...args) {
  return _placeOrder(...args);
}
