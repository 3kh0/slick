export type TypingRecord = {
  channelId?: string | null;
  threadTs?: string | null;
  memberId?: string | null;
  memberIsSelf?: boolean | null;
};

/** The members typing in `channelId` other than you, each once. */
export function typersIn(records: TypingRecord[], channelId: string, includeThreads: boolean): string[] {
  const ids = new Set<string>();
  for (const { channelId: channel, threadTs, memberId, memberIsSelf } of records) {
    if (channel === channelId && memberId && !memberIsSelf && (includeThreads || !threadTs)) ids.add(memberId);
  }
  return [...ids];
}

type Translate = (text: string, values?: Record<string, unknown>) => string;

/** Slack's own "A and B are typing" sentence, folding the rest into "N others" past `max` names. */
export function typingSentence(names: string[], typing: Translate, today: Translate, max = 4): string {
  if (names.length === 1) return strip(typing('<b>{name}</b> is typing', { name: names[0] }));
  const named = names.length > max ? names.slice(0, max - 1) : names.slice(0, -1);
  const rest = names.length - named.length;
  const last =
    rest === 1 && names.length <= max
      ? names.at(-1)
      : today('{count, plural, =1 {# other} other {# others}}', { count: rest });
  return strip(
    typing('<b>{name}</b> and <b>{other_name}</b> are typing', { name: named.join(', '), other_name: last }),
  );
}

const strip = (text: string) => text.replace(/<\/?b>/g, '');
