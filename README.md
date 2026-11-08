# Keyboard Ergonomics for Super Productivity

A keyboard-first view and project switcher for [Super Productivity](https://github.com/super-productivity/super-productivity). One user-configurable shortcut opens a searchable picker for **Today, Inbox, Planner, Schedule, Boards, Habits**, and your visible projects. Separate shortcuts toggle the **schedule sidebar** (the clock button in the header), go directly to **Inbox**, and open a **focus session for the keyboard-focused task**. Existing built-in bindings remain unchanged.

This is a small first step toward better keyboard ergonomics—not a Vim emulation layer. It does not intercept `hjkl` or add `g` sequences.

## Install

1. [Download `superprod-keyboard-ergonomics.zip` from the latest release](https://github.com/Hendrik240298/superprod-keyboard-ergonomics/releases/latest/download/superprod-keyboard-ergonomics.zip). **Do not unzip it.**
2. In Super Productivity, open **Settings → Plugins → Choose Plugin File** and upload the ZIP. When upgrading, re-upload the newer ZIP.
3. In **Settings → Keyboard → Plugin Shortcuts**, assign **Find view or project**, **Toggle schedule sidebar**, **Go to Inbox**, and **Open focus setup for focused task** free key combinations. `Alt+P` for the picker, `Alt+S` for the sidebar, `Alt+I` for Inbox, and `Alt+F` for the task focus session are suggestions *if available on your system*. `Shift+P` is already Super Productivity's default **Create project** shortcut. The app does not allow plugins to pre-assign bindings.

**Important:** bind the sidebar key to the plugin's **Toggle schedule sidebar**, not the built-in **Go to Schedule** action. The latter navigates to the full page. Make sure the same key is not assigned to both: built-in and plugin actions can both fire. The picker entry **Schedule · View** intentionally opens the full page; it is separate from the sidebar shortcut.

The sidebar and Inbox actions require the local **v0.2.2** ZIP (or a newer release). GitHub's previously published v0.2.0 does not include them.

The focused-task session action requires the local **v0.2.3** ZIP (or a newer release). Building locally does not publish or install it automatically.

The internal plugin ID remains `superprod-vim-motions` to preserve existing shortcut assignments when upgrading from the earlier project-picker prototype. The plugin may therefore appear as **Find view or project (superprod-vim-motions)** in keyboard settings.

## Use

**v0.2.5:** Configured bindings now work inside Project Kanban's iframe: view/project switcher, schedule sidebar, Inbox, native **Go to Today**, focus setup and List toggle. Hendrik's `Shift+I` goes to Inbox and `Shift+T` goes to Today; navigation does not change task dates. Upgrade Kanban to **v0.8.1+** for focus/List commands. Text fields, IME input, AltGr, held keys and native dialogs are left alone. Key matching follows the host's code/layout normalization, including Space and shifted punctuation. Settings are reread on app/frame focus and route changes; shortcut IDs and assignments are unchanged. The companion adds `getAppState` permission to read keyboard assignments through the documented snapshot API (the snapshot includes app data; only the relevant binding strings are retained, nothing is logged or transmitted). No native task-row keys or arbitrary events are forwarded.

**v0.2.4:** the picker follows theme surface/input/focus tokens and uses readable subdued selection. IME confirmation stays in the search editor, and Enter opens the actually focused result. Opening the switcher above Task Details Popup requires Popup v0.2.6 or newer. Escape returns to details; choosing a destination or Inbox uses the native draft-safe close handler before navigating. Nested native dialogs block navigation, and failed close leaves the picker available to retry. Existing plugin and shortcut IDs are unchanged.

- With an empty query, Today, Inbox, Planner, Schedule, Boards, and Habits appear first, followed by projects. Type any part of a name to filter; approximate subsequence matches also work.
- ↑/↓ moves the selection, Enter opens it, and Escape closes the picker. Clicking an entry opens it; clicking outside closes the picker. Focus returns to its previous location on close.
- Archived and menu-hidden projects are excluded; Inbox appears as its own view. Duplicate project names display their IDs. Up to 30 matches are shown—type to narrow a longer list.
- **Toggle schedule sidebar** clicks the same clock control in Super Productivity's header, opening it when closed and closing it when open. If the button is not present or visible (for example, the feature is disabled or the mobile panel menu is closed), the plugin shows a warning instead of acting on another control.
- **Go to Inbox** opens Inbox directly without the picker. The sidebar toggle does not change the current route: Today stays Today while its right-hand schedule panel opens or closes.
- **Open focus setup for focused task** acts on the task row that currently has keyboard focus (including a subtask), not the running task or the task selected in the detail panel. Enable Focus Mode in the app, focus an unfinished task without subtasks, and press your assigned key. This is equivalent to the task context menu's **Focus session**: it starts tracking that task and opens the native focus UI. Finish the app's normal duration/start step there; the shortcut does not automatically start or reset a session timer. Missing focus, hidden/detached rows, completed tasks, parent tasks, and editors/dialogs are rejected with a warning. If tracking switches but focus setup fails, the error explicitly reports that tracking changed.
- No tasks or projects are created, edited, or deleted. The focus action can switch the currently tracked task. The plugin makes no network requests.

## Build from source

Requires Python 3 and Deno 2. From the repository root:

```sh
deno fmt --check plugin.js plugin_test.js
deno check plugin.js plugin_test.js
deno test --allow-read plugin_test.js
python3 build.py
python3 -m zipfile -t dist/superprod-keyboard-ergonomics.zip
```

Upload `dist/superprod-keyboard-ergonomics.zip` to Super Productivity. The ZIP contains only `manifest.json` and `plugin.js` at its root. [CI](.github/workflows/release.yml) checks pushes and pull requests; a tag matching the manifest version (for example `v0.2.3`) publishes the ZIP as a GitHub Release.

Optional Chromium companion regression (Playwright is test-only, not a runtime dependency): set `PLAYWRIGHT_MODULE` to a scratch-installed Playwright `index.mjs`, optionally set `PLAYWRIGHT_EXECUTABLE_PATH` to an existing Chromium, then run `node tests/iframe-shortcuts.mjs`. This uses actual companion/Kanban source with disposable API/settings fixtures; it checks configured/rebound switcher, sidebar, Inbox, focus and List keys, text protection, reload and unload. Exact ZIP upload and keyboard-setting tests live in the related Task Details Popup project's host test template; supply `KEYBOARD_PLUGIN_ZIP` to its runner and select `--grep 'packaged Kanban menu'`.

## Compatibility and limitations

- The shortcut and project lookup use the [documented plugin API](https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md). The picker runs in the host renderer and navigates by setting Super Productivity's current hash routes; its modal DOM and hash navigation are **not** public Plugin API methods. App upgrades could break them.
- There is no public schedule-sidebar toggle in the plugin API, and the corresponding internal state action is not permitted for plugins. The new shortcut clicks the app's existing `button.e2e-toggle-schedule-day-panel`. That selector is an internal test hook, **not a stable plugin API**. This implementation is desktop-oriented; it does not open the mobile panels menu.
- The task-session action uses the permitted `dispatchAction` actions `[Task] SetCurrentTask` and `[FocusMode] Show Overlay` (falling back to the older `[FocusMode] Show Focus Overlay` name if rejected). Direct session-start dispatch is not allowed by the app. Task-row lookup uses internal DOM hooks: `task`, `data-task-id` or the legacy `t-` ID, and `isDone`/`hasNoSubTasks` classes. App upgrades could break these. If opening the overlay fails after task tracking starts, tracking may already have switched; the plugin reports an error rather than silently claiming success.
- The six built-in destinations use routes from the [upstream router](https://github.com/super-productivity/super-productivity/blob/master/src/app/app.routes.ts). If a view is unavailable or disabled in your app, its entry might not lead to useful content.
- An open app dialog or focused text field can suppress plugin shortcuts. Press your assigned key from a normal app view instead.
- Kanban bridging relies on the host's same-origin `plugin-index iframe[data-plugin-id="project-kanban"]` DOM. It is feature-detected and version-sensitive, not a public shortcut-forwarding API. Without access or keyboard snapshot support, native-host shortcuts remain available outside the iframe. It does not bind keys automatically: unassign conflicting built-in shortcuts, including Create project if you choose `Shift+P`.
- Automated tests cover ranking, routes, registration, the schedule-button click, focused-task action order and safety guards, legacy compatibility, dispatch failures, and a simulated picker interaction—not an installed desktop app. Try a disposable Super Productivity profile before relying on a new release with important data. If a route or an action stops working after an app update, report your Super Productivity version and the action that failed.

Background and next steps: [IDEA.md](IDEA.md) and [PLAN.md](PLAN.md). Licensed under [MIT](LICENSE).
