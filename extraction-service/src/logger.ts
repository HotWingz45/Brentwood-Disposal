type LogLevel = 'info' | 'warn' | 'error';

function timestamp(): string {
  return new Date().toISOString();
}

function emit(level: LogLevel, tag: string, message: string, extra?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: timestamp(),
    level,
    tag,
    message,
    ...(extra ?? {}),
  });

  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  info:  (tag: string, msg: string, extra?: Record<string, unknown>) => emit('info',  tag, msg, extra),
  warn:  (tag: string, msg: string, extra?: Record<string, unknown>) => emit('warn',  tag, msg, extra),
  error: (tag: string, msg: string, extra?: Record<string, unknown>) => emit('error', tag, msg, extra),
};
