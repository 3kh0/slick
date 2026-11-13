import { type ChangelogRelease, hasHighlights, HIGHLIGHTS } from '../shared/changelog.ts';
import { setStyle } from './api/css.ts';
import { modalReady } from './api/modal.tsx';
import type { ConfigStore } from './configStore.ts';

const POPUP_RELEASES = 5;
const OPEN_ATTEMPTS = 30;
const OPEN_RETRY_MS = 2000;

const CSS = `
.slick-changelog { display: grid; gap: 14px; font-size: 14px; line-height: 20px; }
.slick-changelog h4 { margin: 0 0 4px; font-size: 13px; font-weight: 700; color: var(--dt_color-content-sec); }
.slick-changelog h5 { margin: 6px 0 2px; font-size: 13px; font-weight: 700; }
.slick-changelog ul { margin: 0; padding-left: 20px; }
.slick-changelog li + li { margin-top: 2px; }
.slick-changelog code { font-size: 12px; }
.slick-changelog__highlights { padding: 8px 12px; border-radius: 8px; background: var(--dt_color-surf-ter, rgba(127, 127, 127, 0.1)); }
.slick-changelog__highlights h5 { margin-top: 0; }
`;

const INLINE = /(`[^`]+`|\[[^\]]+\]\(https:\/\/[^)\s]+\))/;

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(INLINE).map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
        const link = /^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/.exec(part);
        if (link) {
          return (
            <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">
              {link[1]}
            </a>
          );
        }
        return part;
      })}
    </>
  );
}

let styled = false;

export function ChangelogView({ releases }: { releases: ChangelogRelease[] }) {
  if (!styled) {
    styled = true;
    setStyle(CSS, 'changelog');
  }
  if (!releases.length) return <div className="slick-changelog">No changes listed yet.</div>;
  return (
    <div className="slick-changelog">
      {releases.map((release) => (
        <section key={release.build ?? 'unreleased'}>
          <h4>{release.build === null ? 'Unreleased' : `Build ${release.build}`}</h4>
          {release.groups.map((group) => (
            <div key={group.title} className={group.title === HIGHLIGHTS ? 'slick-changelog__highlights' : undefined}>
              {group.title && <h5>{group.title}</h5>}
              <ul>
                {group.items.map((item) => (
                  <li key={item}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export function releasesBetween(changelog: ChangelogRelease[], after: number, upTo: number): ChangelogRelease[] {
  return changelog.filter((r) => r.build !== null && r.build > after && r.build <= upTo);
}

/** Opens What's new once per update, and only when a skipped-over build has highlights. */
export async function showWhatsNew(
  config: ConfigStore,
  build = __SLICK_BUILD__,
  changelog = __SLICK_CHANGELOG__,
): Promise<boolean> {
  if (!build || config.lastSeenBuild === build) return false;
  // Decided inside the write so only one tab sharing these settings opens it.
  let seen: number | undefined = build;
  const saved = await config.update((stored) => {
    seen = typeof stored.lastSeenBuild === 'number' ? stored.lastSeenBuild : undefined;
    stored.lastSeenBuild = build;
  });
  if (!saved || seen === undefined || seen >= build) return false;
  const fresh = releasesBetween(changelog, seen, build);
  if (!config.whatsNewPopup || !hasHighlights(fresh)) return false;
  const { openModal } = await modalReady;
  // Slack's openModal thunk is found after the modal API resolves; keep trying until it is.
  for (let attempt = 0; attempt < OPEN_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, OPEN_RETRY_MS));
    const handle = openModal({
      title: "What's new in Slick",
      body: <ChangelogView releases={fresh.slice(0, POPUP_RELEASES)} />,
      submitText: 'Got it',
      showCancelButton: false,
    });
    if (handle) return true;
  }
  return false;
}
