// Host-side plugin: Super Productivity loads this file in its renderer.
// Navigation uses the app's public hash URLs, not a PluginAPI navigation method.
const PICKER_ID = "superprod-vim-motions-picker";
const STYLE_ID = "superprod-vim-motions-style";
const SHORTCUT_ID = "find-project";
const SCHEDULE_PANEL_SHORTCUT_ID = "toggle-schedule-day-panel";
const INBOX_SHORTCUT_ID = "go-to-inbox";
const FOCUS_TASK_SHORTCUT_ID = "start-focused-task-session";
let disposed = false;
let cleanupFrameShortcuts = () => {};
// Routes are from Super Productivity's hash-based app router.
const VIEWS = [
  { id: "today", title: "Today", route: "#/tag/TODAY/tasks" },
  { id: "inbox", title: "Inbox", route: "#/project/INBOX_PROJECT/tasks" },
  { id: "planner", title: "Planner", route: "#/planner" },
  { id: "schedule", title: "Schedule", route: "#/schedule" },
  { id: "boards", title: "Boards", route: "#/boards" },
  { id: "habits", title: "Habits", route: "#/habits" },
];
let picker = null;
let previousFocus = null;
let openRequest = 0;

function normalize(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

function matchScore(title, query) {
  const text = normalize(title);
  const needle = normalize(query.trim());
  if (!needle) return 0;
  if (text === needle) return 0;
  if (text.startsWith(needle)) return 1;
  const at = text.indexOf(needle);
  if (at !== -1) return 2 + at / 1000;

  // Subsequence fallback: match "spvm" against "Superprod Vim Motions".
  let position = -1;
  let gaps = 0;
  for (const character of needle) {
    const next = text.indexOf(character, position + 1);
    if (next === -1) return Infinity;
    gaps += next - position - 1;
    position = next;
  }
  return 3 + gaps / 1000;
}

function rankProjects(projects, query) {
  return projects
    .filter((project) =>
      project && typeof project.id === "string" &&
      typeof project.title === "string" &&
      project.id !== "INBOX_PROJECT" && !project.isArchived &&
      !project.isHiddenFromMenu
    )
    .map((project) => ({ project, score: matchScore(project.title, query) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) =>
      a.score - b.score ||
      a.project.title.localeCompare(b.project.title) ||
      a.project.id.localeCompare(b.project.id)
    )
    .map(({ project }) => project);
}

function routeForProject(id) {
  return "#/project/" + encodeURIComponent(id) + "/tasks";
}

function goToInbox() {
  return navigateTo(routeForProject("INBOX_PROJECT"));
}

function nativeOverlayOpen() {
  return Array.from(document.querySelectorAll?.(".cdk-overlay-pane") || [])
    .some((pane) =>
      pane.isConnected && pane.getClientRects().length &&
      pane.children.length &&
      !["hidden", "collapse"].includes(
        window.getComputedStyle?.(pane).visibility,
      ) &&
      !pane.querySelector(
        "mat-snack-bar-container,.mat-mdc-tooltip,mat-tooltip-component",
      )
    );
}

async function navigateTo(route) {
  const request = openRequest;
  let closedDetails = false;
  if (nativeOverlayOpen()) {
    PluginAPI.showSnack({
      msg: "Close the native dialog before navigating",
      type: "WARNING",
    });
    return;
  }
  // Use the existing native close path, never remove the editor or its backdrop.
  const hosts = Array.from(
    document.querySelectorAll?.("right-panel.isOpen") || [],
  );
  for (const host of hosts) {
    const side = Array.from(host.children).find((child) =>
      child.matches(".side") && child.querySelector("task-detail-panel")
    );
    if (!side) continue;
    const nativeClose = side.querySelector(".edge-close-handle");
    try {
      // Task Details Popup hides this control, but its native Enter handler
      // remains the draft-safe close path. Connectivity, not visibility, matters.
      if (!nativeClose?.isConnected) throw new Error("Missing native close");
      document.activeElement?.blur?.();
      if (nativeOverlayOpen()) throw new Error("Native save opened a dialog");
      nativeClose.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
        }),
      );
      // Angular can retain the side during its leave animation. Wait for native
      // state/DOM acknowledgement, with a bounded timeout rather than forcing it.
      for (
        let attempt = 0;
        host.isConnected && host.matches(".isOpen") && side.isConnected &&
        side.querySelector("task-detail-panel");
        attempt++
      ) {
        if (attempt >= 32) throw new Error("Details still open");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      closedDetails = true;
    } catch {
      PluginAPI.showSnack({
        msg: "Task details could not close safely; navigation cancelled",
        type: "WARNING",
      });
      if (request === openRequest && !nativeOverlayOpen()) {
        picker?.querySelector("input")?.focus();
      }
      return;
    }
  }
  if (request !== openRequest) return; // Escape/unload/reopen cancelled this handoff.
  closePicker(!closedDetails);
  window.location.hash = route;
}

function startFocusedTaskSession() {
  const active = document.activeElement;
  if (
    active?.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], mat-dialog-container',
    )
  ) {
    PluginAPI.showSnack({ msg: "Focus a task row first", type: "WARNING" });
    return;
  }
  // DOM focus is intentional: selected/running tasks may be different. closest
  // also picks the innermost subtask when focus is on one of its child controls.
  const row = active?.closest("task");
  const id = row?.getAttribute("data-task-id") ||
    (row?.id?.startsWith("t-") ? row.id.slice(2) : null);
  if (!id || !row.isConnected || !row.getClientRects().length) {
    PluginAPI.showSnack({ msg: "Focus a task row first", type: "WARNING" });
    return;
  }
  if (
    row.classList.contains("isDone") || !row.classList.contains("hasNoSubTasks")
  ) {
    PluginAPI.showSnack({
      msg: "Choose an unfinished task without subtasks",
      type: "WARNING",
    });
    return;
  }
  if (typeof PluginAPI.dispatchAction !== "function") {
    PluginAPI.showSnack({
      msg: "Focus sessions are unavailable here",
      type: "WARNING",
    });
    return;
  }
  // Same two allowed actions as the native task-menu Focus session entry.
  // Opening setup does not bypass the app's duration selection/start step.
  let trackingChanged = false;
  try {
    PluginAPI.dispatchAction({ type: "[Task] SetCurrentTask", id });
    trackingChanged = true;
    try {
      PluginAPI.dispatchAction({ type: "[FocusMode] Show Overlay" });
    } catch {
      // v14 used this name; the bridge rejects unknown actions synchronously.
      PluginAPI.dispatchAction({ type: "[FocusMode] Show Focus Overlay" });
    }
  } catch {
    PluginAPI.showSnack({
      msg: trackingChanged
        ? "Task tracking changed, but focus setup could not open"
        : "Could not change task tracking or open focus setup",
      type: "ERROR",
    });
  }
}

function toggleScheduleDayPanel() {
  // This is the same header button used by the app itself. The plugin API has
  // no schedule-panel toggle, and dispatchAction does not allow its NgRx action.
  const button = Array.from(
    document.querySelectorAll("button.e2e-toggle-schedule-day-panel"),
  ).find((candidate) =>
    candidate.isConnected && candidate.getClientRects().length
  );
  if (!button) {
    PluginAPI.showSnack({
      msg: "Schedule sidebar toggle is unavailable here",
      type: "WARNING",
    });
    return;
  }
  button.click();
}

function rankDestinations(projects, query) {
  const entries = [
    ...VIEWS.map((view, order) => ({ ...view, kind: "view", order })),
    ...rankProjects(projects, "").map((project) => ({
      id: project.id,
      title: project.title,
      route: routeForProject(project.id),
      kind: "project",
    })),
  ];
  return entries
    .map((entry) => ({ entry, score: matchScore(entry.title, query) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) =>
      a.score - b.score ||
      (a.entry.kind === "view" ? 0 : 1) - (b.entry.kind === "view" ? 0 : 1) ||
      (a.entry.order ?? 0) - (b.entry.order ?? 0) ||
      a.entry.title.localeCompare(b.entry.title) ||
      a.entry.id.localeCompare(b.entry.id)
    )
    .map(({ entry }) => entry);
}

function closePicker(restoreFocus = true) {
  if (!picker) return;
  // Invalidate an outstanding getAllProjects() call as well as the active UI.
  openRequest++;
  picker.remove();
  picker = null;
  if (restoreFocus && previousFocus && previousFocus.isConnected) {
    previousFocus.focus();
  }
  previousFocus = null;
}

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${PICKER_ID} { position: fixed; inset: 0; z-index: 2147483646;
      display: flex; align-items: flex-start; justify-content: center;
      padding: min(15vh, 100px) 16px 16px;
      background: var(--c-backdrop, rgba(0,0,0,.55)); }
    #${PICKER_ID} * { box-sizing: border-box; }
    #${PICKER_ID} .spvm-panel { width: min(100%, 560px); max-height: 75vh;
      display: flex; flex-direction: column; padding: 18px;
      border-radius: var(--card-border-radius, 8px);
      font-family: var(--font-primary-stack, inherit); font-size: var(--font-size-md, 14px);
      background: var(--card-bg, #242424); color: var(--text-color, #fff);
      box-shadow: var(--card-shadow, var(--whiteframe-shadow-24dp, 0 16px 48px rgba(0,0,0,.35))); }
    #${PICKER_ID} .spvm-label { font-weight: 600; margin-bottom: 12px; }
    #${PICKER_ID} .spvm-input { width: 100%; padding: 10px 12px; font: inherit;
      background: var(--input-bg, var(--bg, #333)); color: inherit;
      border: 1px solid var(--input-border-color, var(--divider-color, #777));
      border-radius: var(--input-border-radius, 6px); outline-offset: 2px; }
    #${PICKER_ID} .spvm-input:focus { border-color: var(--input-border-color-focus, var(--c-primary, #526da5)); }
    #${PICKER_ID} .spvm-input:focus-visible, #${PICKER_ID} .spvm-option:focus-visible {
      outline: 2px solid var(--focus-ring-color, var(--c-primary, #526da5)); outline-offset: 2px; }
    #${PICKER_ID} .spvm-list { overflow-y: auto; margin: 10px 0 0; padding: 0; list-style: none; }
    #${PICKER_ID} .spvm-option { width: 100%; padding: 10px 12px; text-align: left;
      font: inherit; color: inherit; background: transparent; border: 0;
      border-radius: var(--input-border-radius, 4px);
      cursor: pointer; overflow-wrap: anywhere; }
    #${PICKER_ID} .spvm-option:hover { background: var(--sidenav-hover-bg, color-mix(in srgb, currentColor 6%, transparent)); }
    #${PICKER_ID} .spvm-option[aria-selected="true"] {
      background: var(--sidenav-item-active-bg, color-mix(in srgb, currentColor 8%, transparent));
      color: var(--text-color, inherit); box-shadow: inset 3px 0 var(--c-primary, #526da5); }
    #${PICKER_ID} .spvm-hint { margin: 10px 0 0; font-size: .85em; opacity: .8; }
  `;
  document.head.append(style);
}

async function openPicker() {
  if (nativeOverlayOpen()) {
    PluginAPI.showSnack({
      msg: "Close the native dialog before opening the switcher",
      type: "WARNING",
    });
    return;
  }
  if (picker) {
    picker.querySelector("input").focus();
    return;
  }
  const request = ++openRequest;
  previousFocus = document.activeElement;
  installStyle();

  const backdrop = document.createElement("div");
  backdrop.id = PICKER_ID;
  backdrop.setAttribute("role", "presentation");
  const panel = document.createElement("div");
  panel.className = "spvm-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "spvm-label");
  const label = document.createElement("label");
  label.id = "spvm-label";
  label.className = "spvm-label";
  label.textContent = "Find a view or project";
  label.htmlFor = "spvm-input";
  const input = document.createElement("input");
  input.id = "spvm-input";
  input.className = "spvm-input";
  input.type = "search";
  input.autocomplete = "off";
  input.setAttribute("aria-controls", "spvm-results");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  const results = document.createElement("ul");
  results.id = "spvm-results";
  results.className = "spvm-list";
  results.setAttribute("role", "listbox");
  const hint = document.createElement("p");
  hint.className = "spvm-hint";
  hint.textContent = "↑/↓ choose · Enter open · Esc close";
  panel.append(label, input, results, hint);
  backdrop.append(panel);
  document.body.append(backdrop);
  picker = backdrop;
  input.focus();

  let projects = [];
  let matches = [];
  let selected = 0;

  function render() {
    matches = rankDestinations(projects, input.value).slice(0, 30);
    selected = Math.min(selected, Math.max(0, matches.length - 1));
    const titleCounts = new Map();
    for (const project of rankProjects(projects, "")) {
      const title = normalize(project.title);
      titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
    }
    results.replaceChildren();
    input.removeAttribute("aria-activedescendant");
    if (!matches.length) {
      const empty = document.createElement("li");
      empty.className = "spvm-hint";
      empty.textContent = "No matching views or projects";
      results.append(empty);
      return;
    }
    matches.forEach((destination, index) => {
      const item = document.createElement("li");
      item.setAttribute("role", "option");
      item.id = "spvm-result-" + index;
      item.setAttribute("aria-selected", String(index === selected));
      const button = document.createElement("button");
      button.type = "button";
      button.tabIndex = -1;
      button.className = "spvm-option";
      button.textContent = destination.title +
        (destination.kind === "view"
          ? " · View"
          : titleCounts.get(normalize(destination.title)) > 1
          ? " · " + destination.id
          : "");
      button.setAttribute("aria-selected", String(index === selected));
      button.addEventListener("focus", () => {
        selected = index;
        // Update in place: rerendering here would detach the focused button.
        Array.from(results.children).forEach((option, optionIndex) => {
          const value = String(optionIndex === selected);
          option.setAttribute("aria-selected", value);
          option.querySelector("button").setAttribute("aria-selected", value);
        });
        input.setAttribute("aria-activedescendant", item.id);
      });
      button.addEventListener("click", () => selectDestination(destination));
      item.append(button);
      results.append(item);
    });
    input.setAttribute("aria-activedescendant", "spvm-result-" + selected);
    results.children[selected].scrollIntoView?.({ block: "nearest" });
  }

  async function selectDestination(destination) {
    try {
      if (destination.kind === "project") {
        // Refresh before navigating: the picker may have been open during deletion.
        const current = await PluginAPI.getAllProjects();
        if (picker !== backdrop) return;
        if (
          !current.some((entry) =>
            entry.id === destination.id &&
            !entry.isArchived && !entry.isHiddenFromMenu
          )
        ) {
          projects = current;
          render();
          PluginAPI.showSnack({
            msg: "Project is no longer available",
            type: "WARNING",
          });
          return;
        }
      }
      return navigateTo(destination.route);
    } catch (error) {
      PluginAPI.showSnack({ msg: "Could not open destination", type: "ERROR" });
      console.error("[Project Quick Switcher]", error);
    }
  }

  input.addEventListener("input", () => {
    selected = 0;
    render();
  });
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closePicker();
  });
  backdrop.addEventListener("keydown", (event) => {
    // Enter may confirm an IME candidate; 229 covers older composition events.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePicker();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (matches.length) {
        selected =
          (selected + (event.key === "ArrowDown" ? 1 : -1) + matches.length) %
          matches.length;
        render();
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (matches[selected]) selectDestination(matches[selected]);
    } else if (event.key === "Tab") {
      // The search field is the sole tab stop; arrow keys select results.
      event.preventDefault();
      input.focus();
    }
  });

  render();
  try {
    projects = await PluginAPI.getAllProjects();
    if (picker === backdrop && request === openRequest) render();
  } catch (error) {
    if (picker === backdrop) {
      hint.textContent = "Could not load projects · Views still available";
      console.error("[Project Quick Switcher]", error);
    }
  }
}

PluginAPI.registerShortcut({
  id: SHORTCUT_ID,
  label: "Find view or project",
  onExec: () => {
    void openPicker();
  },
});

PluginAPI.registerShortcut({
  id: SCHEDULE_PANEL_SHORTCUT_ID,
  label: "Toggle schedule sidebar",
  onExec: toggleScheduleDayPanel,
});

PluginAPI.registerShortcut({
  id: INBOX_SHORTCUT_ID,
  label: "Go to Inbox",
  onExec: goToInbox,
});

PluginAPI.registerShortcut({
  id: FOCUS_TASK_SHORTCUT_ID,
  label: "Open focus setup for focused task",
  onExec: startFocusedTaskSession,
});

// A same-origin Kanban iframe does not bubble keyboard events to the app.
// Handle only known navigation/companion commands, never replay
// arbitrary keys into the host or inspect Angular internals.
function matchesAssignedKey(event, combination, layout) {
  if (typeof combination !== "string" || !combination) return false;
  const parts = combination.toLowerCase().split("+").filter(Boolean);
  const key = combination.endsWith("+") ? "+" : parts.pop();
  if (parts.some((p) => !["ctrl", "alt", "meta", "shift"].includes(p))) {
    return false;
  }
  const modifiers = {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    meta: event.metaKey,
    shift: event.shiftKey,
  };
  // Match upstream prepareKeyCode: fixed +/- codes precede the public layout
  // map, then strip Key/Digit prefixes. event.key contains shifted glyphs.
  const code = event.code || "";
  const pressed = code === "Minus"
    ? "-"
    : code === "Equal"
    ? "+"
    : (layout?.get(code)?.toUpperCase() || code).replace(/^(Key|Digit)/, "");
  return Object.entries(modifiers).every(([name, down]) =>
    !!down === parts.includes(name)
  ) && pressed.toLowerCase() === key;
}

async function installFrameShortcuts() {
  if (
    disposed || typeof PluginAPI.getAppState !== "function" ||
    typeof MutationObserver === "undefined"
  ) return;
  const frames = new Map();
  let assignments = [];
  let layout;
  let generation = 0;
  const commands = [
    ["goToTimeline", () => navigateTo("#/tag/TODAY/tasks")],
    [`plugin_superprod-vim-motions:${SHORTCUT_ID}`, () => openPicker()],
    [
      `plugin_superprod-vim-motions:${SCHEDULE_PANEL_SHORTCUT_ID}`,
      () => toggleScheduleDayPanel(),
    ],
    [`plugin_superprod-vim-motions:${INBOX_SHORTCUT_ID}`, () => goToInbox()],
    [
      `plugin_superprod-vim-motions:${FOCUS_TASK_SHORTCUT_ID}`,
      (frame) => boardCommand(frame, "focus-setup"),
    ],
    [
      "plugin_project-kanban:toggle-project-view",
      (frame) => boardCommand(frame, "list"),
    ],
  ];
  function boardCommand(frame, command) {
    if (
      frame.contentDocument.documentElement.dataset.kanbanKeyboardCommands !==
        "1"
    ) {
      PluginAPI.showSnack({
        msg: "Update Project Kanban to use this shortcut on the board",
        type: "WARNING",
      });
      return;
    }
    frame.contentWindow.postMessage({
      type: "superprod-keyboard-command",
      command,
    }, "*");
  }
  async function refresh() {
    const request = ++generation;
    let nextLayout;
    try {
      nextLayout = await globalThis.navigator?.keyboard?.getLayoutMap();
    } catch { /* Unavailable/denied API: use upstream's code-only fallback. */ }
    try {
      // The documented snapshot API is the available route to keyboard settings.
      // Retain only known binding strings; never retain/log task or note data.
      const keyboard =
        (await PluginAPI.getAppState())?.globalConfig?.keyboard || {};
      if (disposed || request !== generation) return;
      layout = nextLayout;
      assignments = commands.map(([id, action]) => [keyboard[id], action])
        .filter(([combination]) =>
          typeof combination === "string" && combination
        );
    } catch {
      if (request === generation) assignments = [];
    }
  }
  function attach(frame) {
    frames.get(frame)?.();
    const doc = frame.contentDocument;
    if (!doc) return;
    const onKey = (event) => {
      if (
        disposed || event.defaultPrevented || event.repeat ||
        event.isComposing ||
        event.getModifierState?.("AltGraph") || picker || nativeOverlayOpen() ||
        !frame.isConnected || frame.contentDocument !== doc ||
        !frame.getClientRects().length || frame.closest("[inert]") ||
        event.target?.closest?.(
          'input,textarea,select,[contenteditable],[role="textbox"],[inert]',
        )
      ) return;
      const match = assignments.find(([combination]) =>
        matchesAssignedKey(event, combination, layout)
      );
      if (!match) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void Promise.resolve().then(() => {
        if (!disposed && frame.isConnected && frame.contentDocument === doc) {
          return match[1](frame);
        }
      }).catch(() =>
        PluginAPI.showSnack({
          msg: "Could not run board shortcut",
          type: "ERROR",
        })
      );
    };
    doc.addEventListener("keydown", onKey, true);
    frame.contentWindow.addEventListener("focus", refresh);
    const onLoad = () => {
      attach(frame);
      void refresh();
    };
    frame.addEventListener("load", onLoad);
    frames.set(frame, () => {
      doc.removeEventListener("keydown", onKey, true);
      doc.defaultView?.removeEventListener("focus", refresh);
      frame.removeEventListener("load", onLoad);
    });
  }
  function scan() {
    for (const [frame, cleanup] of frames) {
      if (!frame.isConnected) {
        cleanup();
        frames.delete(frame);
      }
    }
    for (
      const frame of document.querySelectorAll(
        'plugin-index iframe[data-plugin-id="project-kanban"]',
      )
    ) {
      if (!frames.has(frame)) {
        try {
          attach(frame);
        } catch { /* An inaccessible frame is not our keyboard surface. */ }
      }
    }
  }
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("hashchange", refresh);
  window.addEventListener("focus", refresh);
  cleanupFrameShortcuts = () => {
    generation++;
    observer.disconnect();
    window.removeEventListener("hashchange", refresh);
    window.removeEventListener("focus", refresh);
    for (const cleanup of frames.values()) cleanup();
    frames.clear();
    assignments = [];
  };
  scan();
  await refresh();
}

if (typeof PluginAPI.onReady === "function") {
  PluginAPI.onReady(installFrameShortcuts);
}
const cleanup = () => {
  disposed = true;
  cleanupFrameShortcuts();
  closePicker(false);
  document.getElementById(STYLE_ID)?.remove();
};
if (typeof PluginAPI.onUnload === "function") PluginAPI.onUnload(cleanup);
else if (typeof plugin !== "undefined" && plugin.onUnload) {
  plugin.onUnload(cleanup);
}
