// Snappy, main-process half.
//
// Chromium switches have to be appended before the app is ready, which is why
// they cannot be applied live and are declared in `relaunchSettings`. The
// spellchecker is a session setting, so it can be toggled at any time.

import { session } from 'electron';
import type { SlickMainPlugin } from '$slick';

const plugin: SlickMainPlugin = {
  id: 'Snappy',
  capabilities: ['switches'],

  boot(ctx) {
    if (!ctx.settings.enabled) return;

    if (ctx.settings.ignoreGpuBlocklist) {
      ctx.switches.append('ignore-gpu-blocklist');
      ctx.log('ignoring the GPU blocklist');
    }
    if (ctx.settings.disableCrashReporter) {
      ctx.switches.append('disable-crashpad');
      ctx.switches.append('disable-crash-reporter');
      ctx.log('crash reporter disabled');
    }
  },

  ready(ctx) {
    const apply = (enabled: boolean, disableSpellcheck: unknown) => {
      // Electron throws if the spellchecker was never built in; not worth
      // failing the plugin over.
      try {
        session.defaultSession.setSpellCheckerEnabled(!(enabled && disableSpellcheck === true));
      } catch {}
    };

    apply(ctx.settings.enabled, ctx.settings.disableSpellcheck);
    ctx.onSettingsChange((settings) => apply(settings.enabled, settings.disableSpellcheck));
  },
};

export default plugin;
