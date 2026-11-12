/**
 * fd and thread counters for the soak. They throw rather than return 0, so a
 * broken counter can't pass the fd and thread rules. Linux reads /proc: `ps -M`
 * there counts processes, not threads, and a child would inherit LD_PRELOAD.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const LINUX = process.platform === 'linux';

/** Output lines of a command. Throws if the command fails. */
function lines(command, args) {
  const out = execFileSync(command, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return out.trim().split('\n');
}

/** Open file descriptors of process `pid`. */
export function fdCount(pid) {
  if (LINUX) return fs.readdirSync(`/proc/${pid}/fd`).length;
  // One `f<fd>` line per file; cwd, txt and mapped files are listed too but aren't descriptors.
  return lines('lsof', ['-p', String(pid), '-F', 'f']).filter(line => /^f\d/.test(line)).length;
}

/** Threads of process `pid`. */
export function threadCount(pid) {
  if (LINUX) return fs.readdirSync(`/proc/${pid}/task`).length;
  return lines('ps', ['-M', String(pid)]).length - 1;
}
