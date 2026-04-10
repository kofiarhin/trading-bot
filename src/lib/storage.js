import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  appendStoragePath,
  readStoragePath,
  writeStoragePath,
} from '../repos/storageRepo.mongo.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(currentDirectory, '..', '..');
export const storageRoot = path.join(projectRoot, 'storage');

function cloneFallback(value) {
  return JSON.parse(JSON.stringify(value));
}

export function nowIso() {
  return new Date().toISOString();
}

export function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function getStoragePath(...segments) {
  return path.join(storageRoot, ...segments);
}

export function getDailyStoragePath(namespace, date = new Date()) {
  return getStoragePath(namespace, `${dateKey(date)}.json`);
}

export async function ensureDir(directoryPath) {
  return directoryPath;
}

export async function ensureJsonFile(filePath, fallbackValue) {
  return filePath;
}

export async function readJson(filePath, fallbackValue) {
  try {
    const data = await readStoragePath(filePath, fallbackValue);
    return data == null ? cloneFallback(fallbackValue) : data;
  } catch {
    return cloneFallback(fallbackValue);
  }
}

export async function writeJson(filePath, value) {
  await writeStoragePath(filePath, value);
  return value;
}

export async function appendJsonArray(filePath, item) {
  await appendStoragePath(filePath, item);
  return item;
}

export async function appendDailyRecord(namespace, item, date = new Date()) {
  return appendJsonArray(getDailyStoragePath(namespace, date), item);
}

export function sortByTimestampDescending(items, timestampKey = 'timestamp') {
  return [...items].sort((left, right) => {
    const leftValue = new Date(left?.[timestampKey] ?? 0).getTime();
    const rightValue = new Date(right?.[timestampKey] ?? 0).getTime();
    return rightValue - leftValue;
  });
}

export async function appendLogEvent(type, payload = {}, date = new Date()) {
  const record = {
    id: payload.id ?? `${type}-${Date.now()}`,
    type,
    timestamp: payload.timestamp ?? nowIso(),
    ...payload,
  };

  await appendDailyRecord('logs', record, date);
  return record;
}
