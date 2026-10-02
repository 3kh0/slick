const HOME = 'https://app.slack.com/client';
const NAMES = new Set(['d', 'd-s', 'uc']);

export function parseLoginCookies(input: unknown, now = Date.now() / 1000): Electron.CookiesSetDetails[] {
  if (typeof input !== 'string' || input.length > 256_000) throw new Error('Paste Slack cookies (up to 256 KB).');
  const text = input.trim();
  let entries: unknown[];
  if (text.startsWith('[') || text.startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('The cookie JSON is invalid. Paste a JSON cookie export or a Cookie header.');
    }
    entries = Array.isArray(parsed) ? parsed : parsed?.cookies;
    if (!Array.isArray(entries)) throw new Error('The JSON must contain a cookie array.');
  } else if (text.startsWith('xoxd-')) {
    entries = [{ name: 'd', value: text }];
  } else {
    entries = text
      .replace(/^cookie:\s*/i, '')
      .split(';')
      .map((pair) => {
        const equals = pair.indexOf('=');
        return { name: pair.slice(0, equals).trim(), value: pair.slice(equals + 1).trim() };
      });
  }
  const result = new Map<string, Electron.CookiesSetDetails>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const cookie = entry as Record<string, unknown>;
    if (typeof cookie.name !== 'string' || !NAMES.has(cookie.name)) continue;
    const domain = cookie.domain === undefined ? '.slack.com' : cookie.domain;
    if (typeof domain !== 'string' || !['slack.com', '.slack.com', 'app.slack.com', '.app.slack.com'].includes(domain))
      continue;
    if (cookie.path !== undefined && cookie.path !== '/') continue;
    // Cookie values cannot contain header delimiters or control characters.
    // oxlint-disable-next-line no-control-regex
    if (typeof cookie.value !== 'string' || !cookie.value || /[\s;\x00-\x1f\x7f]/.test(cookie.value))
      throw new Error('A Slack cookie has an invalid or empty value.');
    const expiration = cookie.expirationDate ?? cookie.expires;
    if (
      expiration !== undefined &&
      expiration !== -1 &&
      (typeof expiration !== 'number' || !Number.isFinite(expiration) || expiration <= now)
    )
      throw new Error('A Slack cookie has expired or has an invalid expiry. Export fresh cookies from your browser.');
    const sameSite = typeof cookie.sameSite === 'string' ? cookie.sameSite.toLowerCase() : 'lax';
    const details: Electron.CookiesSetDetails = {
      url: 'https://app.slack.com',
      name: cookie.name,
      value: cookie.value,
      domain,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite:
        sameSite === 'none' || sameSite === 'no_restriction'
          ? 'no_restriction'
          : sameSite === 'strict'
            ? 'strict'
            : 'lax',
    };
    if (typeof expiration === 'number' && expiration > now && cookie.session !== true)
      details.expirationDate = expiration;
    if (result.has(cookie.name))
      throw new Error('Multiple copies of a Slack cookie were found. Export cookies for app.slack.com only.');
    result.set(cookie.name, details);
  }
  if (!result.has('d'))
    throw new Error('No Slack d session cookie was found. Include HttpOnly cookies in your export.');
  return [...result.values()];
}

type Navigate = (
  sender: Electron.WebContents,
  url: string,
  pending: { action: 'reset' },
  mutate: () => Promise<void>,
) => Promise<void>;

export async function loginWithCookies(
  sender: Electron.WebContents,
  input: unknown,
  navigate: Navigate,
): Promise<void> {
  const imported = parseLoginCookies(input);
  await navigate(sender, HOME, { action: 'reset' }, async () => {
    const jar = sender.session.cookies;
    const previous = (await jar.get({ domain: 'slack.com' })).filter((cookie) => NAMES.has(cookie.name));
    const remove = async () => {
      for (const cookie of (await jar.get({ domain: 'slack.com' })).filter((item) => NAMES.has(item.name))) {
        const host = (cookie.domain ?? 'app.slack.com').replace(/^\./, '');
        await jar.remove(`https://${host}${cookie.path}`, cookie.name);
      }
    };
    try {
      await remove();
      for (const cookie of imported) await jar.set(cookie);
      await jar.flushStore();
    } catch {
      try {
        await remove();
        for (const cookie of previous) {
          const { hostOnly, session, ...details } = cookie;
          await jar.set({
            ...details,
            domain: hostOnly ? undefined : cookie.domain,
            expirationDate: session ? undefined : cookie.expirationDate,
            url: `https://${(cookie.domain ?? 'app.slack.com').replace(/^\./, '')}${cookie.path}`,
          });
        }
        await jar.flushStore();
      } catch {
        throw new Error('Could not restore the previous session. Sign in again to recover.');
      }
      throw new Error('Could not import the cookies. Your previous cookies were restored. Try again.');
    }
  });
}
