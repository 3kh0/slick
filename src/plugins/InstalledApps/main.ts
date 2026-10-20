import type { SlickMainPlugin } from '$slick';
import { id } from './meta.ts';

export async function marketplace(appId: unknown, teamId: unknown, sender: Electron.WebContents): Promise<string> {
  if (typeof appId !== 'string' || !/^A[A-Z0-9]+$/.test(appId)) throw new Error('Invalid app ID');
  if (typeof teamId !== 'string' || !/^[TE][A-Z0-9]+$/.test(teamId)) throw new Error('Invalid workspace ID');
  const response = await sender.session.fetch(`https://slack.com/marketplace/${appId}?team=${teamId}`, {
    credentials: 'include',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('App management is unavailable for this session');
  return response.text();
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
