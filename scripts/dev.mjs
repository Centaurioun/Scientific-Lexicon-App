import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function normalizeNextDevArgs(rawArgs) {
  const args = [];
  let hasHostname = false;

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];

    if (arg === '--host') {
      hasHostname = true;
      const nextArg = rawArgs[i + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        args.push('--hostname', nextArg);
        i += 1;
      } else {
        args.push('--hostname', '0.0.0.0');
      }
      continue;
    }

    if (arg.startsWith('--host=')) {
      hasHostname = true;
      const value = arg.slice('--host='.length) || '0.0.0.0';
      args.push(`--hostname=${value}`);
      continue;
    }

    if (arg === '-H' || arg === '--hostname' || arg.startsWith('--hostname=')) {
      hasHostname = true;
    }

    args.push(arg);
  }

  if (!hasHostname) {
    args.unshift('--hostname', '0.0.0.0');
  }

  return args;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const require = createRequire(import.meta.url);
  const nextBin = require.resolve('next/dist/bin/next');
  const nextArgs = ['dev', ...normalizeNextDevArgs(process.argv.slice(2))];

  const child = spawn(process.execPath, [nextBin, ...nextArgs], {
    stdio: 'inherit',
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}
