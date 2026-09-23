// Locally rename other members; only this client sees the nickname. The member
// object is rewritten on its way out of the store, so every surface that reads
// a name picks it up. modifyMemberObject also rewrites the denormalized name
// fields, so the old name stops matching in search/autocomplete too.

import { SlickPlugin, type MenuTemplateItem, type SlackMember } from '$slick';
import * as meta from './meta.ts';

type NicknameMap = Record<string, string>;
type MenuFromTemplateProps = { template?: MenuTemplateItem[] };
type OverflowMenuProps = { memberId?: string };

const ITEM_KEY = 'slick-nicknames__set';
const INPUT_ID = 'slick-nicknames__input';

export default class Nicknames extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  // Nicknames are stored as a setting so Preferences can list them; writing
  // one must not restart the plugin that just wrote it.
  static readonly liveSettings = ['names'];

  // The overflow menu knows the member id but the generic menu body it renders
  // does not; context carries it across.
  private readonly MemberIdContext = React.createContext<string | null>(null);

  private get nicknames(): NicknameMap {
    return (this.config.names as NicknameMap) ?? {};
  }

  start() {
    this.api.redux.patchSlice<SlackMember>('members', (id, member) => {
      const nickname = this.nicknames[id];
      if (!nickname || !member?.profile) return member;
      return this.api.members.modifyMemberObject(member, { name: nickname });
    });

    this.api.patchComponent<OverflowMenuProps>('RimetoMemberProfileOverflowMenu', (Original) => (props) => (
      <this.MemberIdContext.Provider value={props.memberId ?? null}>
        <Original {...props} />
      </this.MemberIdContext.Provider>
    ));

    this.api.patchComponent<MenuFromTemplateProps>('MenuFromTemplate', (Original) => (props) => {
      const memberId = React.useContext(this.MemberIdContext);
      const template = props.template;
      if (!memberId || !Array.isArray(template)) return <Original {...props} />;

      // Insert next to the other name actions.
      const anchor = template.findIndex(
        (item) => typeof item?.label === 'string' && item.label.startsWith('Copy display name'),
      );
      const already = template.some((item) => item?.key === ITEM_KEY);
      if (anchor === -1 || already) return <Original {...props} />;

      const next = [
        ...template.slice(0, anchor + 1),
        {
          key: ITEM_KEY,
          label: this.nicknames[memberId] ? 'Edit nickname…' : 'Set nickname…',
          click: () => this.openNicknameModal(memberId),
        },
        ...template.slice(anchor + 1),
      ];
      return <Original {...props} template={next} />;
    });
  }

  onSettingsChange() {
    // mapEntries memoizes on the patch version, so without this the store
    // keeps handing out members built from the previous nickname map.
    this.api.redux.refresh();
  }

  private setNickname(userId: string, nickname: string) {
    const trimmed = nickname.trim();
    const next = { ...this.nicknames };
    if (trimmed) next[userId] = trimmed;
    else delete next[userId];
    void this.api.settings.set('names', next);
  }

  private openNicknameModal(userId: string) {
    // Raw state, so the modal shows the real name rather than the nickname.
    const member: SlackMember | undefined = this.api.redux.getRawState()?.members?.[userId];
    const realName = member?.profile?.display_name || member?.profile?.real_name || member?.real_name || userId;

    const { Label, FormTextInput } = this.api.elements;
    const valueRef = { current: this.nicknames[userId] ?? '' };

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
            hintText="Leave blank to show their real name again"
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
      onSubmit: () => this.setNickname(userId, valueRef.current),
    });
  }
}
