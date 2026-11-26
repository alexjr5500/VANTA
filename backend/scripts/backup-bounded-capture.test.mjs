import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureEncryptedArtifact } from './backup-bounded-capture.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'backup-capture-ci-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const writer = join(root, 'writer'), identity = join(root, 'identity');
  await mkdir(writer, { mode: 0o700 });
  execFileSync('age-keygen', ['-o', identity], { stdio: 'ignore' });
  const recipient = execFileSync('age-keygen', ['-y', identity]).toString().trim();
  const output = join(writer, 'fixture.age');
  return { writer, identity, output, args: { producer: process.execPath,
    args: ['-e', 'process.stdout.write(Buffer.alloc(1024*1024, 42))'],
    producerEnv: { PATH: process.env.PATH }, recipient, output, maxBytes: 2*1024*1024 } };
}
test('real age capture, byte-exact restore and no-clobber publication', async t => {
  const f = await fixture(t), result = await captureEncryptedArtifact(f.args);
  assert.equal(result.bytes, (await stat(f.output)).size);
  const plaintext = execFileSync('age', ['-d', '-i', f.identity, f.output], { maxBuffer: 2*1024*1024 });
  assert.deepEqual(plaintext, Buffer.alloc(1024*1024, 42));
  const before = await readFile(f.output);
  await assert.rejects(captureEncryptedArtifact(f.args));
  assert.deepEqual(await readFile(f.output), before);
  assert.deepEqual(await readdir(f.writer), ['fixture.age']);
});
test('hard ciphertext limit, producer failure, missing executable and deadline leave no published artifact', async t => {
  const f = await fixture(t);
  for (const patch of [
    { maxBytes: 4096 },
    { args: ['-e', 'process.stdout.write("partial"); process.exitCode=9'] },
    { producer: '/nonexistent/vanta-test-producer' },
    { args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 100 },
  ]) {
    await assert.rejects(captureEncryptedArtifact({ ...f.args, ...patch }));
    assert.deepEqual(await readdir(f.writer), []);
  }
});
