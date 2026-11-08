// Run: deno test --allow-read projects/superprod-vim-motions/code/plugin_test.js
const source = await Deno.readTextFile(new URL("./plugin.js", import.meta.url));
const shortcuts = [];
const api = { registerShortcut: (shortcut) => shortcuts.push(shortcut) };
const { rankProjects, rankDestinations, routeForProject, matchScore } =
  new Function(
    "PluginAPI",
    "document",
    "window",
    source +
      "\nreturn {rankProjects, rankDestinations, routeForProject, matchScore};",
  )(api, {}, {});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

Deno.test("iframe assignments use host code normalization and exact modifiers", () => {
  const matches = new Function(
    "PluginAPI",
    "document",
    "window",
    source + "\nreturn matchesAssignedKey;",
  )({ registerShortcut() {} }, {}, {});
  const layout = new Map([
    ["KeyQ", "a"],
    ["Digit1", "&"],
    ["Space", " "],
    ["Minus", "ß"],
    ["Equal", "´"],
    ["BracketLeft", "ü"],
  ]);
  for (
    const [code, key, combination, modifiers, map] of [
      ["Space", " ", "Ctrl+Space", { ctrlKey: true }],
      ["Digit1", "!", "Shift+1", { shiftKey: true }],
      ["Slash", "?", "Shift+Slash", { shiftKey: true }],
      ["Minus", "_", "Shift+-", { shiftKey: true }, layout],
      ["Equal", "+", "Shift++", { shiftKey: true }, layout],
      ["KeyP", "P", "Shift+P", { shiftKey: true }],
      ["KeyQ", "A", "Shift+A", { shiftKey: true }, layout],
      ["Digit1", "1", "Shift+&", { shiftKey: true }, layout],
      ["Space", " ", "Ctrl+ ", { ctrlKey: true }, layout],
      ["BracketLeft", "Ü", "Shift+Ü", { shiftKey: true }, layout],
    ]
  ) {
    const event = { code, key, ...modifiers };
    assert(
      matches(event, combination, map),
      `${combination} did not match ${code}`,
    );
    for (const modifier of ["ctrlKey", "altKey", "metaKey", "shiftKey"]) {
      assert(
        !matches({ ...event, [modifier]: !event[modifier] }, combination, map),
        `${combination} ignored extra/missing ${modifier}`,
      );
    }
  }
  assert(
    !matches({ code: "KeyQ", key: "a", shiftKey: true }, "Shift+Q", layout),
    "physical position overrode the public layout map",
  );
});

Deno.test("registers stable navigation and focused-task session actions", () => {
  assert(shortcuts.length === 4, "expected four shortcuts");
  assert(shortcuts[0].id === "find-project", "shortcut id must stay stable");
  assert(
    shortcuts[1].id === "toggle-schedule-day-panel",
    "schedule shortcut id must stay stable",
  );
  assert(
    typeof shortcuts[0].onExec === "function",
    "missing shortcut callback",
  );
  assert(
    typeof shortcuts[1].onExec === "function",
    "missing schedule shortcut callback",
  );
  assert(
    shortcuts[2].id === "go-to-inbox",
    "Inbox shortcut id must stay stable",
  );
  assert(typeof shortcuts[2].onExec === "function", "missing Inbox callback");
  assert(
    shortcuts[3].id === "start-focused-task-session",
    "missing focus action",
  );
  assert(typeof shortcuts[3].onExec === "function", "missing focus callback");
  assert(
    shortcuts[3].label === "Open focus setup for focused task",
    "focus label promises more than setup",
  );
  assert(
    shortcuts.every((shortcut) =>
      !Object.hasOwn(shortcut, "key") && !Object.hasOwn(shortcut, "keys")
    ),
    "must not force key assignments",
  );
});

Deno.test("focus shortcut starts the focused leaf task before opening native focus mode", () => {
  const actions = [];
  const local = [];
  const row = {
    id: "t-subtask",
    isConnected: true,
    getClientRects: () => [{ width: 200 }],
    getAttribute: (name) => name === "data-task-id" ? "subtask" : null,
    classList: { contains: (name) => name === "hasNoSubTasks" },
  };
  const active = {
    closest: (selector) => selector === "task" ? row : null,
  };
  const location = { hash: "#/tag/TODAY/tasks" };
  new Function("PluginAPI", "document", "window", source)(
    {
      registerShortcut: (shortcut) => local.push(shortcut),
      dispatchAction: (action) => actions.push(action),
      showSnack() {
        throw new Error("unexpected warning");
      },
    },
    { activeElement: active },
    { location },
  );
  const shortcut = local.find((entry) =>
    entry.id === "start-focused-task-session"
  );
  assert(shortcut, "focus shortcut is not registered");
  shortcut.onExec();
  assert(
    JSON.stringify(actions) === JSON.stringify([
      { type: "[Task] SetCurrentTask", id: "subtask" },
      { type: "[FocusMode] Show Overlay" },
    ]),
    "must target the keyboard-focused task, not the selected or running task",
  );
  assert(location.hash === "#/tag/TODAY/tasks", "focus action changed route");
});

for (
  const scenario of [
    { name: "no task has focus", noRow: true },
    { name: "row is detached", detached: true },
    { name: "row is hidden", hidden: true },
    { name: "task is completed", done: true },
    { name: "task has subtasks", parent: true },
    { name: "task ID is missing", noId: true },
    { name: "focus is in an editor", editor: true },
    { name: "focus is inside a dialog", dialog: true },
    { name: "dispatch API is unavailable", noDispatch: true },
  ]
) {
  Deno.test(`focus shortcut warns without dispatching when ${scenario.name}`, () => {
    const actions = [];
    const snacks = [];
    const local = [];
    const row = {
      id: scenario.noId ? "" : "t-task",
      isConnected: !scenario.detached,
      getClientRects: () => scenario.hidden ? [] : [{ width: 200 }],
      getAttribute: () => scenario.noId ? null : "task",
      classList: {
        contains: (name) =>
          name === "isDone" ? !!scenario.done : !scenario.parent,
      },
    };
    const doc = {
      activeElement: {
        closest: (selector) => {
          if (selector === "task") return scenario.noRow ? null : row;
          if (selector.includes("input") && scenario.editor) return {};
          if (selector.includes("dialog") && scenario.dialog) return {};
          return null;
        },
      },
    };
    const api = {
      registerShortcut: (shortcut) => local.push(shortcut),
      showSnack: (snack) => snacks.push(snack),
    };
    if (!scenario.noDispatch) {
      api.dispatchAction = (action) => actions.push(action);
    }
    new Function("PluginAPI", "document", "window", source)(api, doc, {});
    local.find((entry) => entry.id === "start-focused-task-session").onExec();
    assert(actions.length === 0, "unsafe task action was dispatched");
    assert(
      snacks.length === 1 && snacks[0].type === "WARNING",
      "missing warning",
    );
  });
}

Deno.test("focus shortcut supports older task rows with only a t-prefixed ID", () => {
  const actions = [];
  const local = [];
  const row = {
    id: "t-old-task",
    isConnected: true,
    getClientRects: () => [{ width: 200 }],
    getAttribute: () => null,
    classList: { contains: (name) => name === "hasNoSubTasks" },
  };
  new Function("PluginAPI", "document", "window", source)(
    {
      registerShortcut: (shortcut) => local.push(shortcut),
      dispatchAction: (action) => actions.push(action),
      showSnack() {
        throw new Error("unexpected warning");
      },
    },
    {
      activeElement: {
        closest: (selector) => selector === "task" ? row : null,
      },
    },
    {},
  );
  local.find((entry) => entry.id === "start-focused-task-session").onExec();
  assert(actions[0].id === "old-task", "older row ID was not resolved");
});

Deno.test("focus shortcut falls back to the legacy allowed focus-overlay action", () => {
  const actions = [];
  const local = [];
  const row = {
    id: "t-task",
    isConnected: true,
    getClientRects: () => [{ width: 200 }],
    getAttribute: () => "task",
    classList: { contains: (name) => name === "hasNoSubTasks" },
  };
  new Function("PluginAPI", "document", "window", source)(
    {
      registerShortcut: (shortcut) => local.push(shortcut),
      dispatchAction(action) {
        if (action.type === "[FocusMode] Show Overlay") {
          throw new Error("action not allowed");
        }
        actions.push(action);
      },
      showSnack() {
        throw new Error("unexpected error notice");
      },
    },
    {
      activeElement: {
        closest: (selector) => selector === "task" ? row : null,
      },
    },
    {},
  );
  local.find((entry) => entry.id === "start-focused-task-session").onExec();
  assert(
    actions.length === 2 &&
      actions[1].type === "[FocusMode] Show Focus Overlay",
    "legacy overlay action was not dispatched",
  );
});

Deno.test("focus shortcut reports rejected native actions without throwing", () => {
  const snacks = [];
  const local = [];
  const row = {
    id: "t-task",
    isConnected: true,
    getClientRects: () => [{ width: 200 }],
    getAttribute: () => "task",
    classList: { contains: (name) => name === "hasNoSubTasks" },
  };
  new Function("PluginAPI", "document", "window", source)(
    {
      registerShortcut: (shortcut) => local.push(shortcut),
      dispatchAction() {
        throw new Error("action not allowed");
      },
      showSnack: (snack) => snacks.push(snack),
    },
    {
      activeElement: {
        closest: (selector) => selector === "task" ? row : null,
      },
    },
    {},
  );
  local.find((entry) => entry.id === "start-focused-task-session").onExec();
  assert(
    snacks.length === 1 && snacks[0].type === "ERROR",
    "missing error notice",
  );
});

Deno.test("focus setup failure explicitly reports tracking already changed without rollback", () => {
  const { doc, original, fakeApi, local, snacks } = pickerFixture();
  const actions = [];
  const row = doc.createElement("task");
  row.setAttribute("data-task-id", "focused");
  row.classList = { contains: (name) => name === "hasNoSubTasks" };
  doc.body.append(row);
  original.closest = (selector) => selector === "task" ? row : null;
  fakeApi.dispatchAction = (action) => {
    actions.push(action);
    if (action.type !== "[Task] SetCurrentTask") {
      throw new Error("unsupported overlay");
    }
  };
  local.find((entry) => entry.id === "start-focused-task-session").onExec();
  assert(
    actions.length === 3,
    "must try both overlays and never guess a rollback action",
  );
  assert(
    snacks.length === 1 && snacks[0].type === "ERROR",
    "missing failure notice",
  );
  assert(
    snacks[0].msg === "Task tracking changed, but focus setup could not open",
    "partial failure hides tracking change",
  );
});

Deno.test("schedule shortcut clicks the visible header toggle only", () => {
  let clickCount = 0;
  let sidebarOpen = false;
  const location = { hash: "#/tag/TODAY/tasks" };
  const snacks = [];
  const hidden = {
    isConnected: true,
    getClientRects: () => [],
    click: () => {
      throw new Error("hidden button clicked");
    },
  };
  const visible = {
    isConnected: true,
    getClientRects: () => [{ width: 40 }],
    click: () => {
      clickCount++;
      sidebarOpen = !sidebarOpen;
    },
  };
  let candidates = [hidden, visible];
  const doc = {
    querySelectorAll: (selector) => {
      assert(
        selector === "button.e2e-toggle-schedule-day-panel",
        "wrong control selected",
      );
      return candidates;
    },
  };
  const local = [];
  new Function("PluginAPI", "document", "window", source)(
    {
      registerShortcut: (shortcut) => local.push(shortcut),
      showSnack: (snack) => snacks.push(snack),
    },
    doc,
    { location },
  );
  local[1].onExec();
  assert(sidebarOpen, "sidebar did not open");
  assert(
    location.hash === "#/tag/TODAY/tasks",
    "toggle navigated away from Today",
  );
  local[1].onExec();
  assert(!sidebarOpen, "sidebar did not close");
  assert(
    location.hash === "#/tag/TODAY/tasks",
    "toggle opened the full Schedule view",
  );
  assert(clickCount === 2, "toggle did not fire on both presses");
  assert(snacks.length === 0, "unexpected warning with visible button");
  candidates = [hidden];
  local[1].onExec();
  assert(clickCount === 2, "clicked hidden button");
  assert(
    snacks.length === 1 && snacks[0].type === "WARNING",
    "missing warning",
  );
  assert(
    location.hash === "#/tag/TODAY/tasks",
    "missing button navigated away",
  );
});

Deno.test("Inbox shortcut opens Inbox directly without reading projects", () => {
  const local = [];
  const location = { hash: "#/tag/TODAY/tasks" };
  new Function("PluginAPI", "document", "window", source)(
    { registerShortcut: (shortcut) => local.push(shortcut) },
    {},
    { location },
  );
  local.find((shortcut) => shortcut.id === "go-to-inbox").onExec();
  assert(
    location.hash === "#/project/INBOX_PROJECT/tasks",
    "did not open Inbox",
  );
  local.find((shortcut) => shortcut.id === "go-to-inbox").onExec();
  assert(
    location.hash === "#/project/INBOX_PROJECT/tasks",
    "repeated Inbox action changed route",
  );
});

Deno.test("filters Inbox, hidden and archived projects", () => {
  const projects = [
    { id: "INBOX_PROJECT", title: "Inbox" },
    { id: "a", title: "Alpha", isArchived: true },
    { id: "h", title: "Hidden", isHiddenFromMenu: true },
    { id: "b", title: "Beta" },
  ];
  assert(
    rankProjects(projects, "").map((p) => p.id).join() === "b",
    "filter failed",
  );
});

Deno.test("ranks exact then prefix then substring then subsequence", () => {
  const projects = [
    { id: "subseq", title: "Super Productive Plan" },
    { id: "substr", title: "The Sp Project" },
    { id: "prefix", title: "Sp Other" },
    { id: "exact", title: "SP" },
  ];
  assert(
    rankProjects(projects, "sp").map((p) => p.id).join() ===
      "exact,prefix,substr,subseq",
    "unexpected ranking",
  );
  assert(matchScore("Ärger", "arger") === 0, "accent folding failed");
  assert(!Number.isFinite(matchScore("Example", "xyz")), "non-match included");
});

Deno.test("duplicate titles have deterministic ordering and IDs are URL-encoded", () => {
  const projects = [{ id: "z", title: "Same" }, { id: "a", title: "Same" }];
  assert(
    rankProjects(projects, "same").map((p) => p.id).join() === "a,z",
    "unstable duplicate order",
  );
  assert(
    routeForProject("id/a b") === "#/project/id%2Fa%20b/tasks",
    "invalid encoded hash route",
  );
});

Deno.test("lists all six built-in views before projects with their app routes", () => {
  const entries = rankDestinations(
    [{ id: "my-project", title: "Project" }],
    "",
  );
  assert(
    entries.map((entry) => entry.title).join() ===
      "Today,Inbox,Planner,Schedule,Boards,Habits,Project",
    "missing or reordered views",
  );
  assert(
    entries.slice(0, 6).map((entry) => entry.route).join() ===
      "#/tag/TODAY/tasks,#/project/INBOX_PROJECT/tasks,#/planner,#/schedule,#/boards,#/habits",
    "wrong app routes",
  );
  assert(
    rankDestinations([], "boa")[0].title === "Boards",
    "view search failed",
  );
  assert(rankDestinations([], "abc").length === 0, "nonmatching view included");
});

Deno.test("view wins over a project with the same name", () => {
  const entries = rankDestinations([{ id: "custom", title: "Today" }], "today");
  assert(
    entries.map((entry) => entry.kind).join() === "view,project",
    "ambiguous result ordering",
  );
});

function pickerFixture() {
  class Element {
    constructor(tag, doc) {
      this.tag = tag;
      this.doc = doc;
      this.children = [];
      this.attributes = {};
      this.listeners = {};
      this.value = "";
      this.isConnected = false;
    }
    append(...children) {
      for (const child of children) {
        this.children.push(child);
        child.parent = this;
        child.isConnected = true;
      }
    }
    replaceChildren(...children) {
      this.children.forEach((child) => child.isConnected = false);
      this.children = [];
      this.append(...children);
    }
    remove() {
      if (this.parent) {
        this.parent.children = this.parent.children.filter((child) =>
          child !== this
        );
      }
      this.isConnected = false;
    }
    focus() {
      if (this.doc.activeElement !== this) this.doc.activeElement?.blur?.();
      this.doc.activeElement = this;
      this.listeners.focus?.();
    }
    blur() {
      this.listeners.blur?.();
      this.doc.activeElement = this.doc.body;
    }
    getClientRects() {
      return this.isConnected ? [{}] : [];
    }
    getAttribute(key) {
      return this.attributes[key] ?? null;
    }
    contains(element) {
      return element === this ||
        this.children.some((child) => child.contains(element));
    }
    matches(selector) {
      return selector.split(",").some((part) => {
        const [tag, className] = part.trim().split(".");
        return (!tag || this.tag === tag) &&
          (!className || this.className?.split(" ").includes(className));
      });
    }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [
        ...(child.matches(selector) ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    }
    dispatchEvent(event) {
      this.listeners[event.type]?.(event);
      return !event.defaultPrevented;
    }
    setAttribute(key, value) {
      this.attributes[key] = value;
    }
    removeAttribute(key) {
      delete this.attributes[key];
    }
    addEventListener(key, callback) {
      this.listeners[key] = callback;
    }
    querySelector(tag) {
      if (this.matches(tag)) return this;
      for (const child of this.children) {
        const found = child.querySelector(tag);
        if (found) return found;
      }
      return null;
    }
    scrollIntoView() {}
  }
  const doc = {
    createElement(tag) {
      return new Element(tag, this);
    },
    getElementById(id) {
      function find(element) {
        if (element.id === id) return element;
        for (const child of element.children) {
          const match = find(child);
          if (match) return match;
        }
        return null;
      }
      return find(this.head) || find(this.body);
    },
    querySelectorAll(selector) {
      return this.body.querySelectorAll(selector);
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
  };
  doc.head = doc.createElement("head");
  doc.body = doc.createElement("body");
  const original = doc.createElement("button");
  doc.body.append(original);
  original.focus();
  const location = { hash: "#/tag/TODAY/tasks" };
  const projects = [{ id: "first", title: "Alpha" }, {
    id: "second",
    title: "Beta",
  }];
  const local = [];
  const snacks = [];
  const fakeApi = {
    registerShortcut(shortcut) {
      local.push(shortcut);
    },
    getAllProjects: async () => projects,
    showSnack(snack) {
      snacks.push(snack);
    },
  };
  const { openPicker } = new Function(
    "PluginAPI",
    "document",
    "window",
    "KeyboardEvent",
    source + "\nreturn {openPicker};",
  )(
    fakeApi,
    doc,
    { location },
    class {
      constructor(type, options) {
        this.type = type;
        Object.assign(this, options);
      }
    },
  );
  return { doc, original, location, openPicker, local, snacks, fakeApi };
}

Deno.test("IME confirmation and navigation leave picker state and keys to the editor", async () => {
  const { doc, openPicker, location } = pickerFixture();
  await openPicker();
  const picker = doc.getElementById("superprod-vim-motions-picker");
  const input = picker.querySelector("input");
  for (const key of ["Enter", "ArrowDown", "ArrowUp", "Escape", "Tab"]) {
    for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
      const event = keyEvent(key, composition);
      picker.listeners.keydown(event);
      assert(
        !event.defaultPrevented && !event.stopped,
        "picker intercepted IME key " + key,
      );
      assert(
        doc.getElementById("superprod-vim-motions-picker") === picker,
        "IME closed picker",
      );
      assert(
        input.getAttribute("aria-activedescendant") === "spvm-result-0",
        "IME moved selection",
      );
      assert(location.hash === "#/tag/TODAY/tasks", "IME navigated");
    }
  }
});

Deno.test("focused result synchronizes selection and Enter opens that destination", async () => {
  const { doc, openPicker, location } = pickerFixture();
  await openPicker();
  const picker = doc.getElementById("superprod-vim-motions-picker");
  const input = picker.querySelector("input");
  const buttons = picker.querySelectorAll("button");
  buttons[2].focus();
  assert(
    input.getAttribute("aria-activedescendant") === "spvm-result-2",
    "focused result disagrees with selection",
  );
  assert(
    buttons[2].getAttribute("aria-selected") === "true",
    "focused result not selected",
  );
  assert(
    buttons[0].getAttribute("aria-selected") === "false",
    "old result still selected",
  );
  assert(
    buttons.every((button) => button.tabIndex === -1),
    "results must not add Tab stops",
  );
  picker.listeners.keydown(keyEvent("Enter", { target: buttons[2] }));
  await Promise.resolve();
  assert(
    location.hash === "#/planner",
    "Enter opened a result other than the focused button",
  );
});

Deno.test("picker consumes theme surface input shape and focus tokens with subdued readable selection", async () => {
  const { doc, openPicker } = pickerFixture();
  await openPicker();
  const css = doc.getElementById("superprod-vim-motions-style").textContent;
  for (
    const token of [
      "--card-bg",
      "--input-bg",
      "--input-border-color",
      "--input-border-color-focus",
      "--card-border-radius",
      "--input-border-radius",
      "--focus-ring-color",
      "--sidenav-item-active-bg",
      "--text-color",
      "--font-size-md",
    ]
  ) {
    assert(css.includes("var(" + token), "missing theme token " + token);
  }
  const selectedRule = css.match(
    /\.spvm-option\[aria-selected="true"\]\s*\{([^}]+)\}/,
  )?.[1];
  assert(
    selectedRule?.includes("background: var(--sidenav-item-active-bg"),
    "selection uses a bright filled accent",
  );
  assert(
    selectedRule?.includes("color: var(--text-color"),
    "selection must retain readable surface text",
  );
  assert(css.includes(":focus-visible"), "missing visible keyboard focus");
});

function nativeDetails(fixture) {
  const { doc } = fixture;
  const host = doc.createElement("right-panel");
  host.className = "isOpen";
  const side = doc.createElement("div");
  side.className = "side";
  const task = doc.createElement("task-detail-panel");
  const editor = doc.createElement("textarea");
  editor.value = "pending native draft";
  const close = doc.createElement("button");
  close.className = "edge-close-handle";
  const events = [];
  let saved = "original";
  editor.addEventListener("blur", () => {
    saved = editor.value;
    events.push("save");
  });
  close.addEventListener("click", () => {
    throw new Error("native close is keyboard-only");
  });
  close.addEventListener("keydown", (event) => {
    assert(
      event.key === "Enter" && event.code === "Enter" && event.bubbles,
      "wrong native close event",
    );
    assert(saved === editor.value, "native close ran before draft save");
    events.push("close");
    host.className = "";
  });
  task.append(editor);
  side.append(task, close);
  host.append(side);
  doc.body.append(host);
  editor.focus();
  return { host, side, task, editor, close, events, saved: () => saved };
}

Deno.test("Inbox saves native draft and confirms native close before changing hash", async () => {
  const fixture = pickerFixture();
  const details = nativeDetails(fixture);
  let hash = fixture.location.hash;
  Object.defineProperty(fixture.location, "hash", {
    get: () => hash,
    set(value) {
      assert(
        details.saved() === details.editor.value,
        "route changed before save",
      );
      assert(
        details.host.className === "",
        "route changed before native close",
      );
      details.events.push("route");
      hash = value;
    },
  });
  await fixture.local.find((entry) => entry.id === "go-to-inbox").onExec();
  assert(
    details.events.join() === "save,close,route",
    "missing ordered native handoff",
  );
  assert(hash === "#/project/INBOX_PROJECT/tasks", "Inbox route missing");
});

Deno.test("picker project selection uses native close before normal per-project host route", async () => {
  const fixture = pickerFixture();
  const details = nativeDetails(fixture);
  await fixture.openPicker();
  const picker = fixture.doc.getElementById("superprod-vim-motions-picker");
  const input = picker.querySelector("input");
  input.value = "bet";
  input.listeners.input();
  picker.listeners.keydown(keyEvent("Enter"));
  await Promise.resolve();
  assert(
    details.events.join() === "save,close",
    "picker skipped native draft-safe close",
  );
  assert(
    fixture.location.hash === "#/project/second/tasks",
    "must let host restore the project's remembered List/Kanban view",
  );
  assert(
    fixture.doc.getElementById("superprod-vim-motions-picker") === null,
    "picker remained open after navigation",
  );
  assert(
    fixture.doc.activeElement !== details.editor,
    "navigation refocused the closing native editor",
  );
});

Deno.test("navigation waits for asynchronous native close acknowledgement", async () => {
  const fixture = pickerFixture();
  const details = nativeDetails(fixture);
  details.close.addEventListener("keydown", () => {
    details.events.push("close-request");
    setTimeout(() => {
      details.host.className = "";
      details.events.push("closed");
    }, 10);
  });
  await fixture.local.find((entry) => entry.id === "go-to-inbox").onExec();
  // Let the fixture finish even on RED (no dangling test timers).
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert(
    fixture.location.hash === "#/project/INBOX_PROJECT/tasks",
    "navigation did not wait for native close",
  );
  assert(
    fixture.snacks.length === 0,
    "safe asynchronous close was reported as a failure",
  );
});

Deno.test("nested native CDK dialog blocks navigation without touching native draft or close", async () => {
  const fixture = pickerFixture();
  const details = nativeDetails(fixture);
  const pane = fixture.doc.createElement("div");
  pane.className = "cdk-overlay-pane";
  pane.append(fixture.doc.createElement("mat-dialog-container"));
  fixture.doc.body.append(pane);
  await fixture.local.find((entry) => entry.id === "go-to-inbox").onExec();
  assert(
    fixture.location.hash === "#/tag/TODAY/tasks",
    "bypassed nested CDK dialog",
  );
  assert(
    details.events.length === 0 && details.saved() === "original",
    "touched draft behind nested dialog",
  );
  assert(
    fixture.snacks.length === 1 && fixture.snacks[0].type === "WARNING",
    "missing blocked-navigation feedback",
  );
});

Deno.test("Escape cancels picker navigation still waiting for native close", async () => {
  const fixture = pickerFixture();
  const details = nativeDetails(fixture);
  details.close.addEventListener("keydown", () => {
    setTimeout(() => {
      details.host.className = "";
    }, 10);
  });
  await fixture.openPicker();
  const picker = fixture.doc.getElementById("superprod-vim-motions-picker");
  picker.listeners.keydown(keyEvent("ArrowDown"));
  picker.listeners.keydown(keyEvent("Enter"));
  picker.listeners.keydown(keyEvent("Escape"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert(
    fixture.location.hash === "#/tag/TODAY/tasks",
    "late native close navigated after picker cancellation",
  );
  assert(
    fixture.doc.activeElement === details.editor,
    "Escape did not restore native focus",
  );
});

Deno.test("native validation dialog opened by blur prevents closing details or routing", async () => {
  const fixture = pickerFixture();
  const details = nativeDetails(fixture);
  const nativeBlur = details.editor.listeners.blur;
  details.editor.addEventListener("blur", () => {
    nativeBlur();
    const pane = fixture.doc.createElement("div");
    pane.className = "cdk-overlay-pane";
    pane.append(fixture.doc.createElement("mat-dialog-container"));
    fixture.doc.body.append(pane);
  });
  await fixture.local.find((entry) => entry.id === "go-to-inbox").onExec();
  assert(
    fixture.location.hash === "#/tag/TODAY/tasks",
    "navigated through native save validation",
  );
  assert(
    details.events.join() === "save" &&
      details.editor.value === "pending native draft",
    "closed native editor behind validation",
  );
  assert(
    details.host.className === "isOpen",
    "closed details despite validation dialog",
  );
});

Deno.test("picker does not take focus from a native child dialog", async () => {
  const fixture = pickerFixture();
  const pane = fixture.doc.createElement("div");
  pane.className = "cdk-overlay-pane";
  const editor = fixture.doc.createElement("input");
  pane.append(editor);
  fixture.doc.body.append(pane);
  editor.focus();
  await fixture.openPicker();
  assert(
    fixture.doc.getElementById("superprod-vim-motions-picker") === null,
    "picker bypassed native dialog",
  );
  assert(
    fixture.doc.activeElement === editor,
    "picker hijacked native editor focus",
  );
});

Deno.test("rejected native close keeps picker draft and focus available for recovery", async () => {
  const fixture = pickerFixture();
  const details = nativeDetails(fixture);
  details.close.addEventListener("keydown", () => {
    throw new Error("native close failed");
  });
  await fixture.openPicker();
  const picker = fixture.doc.getElementById("superprod-vim-motions-picker");
  const input = picker.querySelector("input");
  input.value = "inbox";
  input.listeners.input();
  picker.listeners.keydown(keyEvent("Enter"));
  await Promise.resolve();
  assert(
    fixture.location.hash === "#/tag/TODAY/tasks",
    "failed native close navigated",
  );
  assert(
    fixture.doc.getElementById("superprod-vim-motions-picker") === picker,
    "failed handoff discarded picker",
  );
  assert(
    input.value === "inbox" && details.editor.value === "pending native draft",
    "failed handoff discarded draft",
  );
  assert(
    fixture.doc.activeElement === input,
    "failed handoff left focus behind picker",
  );
  assert(fixture.snacks[0]?.type === "WARNING", "missing failure feedback");
});

function keyEvent(key, options = {}) {
  return {
    key,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
    ...options,
  };
}

Deno.test("picker keyboard workflow opens project and Escape restores focus", async () => {
  const { doc, original, location, openPicker } = pickerFixture();

  await openPicker();
  let picker = doc.getElementById("superprod-vim-motions-picker");
  assert(picker !== null, "picker did not appear");
  const input = picker.querySelector("input");
  assert(doc.activeElement === input, "search not focused");
  input.value = "bet";
  input.listeners.input();
  assert(
    picker.querySelector("button").textContent === "Beta",
    "search filtering failed",
  );
  const key = (value) => ({
    key: value,
    preventDefault() {},
    stopPropagation() {},
  });
  picker.listeners.keydown(key("Enter"));
  await Promise.resolve();
  assert(location.hash === "#/project/second/tasks", "Enter did not navigate");
  assert(doc.activeElement === original, "navigation did not restore focus");

  await openPicker();
  picker = doc.getElementById("superprod-vim-motions-picker");
  picker.listeners.keydown(key("Escape"));
  assert(
    doc.getElementById("superprod-vim-motions-picker") === null,
    "Escape did not close",
  );
  assert(doc.activeElement === original, "Escape did not restore focus");

  await openPicker();
  picker = doc.getElementById("superprod-vim-motions-picker");
  picker.listeners.keydown(key("Enter"));
  await Promise.resolve();
  assert(
    location.hash === "#/tag/TODAY/tasks",
    "default Today view did not navigate",
  );
});
