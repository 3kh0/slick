// Merge pre-ready calls so Slack/Sentry don't drop Slick's scheme flags.
export function installSchemeMerger(proto: { registerSchemesAsPrivileged(s: Electron.CustomScheme[]): void }): void {
  const reg = proto.registerSchemesAsPrivileged.bind(proto);
  const map = new Map<string, Electron.CustomScheme>();
  proto.registerSchemesAsPrivileged = (list: Electron.CustomScheme[] = []) => {
    for (const s of list) {
      if (!s?.scheme) continue;
      map.set(s.scheme, { scheme: s.scheme, privileges: { ...map.get(s.scheme)?.privileges, ...s.privileges } });
    }
    reg([...map.values()]);
  };
}
