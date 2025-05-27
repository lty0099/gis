export const Logger = {
  info: (msg, data) => console.info(`[INFO]: ${msg}`, data || ''),
  warn: (msg, data) => console.warn(`[WARN]: ${msg}`, data || ''),
  error: (msg, data) => console.error(`[ERROR]: ${msg}`, data || ''),
};
