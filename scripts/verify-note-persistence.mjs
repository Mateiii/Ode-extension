import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const storageState = {};

globalThis.chrome = {
  storage: {
    local: {
      get(keys, callback) {
        const result = {};
        const requestedKeys = Array.isArray(keys) ? keys : [keys];

        for (const key of requestedKeys) {
          result[key] = storageState[key];
        }

        callback(result);
      },
      set(items, callback) {
        Object.assign(storageState, items);
        callback?.();
      },
    },
  },
};

const tempDir = await mkdtemp(join(tmpdir(), 'ode-storage-verify-'));

try {
  const outfile = join(tempDir, 'researchStorage.mjs');

  await build({
    entryPoints: [resolve('lib/researchStorage.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    logLevel: 'silent',
  });

  const firstLoad = await import(`${outfile}?load=first`);
  const savedNote = await firstLoad.saveQuickNote({
    text: 'Persistence check highlight text',
    metadata: {
      title: 'Persistence Fixture',
      author: 'Test Author',
      canonicalUrl: 'https://example.test/persistence-fixture',
      publishedDate: '2026-05-23T12:00:00Z',
      siteName: 'Ode Test',
    },
  });

  assert.equal(savedNote.text, 'Persistence check highlight text');
  assert.equal(storageState.quickNotes.length, 1);

  const refreshedLoad = await import(`${outfile}?load=refreshed`);
  const notesAfterRefresh = await refreshedLoad.getQuickNotes();

  assert.equal(notesAfterRefresh.length, 1);
  assert.equal(notesAfterRefresh[0].id, savedNote.id);
  assert.equal(notesAfterRefresh[0].text, 'Persistence check highlight text');
  assert.equal(notesAfterRefresh[0].metadata.title, 'Persistence Fixture');

  console.log('Quick note persisted across a fresh storage read.');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
