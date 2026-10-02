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

Deno.test("registers just one user-assignable project search action", () => {
  assert(shortcuts.length === 1, "expected one shortcut");
  assert(shortcuts[0].id === "find-project", "shortcut id must stay stable");
  assert(
    typeof shortcuts[0].onExec === "function",
    "missing shortcut callback",
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

Deno.test("picker keyboard workflow opens project and Escape restores focus", async () => {
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
      this.doc.activeElement = this;
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
      if (this.tag === tag) return this;
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
  const fakeApi = {
    registerShortcut() {},
    getAllProjects: async () => projects,
    showSnack() {
      throw new Error("unexpected snack");
    },
  };
  const { openPicker } = new Function(
    "PluginAPI",
    "document",
    "window",
    source + "\nreturn {openPicker};",
  )(fakeApi, doc, { location });

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
