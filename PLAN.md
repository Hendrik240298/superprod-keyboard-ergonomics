# Keyboard Ergonomics: implementation and validation

Status: local v0.2.3 adds a configurable focused-task focus-session action alongside the view/project switcher, schedule-sidebar toggle, and direct Inbox shortcut. The picker has been observed in a running Super Productivity instance; the newer shortcuts still need a manual smoke test. Automated tests pass, but they do not prove compatibility with every installed app version.

## Goal and scope

Reach Today, Inbox, Planner, Schedule, Boards, Habits, or a visible project from a keyboard picker. Provide separate configurable shortcuts for the schedule sidebar, Inbox, and the native focused-task focus-session flow. Do not replace existing app bindings, implement modal Vim keys, or edit project/task records. The focus action intentionally starts/switches task tracking.

## Design

- `PluginAPI.registerShortcut` registers the picker action with stable ID `find-project`. Users choose bindings in Super Productivity's Keyboard Settings; the plugin ID `superprod-vim-motions` remains stable so old bindings persist despite the public rename.
- A second stable shortcut, `toggle-schedule-day-panel`, clicks the same visible header clock button as the app. There is no public plugin toggle and its internal state action is not allowed by `dispatchAction`; the internal `e2e-toggle-schedule-day-panel` selector may change with app updates. If the button is unavailable, show a warning rather than guessing from icons or localized labels.
- A third stable shortcut, `go-to-inbox`, closes any picker and opens the Inbox hash route directly. The sidebar action never sets a route; its regression test verifies opening and closing while the Today route stays unchanged. Bind it separately from the built-in full-page Schedule action, without conflicting keys.
- A fourth stable shortcut, `start-focused-task-session`, resolves the innermost keyboard-focused `task` row and dispatches `[Task] SetCurrentTask` followed by `[FocusMode] Show Overlay`, matching the native task-menu action. Older apps use `[FocusMode] Show Focus Overlay`; try that only when the modern action is rejected. Use `data-task-id` or the legacy `t-` ID. Refuse editors/dialogs, missing/hidden/detached rows, completed tasks, and tasks with subtasks. The app controls duration selection and actual timer start; direct session-start dispatch is not allowed. No private Angular services or simulated keypresses are used.
- `PluginAPI.getAllProjects()` supplies project names and IDs. Exclude archived/hidden projects and list Inbox as a built-in destination instead. Search ranks exact, prefix, substring, then subsequence matches. Empty query puts views first. Limit display to 30 entries, and show IDs for duplicate project names.
- Host-side `plugin.js` renders a theme-aware, keyboard-operable dialog. It restores focus after closing and removes its DOM/style on plugin unload. Only known app routes are navigated; a selected project's availability is checked again just before opening it.
- Navigation sets a hash route (`#/tag/TODAY/tasks`, `#/project/INBOX_PROJECT/tasks`, `#/planner`, `#/schedule`, `#/boards`, `#/habits`, or `#/project/<id>/tasks`). Super Productivity's upstream router uses hash location, but this is not a documented plugin navigation API. Avoid relying on private Angular services or simulated keypresses.
- Python builds a flat, reproducible ZIP. Deno tests cover sorting/filtering, routes, shortcut registration, and keyboard interaction. GitHub Actions tests and builds on push/PR and attaches the ZIP to a version-tagged release, following the [Project Kanban release approach](https://github.com/Hendrik240298/superprod-kanban).

## Manual release checks

1. Install the ZIP on a disposable app profile; assign a free shortcut (e.g. `Alt+P`). Verify the picker opens from Today, Inbox, and a project and not while typing in an input/dialog.
2. Search each built-in destination and a project; use Enter and click in separate trials. Confirm the app changes view without a reload and that the selected project ID is correct. Check a view that may be disabled in app settings.
3. Test empty query, no results, duplicate project names, accented names, archived/hidden projects, ArrowUp/Down, Escape, and focus return. Close/reopen the picker and disable/re-enable the plugin; check for duplicate overlays or stale UI.
4. Upgrade the plugin from the previous ZIP and verify the user's configured shortcut stays assigned. Validate desktop dark/light themes and an installed version against the declared minimum `14.0.0` if older-app support matters.
5. Assign a free key to **Toggle schedule sidebar**. From Today and a project, toggle twice and verify open → closed → open, then test while typing and with the schedule-day-panel feature disabled. Confirm an unavailable button warns rather than clicking the full Schedule view. Try narrow/mobile layout to verify the documented desktop limitation.
6. Assign **Go to Inbox** a distinct free key. From Today and a project, verify it goes straight to Inbox without a picker or project lookup. Confirm repeating it in Inbox is harmless and typing in a field is unaffected.
7. Enable Focus Mode and assign **Start focus session for focused task** a distinct free key (e.g. `Alt+F`). Focus task B while task A is tracked/selected elsewhere; verify B becomes tracked and the native focus UI targets B. Finish the native duration/start step. Repeat with a leaf subtask. Check no focused task, completed/parent tasks, editing, and dialogs do not change tracking. If a session is already running, verify the normal app behavior (the shortcut does not reset its timer). Test a legacy app if v14 compatibility matters; these are manual checks, not automated desktop verification.

## Follow-ups (only if needed)

- Ask upstream for a public `navigateTo...` plugin API to remove the hash-route dependency.
- Add more keyboard actions only for repeated real-world friction. Evaluate the app's existing `J`/`K` and arrow navigation before attempting `hjkl`; never capture typing in text fields.
- Consider a public picker UI API upstream rather than maintaining a host-DOM modal indefinitely.
