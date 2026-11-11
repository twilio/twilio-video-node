/**
 * fd and thread counters for the soak. They throw rather than return 0, so a
 * broken counter can't pass the fd and thread rules. Linux reads /proc: `ps -M`
 * there counts processes, not threads, and a child would inherit LD_PRELOAD.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const LINUX = process.platform === 'linux';

/** Output lines of a command, minus its header line. Throws if the command fails. */
function countLines(command, args) {
  const out = execFileSync(command, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return out.trim().split('\n').length - 1;
}

/** Open file descriptors of process `pid`. */
export function fdCount(pid) {
  if (LINUX) return fs.readdirSync(`/proc/${pid}/fd`).length;
  return countLines('lsof', ['-p', String(pid)]);
}

/** Threads of process `pid`. */
export function threadCount(pid) {
  if (LINUX) return fs.readdirSync(`/proc/${pid}/task`).length;
  return countLines('ps', ['-M', String(pid)]);
}
