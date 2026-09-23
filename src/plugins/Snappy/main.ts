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
      // Throws if the spellchecker isn't built in.
      try {
        session.defaultSession.setSpellCheckerEnabled(!(enabled && disableSpellcheck === true));
      } catch {}
    };

    apply(ctx.settings.enabled, ctx.settings.disableSpellcheck);
    const dispose = ctx.onSettingsChange((settings) => apply(settings.enabled, settings.disableSpellcheck));
    return () => {
      dispose();
      apply(false, false);
    };
  },
};

export default plugin;
