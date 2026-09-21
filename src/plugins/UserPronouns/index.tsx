// Show each person's pronouns after the timestamp on their messages.
//
// v1 matched nine selectors against every DOM batch, read the user id back out
// of the fiber and appended a span -- which meant it also had to detect and
// remove its own spans to avoid duplicating them. v2 renders inside the header
// component, so React owns the element and removing the plugin removes it.
//
// The pronoun itself comes from `members.useMember`, which loads the member if
// the store has not got them yet, so this works on a channel scrolled back
// past anyone currently cached.

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

type Message = { user?: string; bot_id?: string };
type BroadcastPreambleProps = { msg?: Message; children?: React.ReactNode };

/** The thread pane builds its own header rather than taking children. */
type ThreadHeaderProps = {
  msg?: Message;
  adjacent?: boolean;
  visible?: boolean;
  omitTimestamp?: boolean;
  omitLinebreak?: boolean;
};

const USER_ID = /^[UW][A-Z0-9]+$/;
const MAX_LENGTH = 40;

const isPerson = (msg: Message | undefined): msg is Message & { user: string } =>
  !!msg?.user && USER_ID.test(msg.user) && msg.user !== 'USLACKBOT' && !msg.bot_id;

/**
 * Grouped messages get handed the same children back with `visible: false`,
 * so identifying the header parts by prop shape has to respect that or the
 * pronouns turn up on every message in a run.
 */
const isHeaderChild = (child: React.ReactNode, prop: string): boolean => {
  const props = React.isValidElement(child) ? child.props : null;
  if (typeof props !== 'object' || props === null) return false;
  return prop in props && (props as { visible?: boolean }).visible !== false;
};

const isTimestamp = (child: React.ReactNode) => isHeaderChild(child, 'clickable');
/** Compact mode moves the timestamp to the gutter, so sit after the sender. */
const isSender = (child: React.ReactNode) => isHeaderChild(child, 'isInteractive');

export default class UserPronouns extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private readonly Pronouns = ({ userId, bulleted }: { userId: string; bulleted: boolean }) => {
    const member = this.api.members.useMember(userId);
    const pronouns = String(member?.profile?.pronouns ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!pronouns) return null;
    return (
      <span
        className={`slick-pronouns${bulleted ? ' slick-pronouns--bulleted' : ''}`}
        // Keeps the pronouns out of the text when a message is copied.
        data-stringify-ignore=""
      >
        {pronouns.slice(0, MAX_LENGTH)}
      </span>
    );
  };

  start() {
    this.api.setStyle(`
      .slick-pronouns {
        margin-left: 6px;
        align-self: center;
        font-size: 12px;
        font-weight: 400;
        color: rgba(var(--sk_foreground_max_solid, 97, 96, 97), 1);
        white-space: nowrap;
        cursor: default;
        user-select: none;
      }
      .slick-pronouns--bulleted {
        margin-left: 0;
      }
      .slick-pronouns--bulleted::before {
        content: '\\2022';
        margin: 0 4px;
      }
    `);

    // Channels: one component is handed both the sender and the timestamp.
    this.api.patchComponent<BroadcastPreambleProps>('BroadcastPreamble', (Original) => (props) => {
      if (!isPerson(props.msg)) return <Original {...props} />;

      const children = React.Children.toArray(props.children);
      const timestamp = children.findIndex(isTimestamp);
      const anchor = timestamp === -1 ? children.findIndex(isSender) : timestamp;
      if (anchor === -1) return <Original {...props} />;

      children.splice(
        anchor + 1,
        0,
        <this.Pronouns key="slick-pronouns" userId={props.msg.user} bulleted={timestamp !== -1} />,
      );
      return <Original {...props}>{children}</Original>;
    });

    // The thread-pane counterpart, which ends on a <br> we have to move past.
    this.api.patchComponent<ThreadHeaderProps>('ThreadSenderAndTimestampGeneric', (Original) => (props) => {
      if (props.adjacent || props.visible === false || !isPerson(props.msg)) return <Original {...props} />;

      return (
        <>
          <Original {...props} omitLinebreak />
          <this.Pronouns userId={props.msg.user} bulleted={!props.omitTimestamp} />
          {props.omitLinebreak ? null : <br />}
        </>
      );
    });
  }
}
