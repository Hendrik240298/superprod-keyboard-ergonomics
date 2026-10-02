# Keyboard Ergonomics for Super Productivity

A keyboard-first view and project switcher for [Super Productivity](https://github.com/super-productivity/super-productivity). One user-configurable shortcut opens a searchable picker for **Today, Inbox, Planner, Schedule, Boards, Habits**, and your visible projects. Type to filter, use ↑/↓ to choose, Enter to open, and Escape to close. Your existing shortcuts for Today and Inbox are unchanged.

This is a small first step toward better keyboard ergonomics—not a Vim emulation layer. It does not intercept `hjkl` or add `g` sequences.

## Install

1. [Download `superprod-keyboard-ergonomics.zip` from the latest release](https://github.com/Hendrik240298/superprod-keyboard-ergonomics/releases/latest/download/superprod-keyboard-ergonomics.zip). **Do not unzip it.**
2. In Super Productivity, open **Settings → Plugins → Choose Plugin File** and upload the ZIP. When upgrading, re-upload the newer ZIP.
3. In **Settings → Keyboard → Plugin Shortcuts**, assign **Find view or project** a free key combination. `Alt+P` is one suggestion; `Shift+P` is already Super Productivity's default **Create project** shortcut. The app does not allow plugins to pre-assign a binding.

The internal plugin ID remains `superprod-vim-motions` to preserve existing shortcut assignments when upgrading from the earlier project-picker prototype. The plugin may therefore appear as **Find view or project (superprod-vim-motions)** in keyboard settings.

## Use

- With an empty query, Today, Inbox, Planner, Schedule, Boards, and Habits appear first, followed by projects. Type any part of a name to filter; approximate subsequence matches also work.
- ↑/↓ moves the selection, Enter opens it, and Escape closes the picker. Clicking an entry opens it; clicking outside closes the picker. Focus returns to its previous location on close.
- Archived and menu-hidden projects are excluded; Inbox appears as its own view. Duplicate project names display their IDs. Up to 30 matches are shown—type to narrow a longer list.
- No tasks or projects are created, edited, or deleted. The plugin makes no network requests.

## Build from source

Requires Python 3 and Deno 2. From the repository root:

```sh
deno fmt --check plugin.js plugin_test.js
deno check plugin.js plugin_test.js
deno test --allow-read plugin_test.js
python3 build.py
python3 -m zipfile -t dist/superprod-keyboard-ergonomics.zip
```

Upload `dist/superprod-keyboard-ergonomics.zip` to Super Productivity. The ZIP contains only `manifest.json` and `plugin.js` at its root. [CI](.github/workflows/release.yml) checks pushes and pull requests; a tag matching the manifest version (for example `v0.2.0`) publishes the ZIP as a GitHub Release.

## Compatibility and limitations

- The shortcut and project lookup use the [documented plugin API](https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md). The picker runs in the host renderer and navigates by setting Super Productivity's current hash routes; its modal DOM and hash navigation are **not** public Plugin API methods. App upgrades could break them.
- The six built-in destinations use routes from the [upstream router](https://github.com/super-productivity/super-productivity/blob/master/src/app/app.routes.ts). If a view is unavailable or disabled in your app, its entry might not lead to useful content.
- An open app dialog or focused text field can suppress plugin shortcuts. Press your assigned key from a normal app view instead.
- Automated tests cover ranking, routes, registration, and a simulated picker interaction—not an installed desktop app. Try a disposable Super Productivity profile before relying on a new release with important data. If a route changes after an app update, report your Super Productivity version and the destination that failed.

Background and next steps: [IDEA.md](IDEA.md) and [PLAN.md](PLAN.md). Licensed under [MIT](LICENSE).
