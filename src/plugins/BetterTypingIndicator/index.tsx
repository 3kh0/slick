import { SlickPlugin } from '$slick';
import { fit, type Box, type Phrases } from './fit.ts';
import * as meta from './meta.ts';

type TypingRecord = {
  channelId?: string | null;
  threadTs?: string | null;
  memberId?: string | null;
  memberIsSelf?: boolean | null;
};
type Conversation = { channelId?: string; threadTs?: string };
type TypingNamesProps = {
  firstTyper?: React.ReactNode;
  secondTyper?: React.ReactNode;
  severalPeopleAreTyping?: boolean;
};
type Member = { real_name?: string; profile?: { display_name?: string; real_name?: string } };
type NameOf = (state: unknown, member: Member | undefined) => string;
type I18nClass = new (namespace: string) => { t: (text: string, values?: Record<string, unknown>) => string };
type Typer = { id: string; name: string };

const AVATAR_SIZE = 16;
const AVATAR_GAP = 4;

const named = (name: string) => (exp: any) => typeof exp === 'function' && (exp.displayName || exp.name) === name;

export default class BetterTypingIndicator extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['redux', 'elements'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private readonly ConversationContext = React.createContext<Conversation | null>(null);
  private readonly nameOf = new this.api.Store<NameOf | undefined>(undefined);
  private readonly phrases = new this.api.Store<Phrases | undefined>(undefined);
  private canvas?: OffscreenCanvasRenderingContext2D;
  private readonly textWidths = new Map<string, number>();
  private readonly graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

  start() {
    const { Avatar, MemberLink, Tooltip } = this.api.elements;
    const showAvatars = this.config.showAvatars !== false;
    const nameFormat = this.config.names;

    void this.api.waitForExport<NameOf>(named('getPrefCompliantMemberName')).then(this.nameOf.set);
    void this.api
      .waitForExport<I18nClass>(named('I18n'))
      .then((I18n) => this.phrases.set(phrasesFrom(I18n)))
      .catch((error) => this.log('could not read Slack’s typing phrases', error));

    this.api.setStyle(`
      .slick-typing-indicator {
        display: block;
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .slick-typing-indicator__sample {
        position: absolute;
        visibility: hidden;
        pointer-events: none;
      }
      .slick-typing-indicator .slick-typing-indicator__member {
        align-items: baseline;
        color: inherit;
        letter-spacing: inherit;
      }
      .slick-typing-indicator__avatar {
        align-self: center;
        width: ${AVATAR_SIZE}px;
        height: ${AVATAR_SIZE}px;
        margin-right: ${AVATAR_GAP}px;
        line-height: 0;
      }
    `);

    for (const name of ['MessagePaneInput', 'ThreadTypingIndicator']) {
      this.api.patchComponent<Conversation>(name, (Original) => (props) => {
        const { channelId, threadTs } = props;
        const value = React.useMemo(() => ({ channelId, threadTs }), [channelId, threadTs]);
        return (
          <this.ConversationContext.Provider value={value}>
            <Original {...props} />
          </this.ConversationContext.Provider>
        );
      });
    }

    this.api.patchComponent<TypingNamesProps>('TypingNames', (Original) => (props) => {
      const conversation = React.useContext(this.ConversationContext);
      const nameOf = this.nameOf.use();
      const phrases = this.phrases.use();
      const json = this.api.redux.useReduxState((state) => {
        if (!conversation?.channelId || !nameOf) return '';
        const records: TypingRecord[] = Object.values(state.typing ?? {});
        const typers = records.flatMap(({ channelId, threadTs, memberId, memberIsSelf }) =>
          channelId === conversation.channelId &&
          (threadTs ?? undefined) === conversation.threadTs &&
          !memberIsSelf &&
          memberId
            ? [{ id: memberId, name: nameFor(nameFormat, nameOf, state, state.members?.[memberId]) }]
            : [],
        );
        return typers.length ? JSON.stringify(typers) : '';
      });
      const typers = React.useMemo<Typer[]>(() => (json ? JSON.parse(json) : []), [json]);

      const line = React.useRef<HTMLSpanElement>(null);
      const sample = React.useRef<HTMLSpanElement>(null);
      const boldSample = React.useRef<HTMLElement>(null);
      const [box, setBox] = React.useState<Box | null>(null);
      const shown = typers.length > 0 && !!phrases;
      React.useLayoutEffect(() => {
        const element = line.current;
        const text = sample.current;
        const bold = boldSample.current;
        if (!element || !text || !bold) return;
        const update = () => {
          const { fontFamily, fontSize, letterSpacing, fontWeight } = getComputedStyle(element);
          const next: Box = {
            width: element.clientWidth,
            sample: text.getBoundingClientRect().width,
            fontFamily,
            fontSize,
            letterSpacing,
            regularWeight: fontWeight,
            boldWeight: getComputedStyle(bold).fontWeight,
            avatar: showAvatars ? AVATAR_SIZE + AVATAR_GAP : 0,
          };
          setBox((prev) =>
            prev && (Object.keys(next) as (keyof Box)[]).every((key) => prev[key] === next[key]) ? prev : next,
          );
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(element);
        observer.observe(text);
        return () => observer.disconnect();
      }, [shown]);

      if (!shown || !phrases) return <Original {...props} />;

      const names = typers.map(({ name }) => name);
      const texts = box
        ? fit(
            names,
            phrases,
            box,
            (text, font) => this.textWidth(text, font, box.letterSpacing),
            (text, width, font) => this.truncate(text, width, font, box.letterSpacing),
          )
        : names;
      const links = texts.map((text, i) => (
        <MemberLink key={typers[i].id} id={typers[i].id} className="slick-typing-indicator__member">
          {showAvatars && (
            <span className="slick-typing-indicator__avatar">
              <Avatar
                userId={typers[i].id}
                size={AVATAR_SIZE}
                isInteractive={false}
                showCard={false}
                ariaHidden="true"
              />
            </span>
          )}
          {text}
        </MemberLink>
      ));
      const others = typers.slice(texts.length);
      const last = others.length ? (
        <Tooltip tip={others.map(({ name }) => name).join(', ')}>
          <span>{phrases.others(others.length)}</span>
        </Tooltip>
      ) : (
        links.pop()
      );
      return (
        <span ref={line} className="slick-typing-indicator">
          <span ref={sample} className="slick-typing-indicator__sample" aria-hidden>
            typing <b ref={boldSample}>typing</b>
          </span>
          {links.length ? (
            <Original firstTyper={join(links)} secondTyper={last} severalPeopleAreTyping={false} />
          ) : (
            <Original firstTyper={last} severalPeopleAreTyping={false} />
          )}
        </span>
      );
    });
  }

  private textWidth(text: string, font: string, letterSpacing: string): number {
    const key = `${font}\n${letterSpacing}\n${text}`;
    let width = this.textWidths.get(key);
    if (width === undefined) {
      this.canvas ??= new OffscreenCanvas(0, 0).getContext('2d') ?? undefined;
      if (!this.canvas) return 0;
      this.canvas.font = font;
      this.canvas.letterSpacing = letterSpacing === 'normal' ? '0px' : letterSpacing;
      width = this.canvas.measureText(text).width;
      if (!document.fonts.check(font)) return width;
      const [oldest] = this.textWidths.keys();
      if (this.textWidths.size >= 1000 && oldest) this.textWidths.delete(oldest);
      this.textWidths.set(key, width);
    }
    return width;
  }

  private truncate(text: string, width: number, font: string, letterSpacing: string): string {
    if (this.textWidth(text, font, letterSpacing) <= width) return text;
    const graphemes = Array.from(this.graphemes.segment(text), ({ segment }) => segment);
    const cut = (count: number) => `${graphemes.slice(0, count).join('').trimEnd()}…`;
    let low = 0;
    let high = graphemes.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.textWidth(cut(mid), font, letterSpacing) <= width) low = mid;
      else high = mid - 1;
    }
    return cut(low);
  }
}

function phrasesFrom(I18n: I18nClass): Phrases {
  const typing = new I18n('notification_bar');
  const today = new I18n('today');
  const name = '';
  const otherName = '';
  const pieces = (text: string) =>
    text
      .replace(/<\/?b>/g, '')
      .split(name)
      .flatMap((piece) => piece.split(otherName));
  const others = new Map<number, string>();
  return {
    one: pieces(typing.t('<b>{name}</b> is typing', { name })),
    two: pieces(typing.t('<b>{name}</b> and <b>{other_name}</b> are typing', { name, other_name: otherName })),
    others: (count) => {
      let label = others.get(count);
      if (label === undefined) {
        label = today.t('{count, plural, =1 {# other} other {# others}}', { count });
        others.set(count, label);
      }
      return label;
    },
  };
}

function nameFor(format: string, nameOf: NameOf, state: unknown, member: Member | undefined): string {
  const name =
    format === 'display'
      ? member?.profile?.display_name
      : format === 'full'
        ? member?.profile?.real_name || member?.real_name
        : undefined;
  return name || nameOf(state, member);
}

function join(nodes: React.ReactNode[]): React.ReactNode {
  return nodes.flatMap((node, i) => (i ? [', ', node] : [node]));
}
