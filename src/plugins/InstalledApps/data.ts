export type InstalledApp = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  is_app_directory_approved?: boolean;
  is_certified?: boolean;
};

type RawApp = Omit<InstalledApp, 'icon'> & { icons?: Record<string, string> };

type Page = { apps?: RawApp[]; response_metadata?: { next_cursor?: string } };

export async function listInstalledApps(
  userId: string,
  request: (params: Record<string, string>) => Promise<Page>,
): Promise<InstalledApp[]> {
  if (!/^[UW][A-Z0-9]+$/.test(userId)) throw new Error('Invalid user ID');
  const apps = new Map<string, InstalledApp>();
  const cursors = new Set<string>();
  let cursor = '';
  for (let page = 0; page < 100; page++) {
    const result = await request({
      user_id: userId,
      limit: '100',
      legacy_integrations: 'false',
      ...(cursor ? { cursor } : {}),
    });
    if (!Array.isArray(result.apps)) throw new Error('Invalid installed apps response');
    for (const app of result.apps) {
      if (!app || !/^A[A-Z0-9]+$/.test(app.id) || typeof app.name !== 'string') throw new Error('Invalid app');
      const icons = app.icons;
      apps.set(app.id, {
        id: app.id,
        name: app.name,
        description: app.description,
        icon:
          icons?.image_48 ??
          icons?.image_36 ??
          icons?.image_32 ??
          icons?.image_72 ??
          (icons && Object.values(icons)[0]),
        is_app_directory_approved: app.is_app_directory_approved,
        is_certified: app.is_certified,
      });
    }
    cursor = result.response_metadata?.next_cursor?.trim() ?? '';
    if (!cursor) return [...apps.values()];
    if (cursors.has(cursor)) throw new Error('Repeated installed apps cursor');
    cursors.add(cursor);
  }
  throw new Error('Installed apps pagination limit reached');
}
