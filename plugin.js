// Host-side plugin: Super Productivity loads this file in its renderer.
// Navigation uses the app's public hash URLs, not a PluginAPI navigation method.
const PICKER_ID = "superprod-vim-motions-picker";
const STYLE_ID = "superprod-vim-motions-style";
const SHORTCUT_ID = "find-project";
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
      display: flex; flex-direction: column; padding: 18px; border-radius: 10px;
      background: var(--card-bg, #242424); color: var(--text-color, #fff);
      box-shadow: var(--whiteframe-shadow-24dp, 0 16px 48px rgba(0,0,0,.35)); }
    #${PICKER_ID} .spvm-label { font-weight: 600; margin-bottom: 12px; }
    #${PICKER_ID} .spvm-input { width: 100%; padding: 10px 12px; font: inherit;
      background: var(--bg, #333); color: inherit; border: 1px solid var(--divider-color, #777);
      border-radius: 6px; outline-offset: 2px; }
    #${PICKER_ID} .spvm-list { overflow-y: auto; margin: 10px 0 0; padding: 0; list-style: none; }
    #${PICKER_ID} .spvm-option { width: 100%; padding: 10px 12px; text-align: left;
      font: inherit; color: inherit; background: transparent; border: 0; border-radius: 4px;
      cursor: pointer; overflow-wrap: anywhere; }
    #${PICKER_ID} .spvm-option:hover, #${PICKER_ID} .spvm-option[aria-selected="true"] {
      background: var(--c-primary, #526da5); color: var(--c-contrast, #fff); }
    #${PICKER_ID} .spvm-hint { margin: 10px 0 0; font-size: .85em; opacity: .8; }
  `;
  document.head.append(style);
}

async function openPicker() {
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
      button.className = "spvm-option";
      button.textContent = destination.title +
        (destination.kind === "view"
          ? " · View"
          : titleCounts.get(normalize(destination.title)) > 1
          ? " · " + destination.id
          : "");
      button.setAttribute("aria-selected", String(index === selected));
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
      closePicker();
      window.location.hash = destination.route;
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

if (typeof plugin !== "undefined" && plugin.onUnload) {
  plugin.onUnload(() => {
    closePicker(false);
    document.getElementById(STYLE_ID)?.remove();
  });
}
