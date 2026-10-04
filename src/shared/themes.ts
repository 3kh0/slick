export type ThemeJson = {
  name?: string;
  description?: string;
  palette?: Record<string, Record<string, unknown>>;
  sidebar?: Record<string, unknown>;
  vars?: Record<string, unknown>;
  css?: string | string[];
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function variables(value: unknown): boolean {
  return record(value) && Object.values(value).every((entry) => typeof entry === 'string' || typeof entry === 'number');
}

/** Validate imported files before they reach the CSS converter. */
export function isThemeJson(value: unknown): value is ThemeJson {
  if (!record(value)) return false;
  if (value.name !== undefined && typeof value.name !== 'string') return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (value.palette !== undefined && (!record(value.palette) || !Object.values(value.palette).every(variables)))
    return false;
  if (value.sidebar !== undefined && !variables(value.sidebar)) return false;
  if (value.vars !== undefined && !variables(value.vars)) return false;
  if (
    value.css !== undefined &&
    typeof value.css !== 'string' &&
    !(Array.isArray(value.css) && value.css.every((entry) => typeof entry === 'string'))
  )
    return false;
  return ['palette', 'sidebar', 'vars', 'css'].some((key) => value[key] !== undefined);
}

export function parseThemeJson(text: string, filename: string): ThemeJson {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The theme file is not valid JSON.');
  }
  if (!isThemeJson(value)) throw new Error('Expected a Slick theme with palette, sidebar, vars, or css fields.');
  return { ...value, name: value.name?.trim() || filename.replace(/\.json$/i, '') || 'Imported theme' };
}

export function importedThemes(value: unknown): Record<string, ThemeJson> {
  if (!record(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, ThemeJson] => entry[0].startsWith('imported:') && isThemeJson(entry[1]),
    ),
  );
}
