let nextRegistrationId = 1;

/** Names a plugin's send hook in error logs, even when a bad return throws nothing. */
export function registrationLabel(hook: (...args: never[]) => unknown): string {
  const registrationSite = new Error().stack
    ?.split('\n')
    .find((line) => line.includes(' at ') && !/registrationLabel|messageSend|sendChecks|pluginManager/.test(line))
    ?.trim();
  return `${hook.name || 'anonymous'} (#${nextRegistrationId++}${registrationSite ? `, ${registrationSite}` : ''})`;
}
