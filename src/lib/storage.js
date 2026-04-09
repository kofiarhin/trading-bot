import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  await fs.mkdir(directoryPath, { recursive: true });
  return directoryPath;
}

export async function ensureJsonFile(filePath, fallbackValue) {
  await ensureDir(path.dirname(filePath));

  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(fallbackValue, null, 2));
  }

  return filePath;
}

export async function readJson(filePath, fallbackValue) {
  await ensureJsonFile(filePath, fallbackValue);

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (!raw.trim()) {
      return cloneFallback(fallbackValue);
    }

    return JSON.parse(raw);
  } catch {
    return cloneFallback(fallbackValue);
  }
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
  return value;
}

export async function appendJsonArray(filePath, item) {
  const data = await readJson(filePath, []);
  data.push(item);
  await writeJson(filePath, data);
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
