import type { SlickMainPlugin } from '$slick';
import { appPageData, type AppPageData } from './data.ts';
import { id } from './meta.ts';

/** The app's marketplace page, which needs the user's slack.com cookies. Shared with browser.ts. */
export function marketplaceUrl(appId: unknown, teamId: unknown): string {
  if (typeof appId !== 'string' || !/^A[A-Z0-9]+$/.test(appId)) throw new Error('Invalid app ID');
  if (typeof teamId !== 'string' || !/^[TE][A-Z0-9]+$/.test(teamId)) throw new Error('Invalid workspace ID');
  return `https://slack.com/marketplace/${appId}?team=${teamId}`;
}

export const UNAVAILABLE = 'App management is unavailable for this session';

export async function marketplace(appId: unknown, teamId: unknown, sender: Electron.WebContents): Promise<AppPageData> {
  const response = await sender.session.fetch(marketplaceUrl(appId, teamId), {
    credentials: 'include',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(UNAVAILABLE);
  return appPageData(await response.text());
}

export default {
  id,
  capabilities: ['cookies', 'net'],
  rpc: {
    marketplace(_ctx, [appId, teamId], sender) {
      return marketplace(appId, teamId, sender);
    },
  },
} satisfies SlickMainPlugin;
