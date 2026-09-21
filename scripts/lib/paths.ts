// Repo paths, resolved once.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const SRC = path.join(ROOT, 'src');
export const APP = path.join(SRC, 'app');
export const DESKTOP = path.join(SRC, 'desktop');
export const SHARED = path.join(SRC, 'shared');
export const PLUGINS = path.join(SRC, 'plugins');

export const DIST = path.join(ROOT, 'dist');
export const DIST_APP = path.join(DIST, 'app');
export const DIST_DESKTOP = path.join(DIST, 'desktop');

export const SLICK_JS = path.join(DIST_APP, 'slick.js');

export const ASSETS = path.join(ROOT, 'assets');
export const THEMES = path.join(ROOT, 'themes');
