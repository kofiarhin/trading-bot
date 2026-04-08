// Simple structured console logger.
// All output goes to stdout/stderr with ISO timestamps.

function ts() {
  return new Date().toISOString();
}

function fmt(level, message, meta) {
  const base = `[${ts()}] [${level}] ${message}`;
  if (meta && Object.keys(meta).length) {
    return `${base} ${JSON.stringify(meta)}`;
  }
  return base;
}

export const logger = {
  info(message, meta = {}) {
    console.log(fmt("INFO ", message, meta));
  },
  warn(message, meta = {}) {
    console.warn(fmt("WARN ", message, meta));
  },
  error(message, meta = {}) {
    console.error(fmt("ERROR", message, meta));
  },
  debug(message, meta = {}) {
    if (process.env.DEBUG === "true") {
      console.log(fmt("DEBUG", message, meta));
    }
  },
};
