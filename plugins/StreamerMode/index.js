'use strict';

const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = (app) => path.join(app.getPath('userData'), 'slick', 'plugin-settings.json');

const x = `
html.slick-streamer-active,
body.slick-streamer-active {
  --slick-streamer-blur: 6px;
  --slick-streamer-shadow: 0 0 8px rgba(127,127,127,.9);
}
body.slick-streamer-active .slick-streamer-redact {
  filter: blur(var(--slick-streamer-blur)) !important;
  color: transparent !important;
  text-shadow: var(--slick-streamer-shadow) !important;
  user-select: none !important;
}
body.slick-streamer-active .slick-streamer-redact * {
  color: transparent !important;
  text-shadow: var(--slick-streamer-shadow) !important;
  user-select: none !important;
}
body.slick-streamer-active .slick-streamer-avatar,
body.slick-streamer-active.slick-streamer-dm-all .p-channel_sidebar__channel--im .c-avatar,
body.slick-streamer-active.slick-streamer-dm-all .p-channel_sidebar__channel--im img,
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dm_browser" i] .c-avatar,
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dm_browser" i] img,
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dm_browser" i] [class*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dm_browser" i] [data-qa*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dm_browser" i] [style*="background-image" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dm_list" i] .c-avatar,
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dm_list" i] img,
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dm_list" i] [class*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dm_list" i] [data-qa*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dm_list" i] [style*="background-image" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dms" i] .c-avatar,
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dms" i] img,
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dms" i] [class*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dms" i] [data-qa*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dms" i] [style*="background-image" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dm_browser" i] .c-avatar,
body.slick-streamer-active.slick-streamer-dm-all [class*="dm_browser" i] img,
body.slick-streamer-active.slick-streamer-dm-all [class*="dm_browser" i] [class*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dm_browser" i] [data-qa*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dm_browser" i] [style*="background-image" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dms" i] .c-avatar,
body.slick-streamer-active.slick-streamer-dm-all [class*="dms" i] img,
body.slick-streamer-active.slick-streamer-dm-all [class*="dms" i] [class*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dms" i] [data-qa*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dms" i] [style*="background-image" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="direct_message" i] .c-avatar,
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="direct_message" i] img,
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="direct_message" i] [class*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="direct_message" i] [data-qa*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="direct_message" i] [style*="background-image" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="direct_message" i] .c-avatar,
body.slick-streamer-active.slick-streamer-dm-all [class*="direct_message" i] img,
body.slick-streamer-active.slick-streamer-dm-all [class*="direct_message" i] [class*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="direct_message" i] [data-qa*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="direct_message" i] [style*="background-image" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dm-list" i] .c-avatar,
body.slick-streamer-active.slick-streamer-dm-all [class*="dm-list" i] img,
body.slick-streamer-active.slick-streamer-dm-all [class*="dm-list" i] [class*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dm-list" i] [data-qa*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dm-list" i] [style*="background-image" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dm_list" i] .c-avatar,
body.slick-streamer-active.slick-streamer-dm-all [class*="dm_list" i] img,
body.slick-streamer-active.slick-streamer-dm-all [class*="dm_list" i] [class*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dm_list" i] [data-qa*="avatar" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dm_list" i] [style*="background-image" i] {
  filter: blur(var(--slick-streamer-blur)) saturate(.55) !important;
  opacity: .82 !important;
}
body.slick-streamer-active.slick-streamer-dm-all .p-channel_sidebar__channel--im .p-channel_sidebar__name,
body.slick-streamer-active.slick-streamer-dm-all .p-channel_sidebar__channel--im .p-channel_sidebar__name_text,
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dm_browser" i] [data-qa*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dm_browser" i] [class*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dm_list" i] [data-qa*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dm_list" i] [class*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dms" i] [data-qa*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="dms" i] [class*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dm_browser" i] [data-qa*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dm_browser" i] [class*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dms" i] [data-qa*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dms" i] [class*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="direct_message" i] [data-qa*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa*="direct_message" i] [class*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="direct_message" i] [data-qa*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="direct_message" i] [class*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dm-list" i] [data-qa*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dm-list" i] [class*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dm_list" i] [data-qa*="name" i],
body.slick-streamer-active.slick-streamer-dm-all [class*="dm_list" i] [class*="name" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_browser" i] time,
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_browser" i] [data-qa*="timestamp" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_browser" i] [data-qa*="preview" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_browser" i] [data-qa*="snippet" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_browser" i] [data-qa*="last_message" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_browser" i] [class*="timestamp" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_browser" i] [class*="preview" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_browser" i] [class*="snippet" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_browser" i] [class*="last_message" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_list" i] time,
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_list" i] [data-qa*="timestamp" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_list" i] [data-qa*="preview" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_list" i] [data-qa*="snippet" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_list" i] [data-qa*="last_message" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_list" i] [class*="timestamp" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_list" i] [class*="preview" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_list" i] [class*="snippet" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dm_list" i] [class*="last_message" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dms" i] time,
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dms" i] [data-qa*="timestamp" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dms" i] [data-qa*="preview" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dms" i] [data-qa*="snippet" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dms" i] [data-qa*="last_message" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dms" i] [class*="timestamp" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dms" i] [class*="preview" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dms" i] [class*="snippet" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="dms" i] [class*="last_message" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dm_browser" i] time,
body.slick-streamer-active.slick-streamer-dm-content [class*="dm_browser" i] [data-qa*="timestamp" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dm_browser" i] [data-qa*="preview" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dm_browser" i] [data-qa*="snippet" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dm_browser" i] [data-qa*="last_message" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dm_browser" i] [class*="timestamp" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dm_browser" i] [class*="preview" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dm_browser" i] [class*="snippet" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dm_browser" i] [class*="last_message" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dms" i] time,
body.slick-streamer-active.slick-streamer-dm-content [class*="dms" i] [class*="timestamp" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dms" i] [class*="preview" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dms" i] [class*="snippet" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dms" i] [class*="last_message" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="direct_message" i] time,
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="direct_message" i] [data-qa*="timestamp" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="direct_message" i] [data-qa*="preview" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="direct_message" i] [data-qa*="snippet" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa*="direct_message" i] [data-qa*="last_message" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="direct_message" i] time,
body.slick-streamer-active.slick-streamer-dm-content [class*="direct_message" i] [class*="timestamp" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="direct_message" i] [class*="preview" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="direct_message" i] [class*="snippet" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="direct_message" i] [class*="last_message" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dm-list" i] time,
body.slick-streamer-active.slick-streamer-dm-content [class*="dm-list" i] [class*="timestamp" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dm-list" i] [class*="preview" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dm-list" i] [class*="snippet" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dm-list" i] [class*="last_message" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dm_list" i] time,
body.slick-streamer-active.slick-streamer-dm-content [class*="dm_list" i] [class*="timestamp" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dm_list" i] [class*="preview" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dm_list" i] [class*="snippet" i],
body.slick-streamer-active.slick-streamer-dm-content [class*="dm_list" i] [class*="last_message" i] {
  filter: blur(var(--slick-streamer-blur)) !important;
  color: transparent !important;
  text-shadow: var(--slick-streamer-shadow) !important;
  user-select: none !important;
}
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar__channel--private .p-channel_sidebar__name,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar__channel--private .p-channel_sidebar__name_text,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar__channel:has([class*="c-icon--lock" i]) .p-channel_sidebar__name,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar__channel:has([class*="c-icon--lock" i]) .p-channel_sidebar__name_text,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar__channel:has([data-qa*="lock" i]) .p-channel_sidebar__name,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar__channel:has([data-qa*="lock" i]) .p-channel_sidebar__name_text,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [role="treeitem"][aria-label*="private" i] .p-channel_sidebar__name,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [role="treeitem"][aria-label*="private" i] .p-channel_sidebar__name_text,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [role="treeitem"]:has([class*="c-icon--lock" i]) .p-channel_sidebar__name,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [role="treeitem"]:has([class*="c-icon--lock" i]) .p-channel_sidebar__name_text,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [role="treeitem"]:has([data-qa*="lock" i]) .p-channel_sidebar__name,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [role="treeitem"]:has([data-qa*="lock" i]) .p-channel_sidebar__name_text,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [data-qa="virtual-list-item"][aria-label*="private" i] .p-channel_sidebar__name,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [data-qa="virtual-list-item"][aria-label*="private" i] .p-channel_sidebar__name_text,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [data-qa="virtual-list-item"]:has([class*="c-icon--lock" i]) .p-channel_sidebar__name,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [data-qa="virtual-list-item"]:has([class*="c-icon--lock" i]) .p-channel_sidebar__name_text,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [data-qa="virtual-list-item"]:has([data-qa*="lock" i]) .p-channel_sidebar__name,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [data-qa="virtual-list-item"]:has([data-qa*="lock" i]) .p-channel_sidebar__name_text,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [data-qa="channel-sidebar-channel"][aria-label*="private" i] .p-channel_sidebar__name,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [data-qa="channel-sidebar-channel"][aria-label*="private" i] .p-channel_sidebar__name_text,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [data-qa="channel-sidebar-channel"]:has([class*="c-icon--lock" i]) .p-channel_sidebar__name,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [data-qa="channel-sidebar-channel"]:has([class*="c-icon--lock" i]) .p-channel_sidebar__name_text,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [data-qa="channel-sidebar-channel"]:has([data-qa*="lock" i]) .p-channel_sidebar__name,
body.slick-streamer-active.slick-streamer-private-channels .p-channel_sidebar [data-qa="channel-sidebar-channel"]:has([data-qa*="lock" i]) .p-channel_sidebar__name_text,
body.slick-streamer-active.slick-streamer-private-channels [data-qa="channel_sidebar_channel"]:has([class*="c-icon--lock" i]) [data-qa="channel_sidebar_name"],
body.slick-streamer-active.slick-streamer-private-channels [data-qa="channel_sidebar_channel"]:has([data-qa*="lock" i]) [data-qa="channel_sidebar_name"],
body.slick-streamer-active.slick-streamer-private-channels [data-qa="channel_sidebar_channel"][aria-label^="Private channel" i] [data-qa="channel_sidebar_name"],
body.slick-streamer-active.slick-streamer-private-channels [data-qa="channel_sidebar_channel"][aria-label^="Private channel" i] .p-channel_sidebar__name,
body.slick-streamer-active.slick-streamer-private-channels .c-channel_entity--private .c-channel_entity__name,
body.slick-streamer-active.slick-streamer-private-channels [data-qa*="channel" i]:has([aria-label*="private channel" i]) [data-qa*="name" i],
body.slick-streamer-active.slick-streamer-private-channels .slick-streamer-private-label {
  filter: blur(var(--slick-streamer-blur)) !important;
  color: transparent !important;
  text-shadow: var(--slick-streamer-shadow) !important;
  user-select: none !important;
}
body.slick-streamer-active.slick-streamer-private-channels .slick-streamer-private-row {
  filter: blur(2px) !important;
  user-select: none !important;
}
/* Activity / Unreads feed — redact ONLY private-channel rows (pill carries a lock) and DM rows
   (no channel pill). Public-channel rows (pill without a lock) stay fully readable. The two row
   predicates below — :has(lock) and :not(:has(pill)) — are repeated per group because :has() cannot
   be nested. Sender targets the wrapper class so it survives both the dense and stacked layouts. */
body.slick-streamer-active.slick-streamer-dm-content [data-qa="activity-item-container"]:has([data-qa="inline_channel_entity"] [data-qa="lock-filled"]) [data-qa="activity-item-message"],
body.slick-streamer-active.slick-streamer-dm-content [data-qa="activity-item-container"]:has([data-qa="inline_channel_entity"] [data-qa="lock-filled"]) [class*="activity_row_content__timestamp" i],
body.slick-streamer-active.slick-streamer-dm-content [data-qa="activity-item-container"]:not(:has([data-qa="inline_channel_entity"])) [data-qa="activity-item-message"],
body.slick-streamer-active.slick-streamer-dm-content [data-qa="activity-item-container"]:not(:has([data-qa="inline_channel_entity"])) [class*="activity_row_content__timestamp" i] {
  filter: blur(var(--slick-streamer-blur)) !important;
  color: transparent !important;
  text-shadow: var(--slick-streamer-shadow) !important;
  user-select: none !important;
}
body.slick-streamer-active.slick-streamer-dm-content [data-qa="activity-item-container"]:has([data-qa="inline_channel_entity"] [data-qa="lock-filled"]) [data-qa="activity-item-message"] *,
body.slick-streamer-active.slick-streamer-dm-content [data-qa="activity-item-container"]:not(:has([data-qa="inline_channel_entity"])) [data-qa="activity-item-message"] * {
  color: transparent !important;
  text-shadow: var(--slick-streamer-shadow) !important;
  user-select: none !important;
}
body.slick-streamer-active.slick-streamer-dm-all [data-qa="activity-item-container"]:has([data-qa="inline_channel_entity"] [data-qa="lock-filled"]) [class*="activity_row_content__sender" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa="activity-item-container"]:has([data-qa="inline_channel_entity"] [data-qa="lock-filled"]) [class*="activity_row_content__participant" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa="activity-item-container"]:has([data-qa="inline_channel_entity"] [data-qa="lock-filled"]) [data-qa="message_sender_name"],
body.slick-streamer-active.slick-streamer-dm-all [data-qa="activity-item-container"]:not(:has([data-qa="inline_channel_entity"])) [class*="activity_row_content__sender" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa="activity-item-container"]:not(:has([data-qa="inline_channel_entity"])) [class*="activity_row_content__participant" i],
body.slick-streamer-active.slick-streamer-dm-all [data-qa="activity-item-container"]:not(:has([data-qa="inline_channel_entity"])) [data-qa="message_sender_name"] {
  filter: blur(var(--slick-streamer-blur)) !important;
  color: transparent !important;
  text-shadow: var(--slick-streamer-shadow) !important;
  user-select: none !important;
}
body.slick-streamer-active.slick-streamer-dm-all [data-qa="activity-item-container"]:has([data-qa="inline_channel_entity"] [data-qa="lock-filled"]) .c-avatar,
body.slick-streamer-active.slick-streamer-dm-all [data-qa="activity-item-container"]:not(:has([data-qa="inline_channel_entity"])) .c-avatar {
  filter: blur(var(--slick-streamer-blur)) saturate(.55) !important;
  opacity: .82 !important;
}
body.slick-streamer-active.slick-streamer-private-channels [data-qa="activity-item-container"] [data-qa="inline_channel_entity"]:has(svg[data-qa="lock-filled"]),
body.slick-streamer-active.slick-streamer-private-channels [data-qa="activity-item-container"] [data-qa="inline_channel_entity"]:has([class*="lock" i]) {
  filter: blur(var(--slick-streamer-blur)) !important;
  user-select: none !important;
}
body.slick-streamer-active.slick-streamer-private-channels [data-qa="activity-item-container"] [data-qa="inline_channel_entity"]:has(svg[data-qa="lock-filled"]) [data-qa="inline_channel_entity__name"],
body.slick-streamer-active.slick-streamer-private-channels [data-qa="activity-item-container"] [data-qa="inline_channel_entity"]:has(svg[data-qa="lock-filled"]) .c-channel_entity__name,
body.slick-streamer-active.slick-streamer-private-channels [data-qa="activity-item-container"] [data-qa="inline_channel_entity"]:has([class*="lock" i]) .c-channel_entity__name {
  color: transparent !important;
  text-shadow: var(--slick-streamer-shadow) !important;
}
body.slick-streamer-active.slick-streamer-status [aria-label*="vip" i],
body.slick-streamer-active.slick-streamer-status [title*="vip" i],
body.slick-streamer-active.slick-streamer-status [data-qa*="vip" i],
body.slick-streamer-active .slick-streamer-hide,
body.slick-streamer-active [data-qa*="notification_toast" i],
body.slick-streamer-active [data-qa*="desktop_notification" i],
body.slick-streamer-active [class*="notification_toast" i],
body.slick-streamer-active [class*="desktop_notification" i],
body.slick-streamer-active .p-notification_bar {
  display: none !important;
}
`;

function r(app, fallback) {
  try {
    const all = JSON.parse(fs.readFileSync(SETTINGS_FILE(app), 'utf8'));
    const mode = all && all.StreamerMode && all.StreamerMode.activation;
    if (mode === 'always' || mode === 'screenShare') return mode;
  } catch {}
  return fallback === 'always' ? 'always' : 'screenShare';
}

module.exports = {
  meta: {
    name: 'StreamerMode',
    description: "Hide all the leeks when you're streaming or recording.",
  },
  settings: {
    activation: {
      type: 'select',
      label: 'Activation',
      description: 'Turn on during screen shares, or force it on all the time.',
      default: 'screenShare',
      options: [
        { value: 'screenShare', label: 'While screen sharing' },
        { value: 'always', label: 'Always on' },
      ],
    },
    dmPreviewBlur: {
      type: 'select',
      label: 'Hide DM previews',
      description: 'Choose how much direct-message preview UI should be blurred.',
      default: 'all',
      options: [
        { value: 'all', label: 'User and content/time' },
        { value: 'content', label: 'Content/time only' },
      ],
    },
    privateChannelNames: {
      type: 'boolean',
      label: 'Hide private channel names',
      description: 'Hide private channel names in sidebars, popovers, and profile surfaces.',
      default: true,
    },
    vipStatus: {
      type: 'boolean',
      label: 'Hide VIP status',
      description: 'Hide VIP and non-VIP badges.',
      default: true,
    },
  },
  css: x,
  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
  main(ctx) {
    const a = new Set();
    const i = ctx.settings.activation;
    const isActive = () => r(ctx.app, i) === 'always' || a.size > 0;

    ctx.interceptRequests([`*://slick.streamer-mode/*`], (details) => {
      let url;
      try {
        url = new URL(details.url);
      } catch {
        return { cancel: true };
      }
      if (url.hostname !== 'slick.streamer-mode') return null;
      const id = details.webContentsId;
      if (Number.isInteger(id) && id > 0) {
        if (url.searchParams.get('active') === '1') a.add(id);
        else a.delete(id);
      }
      return { cancel: true };
    });

    const Notification = ctx.electron && ctx.electron.Notification;
    if (Notification && Notification.prototype && !Notification.prototype.__slickStreamerModePatched) {
      const s = Notification.prototype.show;
      Notification.prototype.show = function () {
        if (isActive()) return undefined;
        return s.apply(this, arguments);
      };
      Object.defineProperty(Notification.prototype, '__slickStreamerModePatched', { value: true });
    }

    ctx.onWindow((win) => {
      const wc = win.webContents;
      wc.on('destroyed', () => a.delete(wc.id));
    });
  },
};
