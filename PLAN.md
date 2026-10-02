# Keyboard Ergonomics: implementation and validation

Status: v0.2.0 implements a single configurable view/project switcher. The plugin picker has been observed in a running Super Productivity instance; project/view navigation after the latest changes still needs a manual smoke test. Automated tests pass, but they do not prove compatibility with every installed app version.

## Goal and scope

Reach Today, Inbox, Planner, Schedule, Boards, Habits, or a visible project from a single keyboard picker. Do not replace existing app bindings, implement modal Vim keys, or manipulate project/task data.

## Design

- `PluginAPI.registerShortcut` registers one action, with stable ID `find-project`. Users choose its binding in Super Productivity's Keyboard Settings; the plugin ID `superprod-vim-motions` remains stable so old bindings persist despite the public rename.
- `PluginAPI.getAllProjects()` supplies project names and IDs. Exclude archived/hidden projects and list Inbox as a built-in destination instead. Search ranks exact, prefix, substring, then subsequence matches. Empty query puts views first. Limit display to 30 entries, and show IDs for duplicate project names.
- Host-side `plugin.js` renders a theme-aware, keyboard-operable dialog. It restores focus after closing and removes its DOM/style on plugin unload. Only known app routes are navigated; a selected project's availability is checked again just before opening it.
- Navigation sets a hash route (`#/tag/TODAY/tasks`, `#/project/INBOX_PROJECT/tasks`, `#/planner`, `#/schedule`, `#/boards`, `#/habits`, or `#/project/<id>/tasks`). Super Productivity's upstream router uses hash location, but this is not a documented plugin navigation API. Avoid relying on private Angular services or simulated keypresses.
- Python builds a flat, reproducible ZIP. Deno tests cover sorting/filtering, routes, shortcut registration, and keyboard interaction. GitHub Actions tests and builds on push/PR and attaches the ZIP to a version-tagged release, following the [Project Kanban release approach](https://github.com/Hendrik240298/superprod-kanban).

## Manual release checks

1. Install the ZIP on a disposable app profile; assign a free shortcut (e.g. `Alt+P`). Verify the picker opens from Today, Inbox, and a project and not while typing in an input/dialog.
2. Search each built-in destination and a project; use Enter and click in separate trials. Confirm the app changes view without a reload and that the selected project ID is correct. Check a view that may be disabled in app settings.
3. Test empty query, no results, duplicate project names, accented names, archived/hidden projects, ArrowUp/Down, Escape, and focus return. Close/reopen the picker and disable/re-enable the plugin; check for duplicate overlays or stale UI.
4. Upgrade the plugin from the previous ZIP and verify the user's configured shortcut stays assigned. Validate desktop dark/light themes and an installed version against the declared minimum `14.0.0` if older-app support matters.

## Follow-ups (only if needed)

- Ask upstream for a public `navigateTo...` plugin API to remove the hash-route dependency.
- Add more keyboard actions only for repeated real-world friction. Evaluate the app's existing `J`/`K` and arrow navigation before attempting `hjkl`; never capture typing in text fields.
- Consider a public picker UI API upstream rather than maintaining a host-DOM modal indefinitely.
