// The redaction stylesheet.
//
// Adapted from Taut's StreamerMode (MIT, github.com/jeremy46231/taut). Selects
// on Slack's structure (lock icon, sidebar channel-type attribute, activity
// destination tag) rather than class-name substrings, which over- and
// under-match.

export const ROOT_CLASS = 'slick-streamer-mode';
export const THREAD_CLASS = 'slick-streamer-mode__private-thread';
export const REVEAL_CLASS = 'slick-streamer-mode__revealed';

export type StreamerCss = {
  blur: number;
  /** 'all' also blurs who the DM is with, not just its content. */
  dmPreviewBlur: string;
  privateChannelNames: boolean;
  vipStatus: boolean;
};

export function streamerCss(options: StreamerCss): string {
  const root = `html.${ROOT_CLASS}`;
  const blur = options.blur > 0 ? options.blur : 4;

  const lock = '[data-inline-channel-type-icon^="lock"]';
  const sidebarRow =
    '.p-channel_sidebar__channel:is([data-qa-channel-sidebar-channel-type="private"], [data-qa-channel-sidebar-channel-type="mpim"]):not([data-qa-channel-sidebar-channel-is-selected="true"])';
  const activityRow = '[data-qa="activity-item-container"]';
  const preview = '[data-qa="activity-item-message"]';
  const destination = '.p-activity_row_content__destination_tag';
  const privateDestination = `${destination}:has(${lock})`;
  const groupDestination = `${destination}:not(:has(.c-inline_channel_entity))`;
  const dmsRow = '[data-qa="dms_channel"]:not(:has(.p-activity_ia4_page__item--selected))';
  const senderName = `${dmsRow}:has(.c-base_icon_image_stacked) [data-qa="dms-channel-sender-name"]`;
  const threadBody = `.${THREAD_CLASS} :is(.c-message_kit__gutter__left, .c-message_kit__gutter__right)`;
  const suggestion =
    '.c-search_autocomplete__suggestion_item:is(:has(.c-channel_icon svg[data-qa^="lock"]), [data-type="mpim"])';
  const suggestionText = '.c-search_autocomplete__suggestion_item_left';
  const mention = `.c-inline_channel_entity:has(${lock}):not(${activityRow} *) .c-channel_entity__name`;

  // Whose DM it is, as opposed to what it says. Only redacted on 'all'.
  const identity =
    options.dmPreviewBlur === 'all'
      ? [`${root} ${senderName}`, `${root} ${activityRow} :is(${privateDestination}, ${groupDestination})`]
      : [];

  const names = options.privateChannelNames
    ? [
        `${root} ${sidebarRow} .p-channel_sidebar__name`,
        `${root} ${mention}`,
        `${root} ${suggestion} ${suggestionText}`,
      ]
    : [];

  const blurred = [
    ...names,
    ...identity,
    `${root} ${activityRow}:has(${lock}) ${preview}`,
    `${root} ${activityRow}:has([data-qa="direct-messages"]) ${preview}`,
    `${root} ${dmsRow} ${preview}`,
    `${root} .p-threads_view ${threadBody}`,
  ];

  // Hovering a row reveals it, so the client stays usable while redacted.
  const inRow = `:is(${preview}, ${destination}, [data-qa="dms-channel-sender-name"])`;
  const revealed = [
    `${root} ${sidebarRow}:hover .p-channel_sidebar__name`,
    `${root} .c-inline_channel_entity:hover .c-channel_entity__name`,
    `${root} ${activityRow}:hover ${inRow}`,
    `${root} ${dmsRow}:hover ${inRow}`,
    `${root} .${REVEAL_CLASS} ${threadBody}`,
    `${root} .${REVEAL_CLASS} ${mention}`,
    `${root} ${suggestion}:hover ${suggestionText}`,
  ];

  const vip = options.vipStatus
    ? `
      ${root} [data-qa="priority_vip_badge"],
      ${root} svg[data-qa="vip"],
      ${root} svg[data-qa="vip-filled"] {
        display: none;
      }
    `
    : '';

  return `
    ${blurred.join(',\n    ')} {
      filter: blur(${blur}px);
      transition: filter 0.15s;
    }

    ${revealed.join(',\n    ')} {
      filter: none;
    }
    ${vip}
    .slick-streamer-mode__container {
      margin-right: 8px;
    }
    .slick-streamer-mode__button[aria-pressed="true"] {
      color: rgba(var(--sk_raspberry_red, 224, 30, 90), 1);
    }
  `;
}
