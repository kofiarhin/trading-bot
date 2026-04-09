import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

import {
  normalizeTradePayloadForRead,
  normalizeTradePayloadForStorage,
  shouldNormalizeTradeFile,
} from './normalizeTrade.js';

const INSTALL_FLAG = Symbol.for('trading-bot.trade-storage-compat.installed');

function getEncoding(options) {
  if (typeof options === 'string') {
    return options;
  }

  if (options && typeof options === 'object' && typeof options.encoding === 'string') {
    return options.encoding;
  }

  return null;
}

function detectIndent(text) {
  const match = text.match(/^[\t ]+(?=\S)/m);
  return match?.[0] ?? '  ';
}

function preserveTrailingNewline(originalText, nextText) {
  return originalText.endsWith('\n') && !nextText.endsWith('\n')
    ? `${nextText}\n`
    : nextText;
}

function decodePayload(payload) {
  if (typeof payload === 'string') {
    return { text: payload, asBuffer: false };
  }

  if (Buffer.isBuffer(payload)) {
    return { text: payload.toString('utf8'), asBuffer: true };
  }

  return { text: null, asBuffer: false };
}

function encodePayload(nextText, asBuffer) {
  return asBuffer ? Buffer.from(nextText, 'utf8') : nextText;
}

function tryNormalizeSerializedPayload(filePath, payload, direction) {
  if (!shouldNormalizeTradeFile(filePath)) {
    return payload;
  }

  const { text, asBuffer } = decodePayload(payload);

  if (text === null) {
    return payload;
  }

  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    return payload;
  }

  const normalizedPayload =
    direction === 'read'
      ? normalizeTradePayloadForRead(parsed)
      : normalizeTradePayloadForStorage(parsed);

  const nextText = preserveTrailingNewline(
    text,
    JSON.stringify(normalizedPayload, null, detectIndent(text))
  );

  if (nextText === text) {
    return payload;
  }

  return encodePayload(nextText, asBuffer);
}

if (!globalThis[INSTALL_FLAG]) {
  globalThis[INSTALL_FLAG] = true;

  const originalReadFileSync = fs.readFileSync.bind(fs);
  const originalWriteFileSync = fs.writeFileSync.bind(fs);
  const originalReadFile = fs.readFile.bind(fs);
  const originalWriteFile = fs.writeFile.bind(fs);
  const originalPromisesReadFile = fs.promises.readFile.bind(fs.promises);
  const originalPromisesWriteFile = fs.promises.writeFile.bind(fs.promises);

  fs.readFileSync = function patchedReadFileSync(filePath, options) {
    const output = originalReadFileSync(filePath, options);
    const encoding = getEncoding(options);
    const normalized = tryNormalizeSerializedPayload(filePath, output, 'read');

    if (typeof output === 'string' || encoding) {
      return typeof normalized === 'string' ? normalized : normalized.toString(encoding ?? 'utf8');
    }

    return normalized;
  };

  fs.writeFileSync = function patchedWriteFileSync(filePath, data, options) {
    const normalized = tryNormalizeSerializedPayload(filePath, data, 'write');
    return originalWriteFileSync(filePath, normalized, options);
  };

  fs.readFile = function patchedReadFile(filePath, options, callback) {
    let resolvedOptions = options;
    let resolvedCallback = callback;

    if (typeof options === 'function') {
      resolvedCallback = options;
      resolvedOptions = undefined;
    }

    return originalReadFile(filePath, resolvedOptions, (error, output) => {
      if (error) {
        resolvedCallback(error);
        return;
      }

      try {
        const encoding = getEncoding(resolvedOptions);
        const normalized = tryNormalizeSerializedPayload(filePath, output, 'read');

        if (typeof output === 'string' || encoding) {
          resolvedCallback(
            null,
            typeof normalized === 'string'
              ? normalized
              : normalized.toString(encoding ?? 'utf8')
          );
          return;
        }

        resolvedCallback(null, normalized);
      } catch (normalizationError) {
        resolvedCallback(normalizationError);
      }
    });
  };

  fs.writeFile = function patchedWriteFile(filePath, data, options, callback) {
    let resolvedOptions = options;
    let resolvedCallback = callback;

    if (typeof options === 'function') {
      resolvedCallback = options;
      resolvedOptions = undefined;
    }

    try {
      const normalized = tryNormalizeSerializedPayload(filePath, data, 'write');
      return originalWriteFile(filePath, normalized, resolvedOptions, resolvedCallback);
    } catch (normalizationError) {
      resolvedCallback(normalizationError);
      return undefined;
    }
  };

  fs.promises.readFile = async function patchedPromisesReadFile(filePath, options) {
    const output = await originalPromisesReadFile(filePath, options);
    const encoding = getEncoding(options);
    const normalized = tryNormalizeSerializedPayload(filePath, output, 'read');

    if (typeof output === 'string' || encoding) {
      return typeof normalized === 'string' ? normalized : normalized.toString(encoding ?? 'utf8');
    }

    return normalized;
  };

  fs.promises.writeFile = async function patchedPromisesWriteFile(filePath, data, options) {
    const normalized = tryNormalizeSerializedPayload(filePath, data, 'write');
    return originalPromisesWriteFile(filePath, normalized, options);
  };

  syncBuiltinESMExports();
}

export default true;
