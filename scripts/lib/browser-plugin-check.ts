// Run against authenticated Slack. Sends use a stub; no Slack messages are posted.
export const browserPluginCheck = `(async () => {
  const manager = window.__slickPluginManager;
  const snappy = manager.plugins.get('Snappy');
  const haiku = manager.plugins.get('HaikuWarning');
  const accounts = manager.plugins.get('AccountSwitcher');
  const check = (value, message) => { if (!value) throw new Error(message); };
  check(snappy.running && haiku.running, 'ported plugins not running');
  check(accounts.running, 'AccountSwitcher not running');
  const accountMenu = accounts.instance.buildSwitcherItem([]);
  check(accountMenu.template.some(item => item.key === 'slick-account-switcher__add'), 'account manager menu missing');
  let captureDenied = false;
  try { await accounts.instance.api.main.call('capture'); } catch { captureDenied = true; }
  check(captureDenied, 'page can request privileged account capture');
  // Plugin startup can finish before Slack mounts its Redux Provider.
  for (let i = 0; i < 100 && !haiku.instance.api.redux.getStore(); i++) {
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  check(!!haiku.instance.api.redux.getStore(), 'Slack Redux Provider did not mount');
  const schema = snappy.PluginClass.settings;
  check(!('ignoreGpuBlocklist' in schema) && !('disableCrashReporter' in schema), 'desktop settings exposed in browser');
  check(snappy.PluginClass.relaunchSettings.length === 0, 'browser requests desktop relaunch');
  const fixture = document.createElement('div');
  fixture.hidden = true;
  fixture.innerHTML = '<div class="ql-editor" contenteditable="true" spellcheck="true"></div><div data-qa="message_input"><div contenteditable="true"></div></div><div contenteditable="true" spellcheck="true"></div>';
  document.body.append(fixture);
  const [main, thread, unrelated] = fixture.querySelectorAll('[contenteditable]');
  const controller = snappy.instance.spellcheck;
  try {
    controller.update(true);
    check(main.getAttribute('spellcheck') === 'false' && thread.getAttribute('spellcheck') === 'false', 'composer spellcheck not disabled');
    check(unrelated.getAttribute('spellcheck') === 'true', 'unrelated editable changed');
    const later = document.createElement('div');
    later.className = 'ql-editor'; later.contentEditable = 'true'; later.setAttribute('spellcheck', 'true');
    fixture.append(later);
    await new Promise(resolve => setTimeout(resolve, 0));
    check(later.getAttribute('spellcheck') === 'false', 'new composer missed');
    later.setAttribute('spellcheck', 'true');
    await new Promise(resolve => setTimeout(resolve, 0));
    check(later.getAttribute('spellcheck') === 'false', 'Slack update undid spellcheck');
    later.remove();
    await new Promise(resolve => setTimeout(resolve, 0));
    check(later.getAttribute('spellcheck') === 'true', 'detached composer not restored');
    controller.update(false);
    check(main.getAttribute('spellcheck') === 'true' && thread.getAttribute('spellcheck') === null, 'original attributes not restored');
    controller.update(true); controller.dispose();
    check(main.getAttribute('spellcheck') === 'true' && thread.getAttribute('spellcheck') === null, 'teardown did not restore composers');
  } finally {
    controller.update(snappy.instance.config.disableSpellcheck === true);
    fixture.remove();
  }
  // Use Slack's real Delta-to-block converter and the packaged dictionary.
  const delta = await haiku.instance.api.blocks.makeDelta([{insert: 'An old silent pond, a frog jumps into the pond — splash, silence again.\\n'}]);
  const args = { channelId: 'CSLICKTEST', delta };
  const result = await haiku.instance.findHaiku(args.delta);
  check(result?.length === 3, 'live Slack haiku conversion failed: ' + JSON.stringify(await haiku.instance.api.blocks.fromDelta(args.delta)));
  let prompt, sends = 0, clears = 0;
  const abort = new AbortController();
  const instance = new haiku.PluginClass({
    ...haiku.instance.api,
    signal: abort.signal,
    modal: { openModal: options => { prompt = options; return {close(){}}; } },
    getExport: () => () => ({clear(){clears++;}}),
  }, {});
  const props = { prepareAndSendMessage: async () => { sends++; } };
  const held = async () => {
    try { await instance.onSend(props, args); throw new Error('haiku sent without approval'); }
    catch (error) { check(error.message === 'HaikuWarning: waiting for confirmation', error.message); }
  };
  await held(); prompt.onCancel(); check(sends === 0, 'cancel sent a message');
  await held(); prompt.onSubmit(); check(sends === 1 && clears === 1, 'approved send did not run exactly once');
  instance.stop(); abort.abort();
  await accounts.instance.addAccount(); // Opens trusted UI after checks; inactive Slack tabs throttle timers.
  return { spellcheck: true, haiku: true, accounts: true, actualMessagesSent: 0 };
})()`;
