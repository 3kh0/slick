import type { InviteMember } from '../huddleInvite.ts';
import { avatarHue, avatarInitials, memberDisplayName, memberPhotoUrl } from './callText.ts';
import { useCallState, useHuddleUi } from './context.ts';
import { ControlButton } from './Controls.tsx';
import { Icon } from './icons.tsx';

function Avatar({ member }: { member: InviteMember }) {
  const [failed, setFailed] = React.useState(false);
  return (
    <span
      className="sbh-invite-avatar"
      style={{ backgroundColor: `hsl(${avatarHue(member.id)} 35% 35%)` }}
      aria-hidden="true"
    >
      {avatarInitials(member.name)}
      {member.avatarUrl && !failed && <img src={member.avatarUrl} alt="" onError={() => setFailed(true)} />}
    </span>
  );
}

function CurrentParticipant({ userId }: { userId: string }) {
  const { useMember } = useHuddleUi();
  const member = useMember(userId);
  return <Avatar member={{ id: userId, name: memberDisplayName(member), avatarUrl: memberPhotoUrl(member) }} />;
}

export function InvitePeople() {
  const { call, searchInviteMembers, inviteMember, inviteDescription, copyHuddleLink } = useHuddleUi();
  const state = useCallState();
  const dialog = React.useRef<HTMLDialogElement>(null);
  const search = React.useRef<HTMLInputElement>(null);
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<InviteMember[]>([]);
  const [selected, setSelected] = React.useState<InviteMember[]>([]);
  const [invited, setInvited] = React.useState<string[]>([]);
  const [active, setActive] = React.useState(-1);
  const [loading, setLoading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [copying, setCopying] = React.useState(false);
  const [errorMessage, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const busy = React.useRef(false);
  const roomId = React.useRef('');
  const close = () => {
    dialog.current?.close();
    setOpen(false);
  };

  React.useEffect(() => {
    setInvited([]);
    if (open && (state.status !== 'connected' || state.roomId !== roomId.current)) close();
  }, [state.status, state.roomId]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setResults([]);
    setActive(-1);
    const timer = setTimeout(() => {
      searchInviteMembers(query, state.channelId)
        .then((members) => {
          if (!cancelled) setResults(members);
        })
        .catch((error: unknown) => {
          if (!cancelled) setError(`Couldn't find people: ${(error as Error).message}`);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, state.channelId, searchInviteMembers]);

  const excluded = new Set([state.localUserId, ...state.participants]);
  const people = results.filter((member) => !excluded.has(member.id));
  const togglePerson = (member: InviteMember) => {
    if (sending) return;
    const removing = selected.some((person) => person.id === member.id);
    setSelected((current) => (removing ? current.filter((person) => person.id !== member.id) : [...current, member]));
    if (!removing) {
      setQuery('');
      setActive(-1);
    }
    setError('');
    search.current?.focus();
  };
  const send = async () => {
    if (busy.current || !selected.length) return;
    busy.current = true;
    setSending(true);
    setError('');
    setNotice('');
    const sent: string[] = [];
    try {
      for (const member of selected) {
        await inviteMember(roomId.current, member.id);
        setSelected((current) => current.filter((person) => person.id !== member.id));
        setInvited((current) => [...current, member.id]);
        sent.push(member.name);
        setNotice(`Invited ${sent.join(', ')}`);
      }
    } catch (error) {
      setError(`Couldn't send invite: ${(error as Error).message}`);
    } finally {
      busy.current = false;
      setSending(false);
    }
  };
  const copyLink = async () => {
    setCopying(true);
    try {
      await copyHuddleLink(roomId.current);
      setNotice('Huddle link copied');
      setError('');
    } catch (error) {
      setError(`Couldn't copy the link: ${(error as Error).message}`);
    } finally {
      setCopying(false);
    }
  };
  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!people.length) return;
      const next =
        event.key === 'ArrowDown' ? (active + 1) % people.length : (active <= 0 ? people.length : active) - 1;
      setActive(next);
      dialog.current?.querySelector(`#${CSS.escape(id)}-person-${next}`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const member = people[active < 0 ? 0 : active];
      if (member) togglePerson(member);
    } else if (event.key === 'Backspace' && !query) {
      setSelected((current) => current.slice(0, -1));
    }
  };

  return (
    <>
      <ControlButton
        label="Add people"
        icon="user-plus"
        disabled={sending || state.status !== 'connected' || !state.roomId}
        onClick={() => {
          roomId.current = call.state.get().roomId;
          setQuery('');
          setSelected([]);
          setError('');
          setNotice('');
          setOpen(true);
          dialog.current?.showModal();
          search.current?.focus();
        }}
      />
      <dialog
        ref={dialog}
        className="sbh-invite"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onClose={() => setOpen(false)}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <header className="sbh-invite-heading">
            <h2 id={`${id}-title`}>Invite people to your huddle</h2>
            <button type="button" className="sbh-invite-close" aria-label="Close invite picker" onClick={close}>
              <Icon name="x" />
            </button>
          </header>
          <p id={`${id}-description`} className="sbh-invite-description">
            {inviteDescription(state.channelId)}
          </p>
          <div className="sbh-invite-current">
            <span className="sbh-invite-avatar-stack">
              {state.participants.slice(0, 3).map((userId) => (
                <CurrentParticipant key={userId} userId={userId} />
              ))}
            </span>
            <span>
              {state.participants.length === 1
                ? 'You’re in this huddle'
                : `${state.participants.length} people in this huddle`}
            </span>
          </div>
          <div className="sbh-invite-search" onClick={() => search.current?.focus()}>
            {selected.map((member) => (
              <span className="sbh-invite-chip" key={member.id}>
                <Avatar member={member} />
                <span>{member.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${member.name}`}
                  disabled={sending}
                  onClick={() => togglePerson(member)}
                >
                  <Icon name="x" size={14} />
                </button>
              </span>
            ))}
            <input
              ref={search}
              autoFocus
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={`${id}-people`}
              aria-activedescendant={active >= 0 && people[active] ? `${id}-person-${active}` : undefined}
              aria-label="Search people"
              placeholder={selected.length ? 'Add more people…' : 'Search by name'}
              value={query}
              disabled={sending}
              onKeyDown={onSearchKey}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setError('');
              }}
            />
          </div>
          <h3 className="sbh-invite-results-heading">{query ? 'Search results' : 'Suggested people'}</h3>
          <div
            className="sbh-invite-results"
            id={`${id}-people`}
            role="listbox"
            aria-label="People"
            aria-multiselectable="true"
            aria-busy={loading}
          >
            {loading ? (
              <p role="status">Searching…</p>
            ) : people.length ? (
              people.map((member, index) => {
                const checked = selected.some((person) => person.id === member.id);
                const sent = invited.includes(member.id);
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    aria-disabled={sending}
                    id={`${id}-person-${index}`}
                    key={member.id}
                    className={`sbh-invite-person${active === index ? ' sbh-invite-person--active' : ''}`}
                    onClick={() => togglePerson(member)}
                    disabled={sending}
                  >
                    <Avatar member={member} />
                    <span className="sbh-invite-person-text">
                      <strong>{member.name}</strong>
                      {member.realName && <span>{member.realName}</span>}
                    </span>
                    {sent ? (
                      <span className="sbh-invite-person-status">Invited</span>
                    ) : (
                      member.inChannel === false && (
                        <span className="sbh-invite-person-status">Not in conversation</span>
                      )
                    )}
                    <span
                      className={`sbh-invite-check${checked ? ' sbh-invite-check--selected' : ''}`}
                      aria-hidden="true"
                    >
                      {checked ? '✓' : ''}
                    </span>
                  </button>
                );
              })
            ) : (
              <p>No people found. Try a different name.</p>
            )}
          </div>
          <div className="sbh-invite-feedback" aria-live="polite">
            {errorMessage && <p role="alert">{errorMessage}</p>}
            {notice && <p role="status">{notice}</p>}
          </div>
          <footer className="sbh-invite-actions">
            <button type="button" className="sbh-invite-copy" disabled={copying} onClick={() => void copyLink()}>
              <Icon name="link" size={16} />
              {copying ? 'Copying…' : 'Copy huddle link'}
            </button>
            <button type="button" className="sbh-text-button" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="sbh-text-button sbh-invite-send" disabled={sending || !selected.length}>
              {sending ? 'Sending…' : selected.length > 1 ? `Send ${selected.length} invites` : 'Send invite'}
            </button>
          </footer>
        </form>
      </dialog>
    </>
  );
}
