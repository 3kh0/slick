// What the call remembers between huddles: your shader code. Stored in the
// Slack page's localStorage; parsing is pure and testable.

import { DEFAULT_SHADER_SOURCE } from './media/shaderTemplates.ts';

export interface CallPreferences {
  shaderSource: string;
}

const STORAGE_KEY = 'slick-better-huddles:preferences';
// Generous for hand-written GLSL, small enough that a corrupt value can't bloat the page.
export const MAX_SHADER_LENGTH = 20_000;

export const DEFAULT_PREFERENCES: CallPreferences = { shaderSource: DEFAULT_SHADER_SOURCE };

export function parsePreferences(saved: unknown): CallPreferences {
  const record = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  const shader = record.shaderSource;
  const validShader = typeof shader === 'string' && shader.trim() !== '' && shader.length <= MAX_SHADER_LENGTH;
  return { shaderSource: validShader ? shader : DEFAULT_SHADER_SOURCE };
}

export function loadPreferences(storage: Pick<Storage, 'getItem'>): CallPreferences {
  try {
    return parsePreferences(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null'));
  } catch (error) {
    console.warn(
      `[slick] [Better Huddles] saved huddle preferences were unreadable, using defaults: ${(error as Error).message}`,
    );
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(storage: Pick<Storage, 'setItem'>, preferences: CallPreferences): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch (error) {
    // Only costs remembering the shader for the next call; this call already uses it.
    console.warn(`[slick] [Better Huddles] couldn't save huddle preferences: ${(error as Error).message}`);
  }
}
