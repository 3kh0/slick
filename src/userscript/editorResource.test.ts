import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { verifyEditorResource } from './editorResource.ts';

test('cached offline editor bytes must match the userscript build before executing', async () => {
  const code = 'var slickMonacoBundle = {};';
  const hash = createHash('sha256').update(code).digest('hex');
  assert.equal(await verifyEditorResource(code, hash), code);
  await assert.rejects(verifyEditorResource(undefined, hash), /missing/);
  await assert.rejects(verifyEditorResource(code + 'changed', hash), /does not match/);
});
