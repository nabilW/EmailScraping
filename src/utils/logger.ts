import chalk from 'chalk';

type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'success';

const levelColor: Record<LogLevel, (message: string) => string> = {
  info: chalk.cyan,
  warn: chalk.yellow,
  error: chalk.red,
  debug: chalk.gray,
  success: chalk.green
};

const levelLabel: Record<LogLevel, string> = {
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
  debug: 'DEBUG',
  success: 'SUCCESS'
};

const isDebugEnabled = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

function log(level: LogLevel, message: string, payload?: unknown) {
  if (level === 'debug' && !isDebugEnabled) {
    return;
  }
  const colorize = levelColor[level];
  const label = levelLabel[level];
  const time = new Date().toISOString();
  if (payload !== undefined) {
    // eslint-disable-next-line no-console
    console.log(`${colorize(`[${label}]`)} ${time} ${message}`, payload);
  } else {
    // eslint-disable-next-line no-console
    console.log(`${colorize(`[${label}]`)} ${time} ${message}`);
  }
}

export const logger = {
  info: (message: string, payload?: unknown) => log('info', message, payload),
  warn: (message: string, payload?: unknown) => log('warn', message, payload),
  error: (message: string, payload?: unknown) => log('error', message, payload),
  debug: (message: string, payload?: unknown) => log('debug', message, payload),
  success: (message: string, payload?: unknown) => log('success', message, payload)
};

