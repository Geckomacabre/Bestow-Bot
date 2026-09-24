import pino, { LogFn, Logger } from 'pino';

function logMethod(this: Logger, args: Parameters<LogFn>, method: LogFn) {
  if (args.length === 2) {
    args[0] = `${args[0]} %j`;
  }
  method.apply(this, args);
}

// LOG_LEVEL overrides the default (debug in dev, info in production; tests/validation stay quiet).
const level = Bun.env.LOG_LEVEL ?? (Bun.env.NODE_ENV === 'production' ? 'info' : Bun.env.NODE_ENV === 'test' ? 'warn' : 'debug');

const logger = pino({
  level,
  hooks: { logMethod },
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

export default logger;
