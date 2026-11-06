import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_SHADER_SOURCE } from '../media/shaderTemplates.ts';
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  MAX_SHADER_LENGTH,
  parsePreferences,
  savePreferences,
} from '../preferences.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe('call preferences', () => {
  it('round-trips shader code through storage', () => {
    const storage = memoryStorage();
    const preferences = { shaderSource: 'my shader' };
    savePreferences(storage, preferences);
    assert.deepEqual(loadPreferences(storage), preferences);
  });

  it('starts from the defaults when nothing (or garbage) is saved', () => {
    assert.deepEqual(loadPreferences(memoryStorage()), DEFAULT_PREFERENCES);
    assert.deepEqual(
      loadPreferences(memoryStorage({ 'slick-better-huddles:preferences': '{nope' })),
      DEFAULT_PREFERENCES,
    );
  });

  it('falls back to the default shader for empty or oversized code', () => {
    assert.equal(parsePreferences({ shaderSource: '   ' }).shaderSource, DEFAULT_SHADER_SOURCE);
    assert.equal(
      parsePreferences({ shaderSource: 'x'.repeat(MAX_SHADER_LENGTH + 1) }).shaderSource,
      DEFAULT_SHADER_SOURCE,
    );
  });

  it('a storage that refuses writes only warns', () => {
    const full = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    assert.doesNotThrow(() => savePreferences(full, DEFAULT_PREFERENCES));
  });
});
