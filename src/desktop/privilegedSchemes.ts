type SchemeRegistry = {
  registerSchemesAsPrivileged(customSchemes: Electron.CustomScheme[]): void;
};

// Electron only honors the final pre-ready registerSchemesAsPrivileged flags
// for privileges like secure, bypassCSP, corsEnabled, and supportFetchAPI, so
// Slack and Sentry's later calls drop Slick's unless we merge them here.
export function installSchemeMerger(proto: SchemeRegistry): void {
  const register = proto.registerSchemesAsPrivileged.bind(proto);
  const merged = new Map<string, Electron.CustomScheme>();

  proto.registerSchemesAsPrivileged = (list: Electron.CustomScheme[] = []) => {
    for (const item of list) {
      if (!item?.scheme) continue;
      const prev = merged.get(item.scheme);
      merged.set(item.scheme, {
        scheme: item.scheme,
        privileges: { ...prev?.privileges, ...item.privileges },
      });
    }
    register([...merged.values()]);
  };
}
