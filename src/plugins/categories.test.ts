import assert from 'node:assert/strict';
import test from 'node:test';
import { PLUGIN_CATEGORIES } from '../shared/settings.ts';
import { PLUGINS } from './names.generated.ts';

test('every plugin is filed under a Preferences category', async () => {
  for (const id of PLUGINS) {
    const meta = await import(`./${id}/meta.ts`);
    assert.ok(Object.hasOwn(PLUGIN_CATEGORIES, meta.category), `${id}/meta.ts needs a category from PLUGIN_CATEGORIES`);
  }
});
