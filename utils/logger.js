const log = (msg, level, ...args) => {
  const prefix = `[piniafire ${level || 'info'}] `;

  const method = level === 'info' ? 'log' : level;

  console[method](prefix + msg, ...args);
}

export default {
  error(msg, ...args) {
    log(msg, 'error', ...args);
  },
  warn(msg, ...args) {
    log(msg, 'warn', ...args);
  },
  log(msg, ...args) {
    log(msg, 'info', ...args)
  }
}
