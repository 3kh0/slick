# Chat Tabs

Enable **Chat Tabs** in Slick’s plugin settings. Visited channels, DMs and threads stay in a tab strip above the main conversation pane. The **+** button beside Slack’s search bar opens a picker with recent places first, matching channel icons and DM avatars, and keyboard search; opening a chat from Slack’s sidebar adds it too.

The tab strip folds away when only one tab is open and returns when you open another.

DMs show the person’s profile picture. Group DMs show stacked pictures and participants’ current display names. Missing pictures fall back to initials. Channel tabs use Slack’s hash, lock and archive icons.

- Right-click a chat or channel and choose **Open in new Slick tab** to open or focus its tab.
- Click a tab to switch chats. Slack keeps each chat’s draft.
- Drag a tab before or after another tab to reorder it. The strip scrolls when dragging near either edge.
- Drag any tab to the right edge of the chat pane to open it in Slack’s split view while keeping the current chat.
- On desktop, **Cmd+W** (**Ctrl+W** on Windows/Linux) closes the selected tab. The final tab keeps the normal window-close shortcut.
- **Ctrl+Tab** switches to the next tab; **Ctrl+Shift+Tab** switches to the previous tab and wraps at either end. **Alt+Shift+Left/Right** also works (including in browsers that reserve Ctrl+Tab).
- With a tab focused, **Ctrl+Shift+Left/Right** reorders it; **Left/Right**, **Home** and **End** select tabs.
- Close a tab with **×**, a middle click, or **Delete** while it is focused. The final tab stays open.
- **Escape** dismisses the chat picker.

Tab destinations and order are saved per account and workspace. Only conversation IDs and thread timestamps are stored; labels and pictures come from Slack’s current cache. Up to 50 tabs are retained. Thread tabs show the thread alone in the main pane. You can also open a thread tab from a message or replies context menu.

Opening a thread normally keeps it in Slack’s side pane without creating a tab. Turn on **Automatically create tabs for threads** in the plugin settings to add side-pane threads to the tab strip too.

Works in desktop Slick, Chromium/Firefox extensions and the userscript. Pop-out windows keep Slack’s normal layout.
