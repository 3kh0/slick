// Reactor ids come from `ReactionBar`'s props but the chip renders next to
// `ReactionAddButton`, so a context carries the list across the two patches.
// `members.getMember` batches lookups: fifty reactors is one request.

import { SlickPlugin, type MenuTemplateItem } from '$slick';
import * as meta from './meta.ts';

type SlackReaction = { name?: string; users?: string[] };
type ReactionBarProps = { reactions?: SlackReaction[] };

/** Stable identity so consumers don't re-render for an empty list. */
const NO_REACTIONS: SlackReaction[] = [];

const SEPARATORS: Record<string, string> = { space: ' ', newline: '\n', comma: ', ' };

export default class CopyReacted extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['format', 'separator'];

  private readonly ReactionsContext = React.createContext<SlackReaction[]>(NO_REACTIONS);

  private async reactorText(userId: string): Promise<string> {
    if (this.config.format === 'mentions') return `<@${userId}>`;

    const member = await this.api.members.getMember(userId);
    if (this.config.format === 'handles') return `@${member?.name || userId}`;
    return member?.profile?.display_name || member?.profile?.real_name || member?.real_name || userId;
  }

  private async copyReactors(userIds: string[]): Promise<void> {
    const reactors = [...new Set(userIds)];
    if (!reactors.length) return;

    const separator = SEPARATORS[String(this.config.separator)] ?? '\n';
    const lines = await Promise.all(reactors.map((id) => this.reactorText(id)));

    try {
      await navigator.clipboard.writeText(lines.join(separator));
    } catch (error) {
      // Denied when the window isn't focused.
      this.log('could not copy reactors', error);
      void this.api.modal.alert({
        title: 'Could not copy',
        body: 'Slack denied access to the clipboard. Make sure the window is focused.',
      });
    }
  }

  private readonly CopyButton = () => {
    const reactions = React.useContext(this.ReactionsContext);
    if (!reactions.length) return null;

    const { Menu } = this.api.menu;
    const { SvgIcon, MrkdwnElement } = this.api.elements;

    const everyone = [...new Set(reactions.flatMap((reaction) => reaction.users ?? []))];
    const template: MenuTemplateItem[] = [
      {
        key: 'slick-cr__everyone',
        label: `Everyone (${everyone.length})`,
        click: () => void this.copyReactors(everyone),
      },
    ];
    if (reactions.length > 1) {
      for (const reaction of reactions) {
        template.push({
          key: `slick-cr__${reaction.name}`,
          // mrkdwn renders the shortcode as the emoji image.
          label: <MrkdwnElement text={`:${reaction.name}: (${reaction.users?.length ?? 0})`} />,
          click: () => void this.copyReactors(reaction.users ?? []),
        });
      }
    }

    return (
      <Menu template={template} position="bottom">
        <button
          type="button"
          className="c-button-unstyled c-reaction_add slick-cr__btn"
          data-qa="slick_copy_reacted"
          aria-label="Copy who reacted"
        >
          <SvgIcon name="copy" size={18} />
        </button>
      </Menu>
    );
  };

  start() {
    this.api.setStyle(`
      /* Mirrors how .c-reaction_add__fg greys the add-reaction icon. */
      .slick-cr__btn {
        color: var(--dt_color-content-pry);
      }
      .sk-client-theme--dark .slick-cr__btn {
        color: var(--dt_color-content-ter);
      }
      .sk-client-theme--dark .slick-cr__btn:is(:hover, :focus) {
        color: var(--dt_color-content-pry);
      }
    `);

    this.api.patchComponent<ReactionBarProps>('ReactionBar', (Original) => (props) => (
      <this.ReactionsContext.Provider value={props.reactions ?? NO_REACTIONS}>
        <Original {...props} />
      </this.ReactionsContext.Provider>
    ));

    this.api.patchComponent('ReactionAddButton', (Original) => (props) => (
      <>
        <Original {...props} />
        <this.CopyButton />
      </>
    ));
  }
}
