# Chat Tabs

Enable **Chat Tabs** in Slick’s plugin settings. Visited channels, DMs and threads stay in a tab strip above the main conversation pane. The **+** button beside Slack’s search bar opens a picker with recent places first, matching channel icons and DM avatars, and keyboard search; opening a chat from Slack’s sidebar adds it too.

For browser-style tabs, set **Opening a chat from Slack** to **Replaces the current tab**. Clicking a chat in the sidebar, a link or a search result then opens it in the selected tab instead of adding one; a chat that already has a tab just selects that tab. New tabs come only from the **+** picker, **Open in new Slick tab**, and middle- or Cmd/Ctrl-clicks on sidebar chats.

The tab strip folds away when only one tab is open and returns when you open another.

DMs show the person’s profile picture. Group DMs show stacked pictures and participants’ current display names. Missing pictures fall back to initials. Channel tabs use Slack’s hash, lock and archive icons.

- Right-click a chat or channel and choose **Open in new Slick tab** to open or focus its tab.
- Middle-click or **Cmd**-click (**Ctrl**-click on Windows/Linux) a channel or DM in Slack’s sidebar to add it as a background tab, in either mode. Hold **Shift** as well to switch to it. **Cmd+Option**-click (**Ctrl+Alt**-click) still opens Slack’s split view.
- Click a tab to switch chats. Slack keeps each chat’s draft.
- Drag a tab before or after another tab to reorder it. The strip scrolls when dragging near either edge.
- Drag any tab to the right edge of the chat pane to open it in Slack’s split view while keeping the current chat.
- On desktop, **Cmd+W** (**Ctrl+W** on Windows/Linux) closes the selected tab. The final tab keeps the normal window-close shortcut.
- **Ctrl+Tab** switches to the next tab; **Ctrl+Shift+Tab** switches to the previous tab and wraps at either end. **Alt+Shift+Left/Right** also works (including in browsers that reserve Ctrl+Tab).
- With a tab focused, **Ctrl+Shift+Left/Right** reorders it; **Left/Right**, **Home** and **End** select tabs.
- Close a tab with **×**, a middle click, or **Delete** while it is focused. The final tab stays open.
- **Escape** dismisses the chat picker.

Tab destinations and order are saved per account and workspace. Only conversation IDs and thread timestamps are stored; labels and pictures come from Slack’s current cache. Up to 50 tabs are retained. Thread tabs show the thread alone in the main pane. You can also open a thread tab from a message or replies context menu.

Opening a thread normally keeps it in Slack’s side pane without creating a tab. Turn on **Automatically create tabs for threads** in the plugin settings to add side-pane threads to the tab strip too. These thread tabs are added even when sidebar chats replace the current tab.

Set **Open thread tabs in** to **Channel and thread pane** to keep the channel visible when selecting a thread tab. **Thread only** opens the thread in the main pane.

The plugin settings also let you keep the bar visible with one tab, stop keyboard switching at either end, choose the left or right neighbor after closing a tab, disable middle-click closing, and disable dragging to split view while retaining drag-to-reorder. Preferences take effect immediately and apply to saved tabs too.

Works in desktop Slick, Chromium/Firefox extensions and the userscript. Pop-out windows keep Slack’s normal layout.
