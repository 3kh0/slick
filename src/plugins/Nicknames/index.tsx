// Locally rename other members and apps; only this client sees the nickname. The
// member and bot objects are rewritten on their way out of the store, so every
// surface that reads a name picks it up. modifyMemberObject also rewrites the
// denormalized name fields, so the old name stops matching in search/autocomplete.

import { SlickPlugin, type MenuTemplateItem, type SlackMember } from '$slick';
import * as meta from './meta.ts';

type NicknameMap = Record<string, string>;
type MenuFromTemplateProps = { template?: MenuTemplateItem[] };
type OverflowMenuProps = { memberId?: string };
type AppOverflowProps = { appId?: string; appUserId?: string };
type SlackBot = { name?: string; app_id?: string };
type ApiRequest = { method?: string; args?: Record<string, unknown> };
type MenuTarget = { kind: 'member'; id: string } | { kind: 'app'; id: string; userId?: string };

const ITEM_KEY = 'slick-nicknames__set';
const INPUT_ID = 'slick-nicknames__input';
const NAME_FIELDS = ['real_name', 'display_name'];

const parseProfile = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'string')
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export default class Nicknames extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['elements', 'members', 'modal', 'redux'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  // Nicknames are stored as a setting so Preferences can list them; writing
  // one must not restart the plugin that just wrote it.
  static readonly liveSettings = ['names'];

  // The overflow menus know who they are for but the generic menu body they
  // render does not; context carries it across.
  private readonly TargetContext = React.createContext<MenuTarget | null>(null);

  private removeMemberPatch: (() => void) | null = null;
  private removeBotPatch: (() => void) | null = null;
  private editingSelf = false;

  private get nicknames(): NicknameMap {
    return (this.config.names as NicknameMap) ?? {};
  }

  private nicknameForMember(id: string, member: SlackMember): string | undefined {
    if (this.editingSelf && id === this.api.members.getCurrentMemberId()) return;
    const appId = member.is_bot ? member.profile?.api_app_id : undefined;
    return this.nicknames[id] || (typeof appId === 'string' ? this.nicknames[appId] : undefined);
  }

  private syncPatches(refreshExisting = false) {
    const ids = Object.keys(this.nicknames).filter((id) => this.nicknames[id]);
    const wantMembers = ids.length > 0;
    const wantBots = ids.some((id) => id.startsWith('A'));
    let changed = false;

    if (wantMembers !== !!this.removeMemberPatch) {
      changed = true;
      if (wantMembers) {
        this.removeMemberPatch = this.api.redux.patchSlice<SlackMember>('members', (id, member) => {
          const nickname = member?.profile && this.nicknameForMember(id, member);
          return nickname ? this.api.members.modifyMemberObject(member!, { name: nickname }) : member;
        });
      } else {
        const remove = this.removeMemberPatch;
        this.removeMemberPatch = null;
        remove?.();
      }
    }

    if (wantBots !== !!this.removeBotPatch) {
      changed = true;
      if (wantBots) {
        this.removeBotPatch = this.api.redux.patchSlice<SlackBot>('bots', (id, bot) => {
          const nickname = bot && (this.nicknames[id] || (bot.app_id ? this.nicknames[bot.app_id] : undefined));
          return nickname ? { ...bot, name: nickname } : bot;
        });
      } else {
        const remove = this.removeBotPatch;
        this.removeBotPatch = null;
        remove?.();
      }
    }

    // Installing/removing a slice patch already refreshes Redux.
    if (!changed && refreshExisting && wantMembers) this.api.redux.refresh();
  }

  start() {
    this.syncPatches();

    this.api.patchComponent<OverflowMenuProps>('RimetoMemberProfileOverflowMenu', (Original) => (props) => (
      <this.TargetContext.Provider value={props.memberId ? { kind: 'member', id: props.memberId } : null}>
        <Original {...props} />
      </this.TargetContext.Provider>
    ));

    this.api.patchComponent<AppOverflowProps>('AppDetailsOverflow', (Original) => (props) => (
      <this.TargetContext.Provider
        value={props.appId ? { kind: 'app', id: props.appId, userId: props.appUserId } : null}
      >
        <Original {...props} />
      </this.TargetContext.Provider>
    ));

    this.api.patchComponent<MenuFromTemplateProps>('MenuFromTemplate', (Original) => (props) => {
      const target = React.useContext(this.TargetContext);
      const template = props.template;
      if (!target || !Array.isArray(template) || template.some((item) => item?.key === ITEM_KEY))
        return <Original {...props} />;

      const anchor =
        target.kind === 'member'
          ? template.findIndex((item) => typeof item?.label === 'string' && item.label.startsWith('Copy display name'))
          : template.length - 1;
      if (anchor === -1) return <Original {...props} />;

      const next = [
        ...template.slice(0, anchor + 1),
        {
          key: ITEM_KEY,
          label: this.nicknames[target.id] ? 'Edit nickname…' : 'Set nickname…',
          click: () => this.openNicknameModal(target),
        },
        ...template.slice(anchor + 1),
      ];
      return <Original {...props} template={next} />;
    });

    // The profile editor is seeded from the store, so it would save the nickname.
    this.api.redux.patchThunk('openEditProfileModal', (original) => (...args: unknown[]) => {
      this.setEditingSelf(true);
      return original(...args);
    });
    this.api.patchComponent('EditProfileFormPane', (Original) => (props: object) => {
      React.useEffect(() => () => this.setEditingSelf(false), []);
      return <Original {...props} />;
    });

    this.api.redux.patchThunk('apiCall', (untypedOriginal) => {
      const original = untypedOriginal as (request: ApiRequest, ...rest: unknown[]) => unknown;
      return (request: ApiRequest, ...rest: unknown[]) => original(this.withRealNames(request), ...rest);
    });
  }

  onSettingsChange() {
    this.syncPatches(true);
  }

  stop() {
    for (const remove of [this.removeMemberPatch, this.removeBotPatch]) remove?.();
    this.removeMemberPatch = null;
    this.removeBotPatch = null;
    this.editingSelf = false;
  }

  private setEditingSelf(editing: boolean) {
    if (this.editingSelf === editing) return;
    const self = this.api.members.getCurrentMemberId();
    this.editingSelf = editing;
    if (self && this.nicknames[self] && this.removeMemberPatch) this.api.redux.refresh();
  }

  private withRealNames(request: ApiRequest): ApiRequest {
    const args = request?.args;
    if (request?.method !== 'users.profile.set' || !args) return request;
    const self = this.api.members.getCurrentMemberId();
    const userId = typeof args.user === 'string' && args.user ? args.user : self;
    const nickname = userId ? this.nicknames[userId] : undefined;
    if (!userId || !nickname || (this.editingSelf && userId === self)) return request;

    const real: Record<string, unknown> | undefined = this.api.redux.getRawState()?.members?.[userId]?.profile;
    const restore = (field: unknown, value: unknown) =>
      typeof field === 'string' &&
      NAME_FIELDS.includes(field) &&
      value === nickname &&
      typeof real?.[field] === 'string' &&
      real[field] !== nickname;

    let next = args;
    if (restore(args.name, args.value)) next = { ...next, value: real![args.name as string] };

    const profile = parseProfile(args.profile);
    if (profile && NAME_FIELDS.some((field) => restore(field, profile[field]))) {
      const fixed = { ...profile };
      for (const field of NAME_FIELDS) if (restore(field, fixed[field])) fixed[field] = real![field];
      next = { ...next, profile: typeof args.profile === 'string' ? JSON.stringify(fixed) : fixed };
    }

    return next === args ? request : { ...request, args: next };
  }

  private setNickname(id: string, nickname: string) {
    const trimmed = nickname.trim();
    const next = { ...this.nicknames };
    if (trimmed) next[id] = trimmed;
    else delete next[id];
    void this.api.settings.set('names', next);
  }

  private realName(target: MenuTarget): string {
    // Raw state, so the modal shows the real name rather than the nickname.
    const state = this.api.redux.getRawState();
    const memberId = target.kind === 'member' ? target.id : target.userId;
    const member: SlackMember | undefined = memberId ? state?.members?.[memberId] : undefined;
    return (
      (target.kind === 'member' && member?.profile?.display_name) ||
      member?.profile?.real_name ||
      member?.real_name ||
      target.id
    );
  }

  private openNicknameModal(target: MenuTarget) {
    const realName = this.realName(target);
    const { Label, FormTextInput } = this.api.elements;
    const valueRef = { current: this.nicknames[target.id] ?? '' };

    const NicknameField = () => {
      const [value, setValue] = React.useState(valueRef.current);
      return (
        <>
          <Label text="Nickname" htmlFor={INPUT_ID} optional />
          <FormTextInput
            id={INPUT_ID}
            value={value}
            onChange={(next) => {
              setValue(next);
              valueRef.current = next;
            }}
            placeholder={realName}
            hintText={`Leave blank to show ${target.kind === 'app' ? 'its' : 'their'} real name again`}
            autoFocus
          />
        </>
      );
    };

    this.api.modal.openModal({
      title: `Set nickname for ${realName}`,
      submitText: 'Save',
      cancelText: 'Cancel',
      body: <NicknameField />,
      onSubmit: () => this.setNickname(target.id, valueRef.current),
    });
  }
}
