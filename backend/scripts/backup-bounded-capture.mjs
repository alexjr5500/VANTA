import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { lstat, mkdtemp, link, rm, stat } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// No scheduler, database connection, production activation or source fence.
// Only a trusted, already-fenced caller may select a producer and its arguments.
export async function captureEncryptedArtifact({ producer, args, producerEnv, recipient,
  output, maxBytes, timeoutMs = 120000 }) {
  if (typeof producer !== 'string' || !producer || !Array.isArray(args) ||
      args.some(a => typeof a !== 'string') || !producerEnv?.PATH ||
      !/^age1[0-9a-z]{58}$/.test(recipient || '') ||
      typeof output !== 'string' || !/^[a-z0-9.]+\.age$/.test(basename(output)) ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > 10 * 1024 ** 3 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) {
    throw Error('Invalid bounded capture parameters');
  }
  const parent = dirname(output), info = await lstat(parent);
  if (!info.isDirectory() || (info.mode & 0o777) !== 0o700 || info.uid !== process.getuid()) {
    throw Error('Private scratch directory required');
  }
  // A trusted scratch parent is mandatory; never use a user-writable directory.
  const temp = await mkdtemp(join(parent, '.capture-'));
  const partial = join(temp, 'artifact.age');
  const children = [], tasks = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let bytes = 0;
  const spawnChecked = (cmd, argv, env, stdin) => {
    const child = spawn(cmd, argv, { env, shell: false, stdio: [stdin, 'pipe', 'ignore'] });
    children.push(child);
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => code === 0 && signal === null ? resolve() : reject(Error('Backup subprocess failed')));
    });
    tasks.push(done);
    // Attach a handler immediately, including failures before pipelines start.
    done.catch(() => controller.abort());
    return child;
  };
  const kill = () => { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); };
  controller.signal.addEventListener('abort', kill, { once: true });
  try {
    const source = spawnChecked(producer, args, producerEnv, 'ignore');
    // Never forward database, R2 or application secrets to age.
    const age = spawnChecked('age', ['--encrypt', '--recipient', recipient], { PATH: producerEnv.PATH }, 'pipe');
    const cap = new Transform({ transform(chunk, encoding, callback) {
      if (chunk.length > maxBytes - bytes) return callback(Error('Encrypted artifact byte limit exceeded'));
      bytes += chunk.length; callback(null, chunk);
    }});
    for (const task of [
      pipeline(source.stdout, age.stdin, { signal: controller.signal }),
      pipeline(age.stdout, cap, createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal: controller.signal }),
    ]) {
      tasks.push(task); task.catch(() => controller.abort());
    }
    await Promise.all(tasks);
    if (controller.signal.aborted || bytes === 0 || (await stat(partial)).size !== bytes) throw Error('Incomplete encrypted artifact');
    // Atomic no-clobber publication only after both subprocesses and streams succeed.
    await link(partial, output);
    return { bytes };
  } catch {
    controller.abort(); kill();
    await Promise.allSettled(tasks);
    throw Error('Bounded encrypted capture failed');
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', kill);
    await rm(temp, { recursive: true, force: true });
  }
}
