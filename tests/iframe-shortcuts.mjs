// Real Chromium: actual keyboard + Kanban source, disposable API and settings.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const keyboard = await readFile(
  new URL("../plugin.js", import.meta.url),
  "utf8",
);
const kanban = new URL("../../../superprod-kanban/code/src/", import.meta.url);
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.setContent(
    '<button class="e2e-toggle-schedule-day-panel">Schedule</button><plugin-index><iframe data-plugin-id="project-kanban"></iframe></plugin-index>',
  );
  await page.evaluate(() => {
    window.bindings = {
      "plugin_superprod-vim-motions:find-project": "Shift+P",
      "plugin_superprod-vim-motions:toggle-schedule-day-panel": "Alt+S",
      "plugin_superprod-vim-motions:go-to-inbox": "Shift+I",
      "plugin_superprod-vim-motions:start-focused-task-session": "Alt+F",
      "plugin_project-kanban:toggle-project-view": "Alt+V",
      goToTimeline: "Shift+T",
    };
    window.layoutMode = "absent";
    Object.defineProperty(navigator, "keyboard", {
      configurable: true,
      get: () =>
        window.layoutMode === "absent" ? undefined : {
          getLayoutMap: async () => {
            if (window.layoutMode === "denied") throw new Error("Not allowed");
            return new Map([["KeyQ", "a"], ["BracketLeft", "ü"]]);
          },
        },
    });
    window.unloads = [];
    window.shortcuts = {};
    window.reads = 0;
    window.sidebarClicks = 0;
    document.querySelector("button").onclick = () => window.sidebarClicks++;
    window.PluginAPI = {
      registerShortcut: (cfg) => window.shortcuts[cfg.id] = cfg,
      getAllProjects: async () => [{ id: "p", title: "Test project" }],
      getAppState: async () => {
        window.reads++;
        return { globalConfig: { keyboard: { ...window.bindings } } };
      },
      onReady: (fn) => window.initialized = fn(),
      onUnload: (fn) => window.unloads.push(fn),
      showSnack: () => {},
    };
    window.plugin = { onUnload: (fn) => window.unloads.push(fn) };
  });
  const frame = page.frames()[1];
  await frame.setContent('<title>Project Kanban</title><main id="app"></main>');
  await frame.addStyleTag({
    content: await readFile(new URL("style.css", kanban), "utf8"),
  });
  await frame.addScriptTag({
    content: `
    window.fixture={ tasks:[{id:'a',title:'Test task',projectId:'p',tagIds:['extra'],dueDay:'2030-12-24',timeEstimate:1800000,isDone:false}],values:new Map(),actions:[],closed:0 };
    window.PluginAPI={Hooks:{},registerHook(){},getActiveWorkContext:async()=>({id:'p',type:'PROJECT'}),getTasks:async()=>fixture.tasks,getAllProjects:async()=>[{id:'p',title:'Test project'}],getAllTags:async()=>[{id:'backlog',title:'Backlog'},{id:'doing',title:'Doing'}],loadSyncedData:async k=>fixture.values.get(k),persistDataSynced:async(v,k)=>fixture.values.set(k,v),selectTask:async()=>{},startTracking:async id=>fixture.actions.push(id),dispatchAction:async a=>fixture.actions.push(a.type),closeWorkContextView:async()=>fixture.closed++};
  `,
  });
  await frame.addScriptTag({
    content: (await readFile(new URL("board-core.js", kanban), "utf8")).replace(
      "export { BoardCore };",
      "",
    ),
  });
  await frame.addScriptTag({
    content: await readFile(new URL("board-ui.js", kanban), "utf8"),
  });
  await frame.locator(".card").waitFor();
  await page.addScriptTag({ content: `(() => {${keyboard}\n})()` });
  await page.evaluate(() => window.initialized);
  const card = frame.locator(".card").first();
  await card.focus();
  await page.keyboard.press("Shift+P");
  await page.waitForTimeout(80);
  assert.equal(
    await page.locator("#spvm-input").count(),
    1,
    "configured Shift+P did not leave iframe and open switcher",
  );
  assert.equal(
    await page.locator("#spvm-input").evaluate((n) =>
      document.activeElement === n
    ),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => document.activeElement.tagName),
    "IFRAME",
  );
  await card.focus();
  await page.keyboard.press("Alt+S");
  assert.equal(await page.evaluate(() => window.sidebarClicks), 1);
  await card.focus();
  await page.keyboard.press("Alt+F");
  await frame.waitForFunction(() => fixture.actions.length === 2);
  assert.deepEqual(await frame.evaluate(() => fixture.actions), [
    "a",
    "[FocusMode] Show Overlay",
  ]);
  await card.focus();
  await page.keyboard.press("Alt+V");
  await frame.waitForFunction(() => fixture.closed === 1);
  assert.equal(
    await frame.evaluate(() => fixture.values.get("view-p")),
    "list",
  );
  const originalTasks = await frame.evaluate(() => fixture.tasks);
  await card.focus();
  await page.keyboard.press("Shift+T");
  await page.waitForTimeout(80);
  assert.equal(
    await page.evaluate(() => location.hash),
    "#/tag/TODAY/tasks",
    "configured Go to Today (Shift+T) did not leave Kanban for Today",
  );
  assert.deepEqual(
    await frame.evaluate(() => fixture.tasks),
    originalTasks,
    "Today navigation changed task dates/tags/estimate",
  );
  await page.evaluate(() => {
    window.bindings.goToTimeline = "Ctrl+Y";
    location.hash = "#/project/p/tasks";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(80);
  await frame.locator(".task-add-input").first().focus();
  await page.keyboard.press("Control+Y");
  await page.keyboard.press("Shift+T");
  await page.waitForTimeout(80);
  assert.equal(
    await page.evaluate(() => location.hash),
    "#/project/p/tasks",
    "Today shortcut stole input while typing",
  );
  await card.focus();
  await page.keyboard.press("Shift+T");
  await page.waitForTimeout(80);
  assert.equal(
    await page.evaluate(() => location.hash),
    "#/project/p/tasks",
    "old Today binding remained after settings refresh",
  );
  await page.keyboard.press("Control+Y");
  await page.waitForFunction(() => location.hash === "#/tag/TODAY/tasks");
  assert.deepEqual(await frame.evaluate(() => fixture.tasks), originalTasks);
  await frame.locator(".task-add-input").first().focus();
  await page.keyboard.press("Shift+P");
  assert.equal(
    await page.locator("#spvm-input").count(),
    0,
    "stole Shift+P while typing",
  );
  await page.evaluate(() => {
    window.bindings["plugin_superprod-vim-motions:find-project"] = "Ctrl+O";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(80);
  await card.focus();
  await page.keyboard.press("Shift+P");
  assert.equal(
    await page.locator("#spvm-input").count(),
    0,
    "old binding remained after settings refresh",
  );
  await page.keyboard.press("Control+O");
  await page.locator("#spvm-input").waitFor();
  await page.keyboard.press("Escape");
  await card.focus();
  await page.keyboard.press("Shift+I");
  await page.waitForFunction(() =>
    location.hash === "#/project/INBOX_PROJECT/tasks"
  );
  await page.evaluate(() => {
    window.bindings["plugin_superprod-vim-motions:go-to-inbox"] = "Ctrl+I";
    location.hash = "#/project/p/tasks";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(80);
  await frame.locator(".task-add-input").first().focus();
  await page.keyboard.press("Control+I");
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => location.hash), "#/project/p/tasks");
  await card.focus();
  await page.keyboard.press("Shift+I");
  await page.waitForTimeout(80);
  assert.equal(
    await page.evaluate(() => location.hash),
    "#/project/p/tasks",
    "old Inbox binding remained after settings change",
  );
  await page.keyboard.press("Control+I");
  await page.waitForFunction(() =>
    location.hash === "#/project/INBOX_PROJECT/tasks"
  );
  await page.evaluate(() => {
    window.bindings["plugin_superprod-vim-motions:go-to-inbox"] = "Shift+I";
    location.hash = "#/project/p/tasks";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(80);
  await card.focus();
  await page.keyboard.press("Shift+I");
  await page.waitForFunction(() =>
    location.hash === "#/project/INBOX_PROJECT/tasks"
  );
  assert.deepEqual(
    await frame.evaluate(() => fixture.tasks),
    originalTasks,
    "Inbox navigation changed task dates/tags/estimate",
  );
  for (
    const [binding, pressed, layoutMode] of [
      ["Ctrl+Space", "Control+Space", "absent"],
      ["Shift+1", "Shift+Digit1", "absent"],
      ["Shift+Slash", "Shift+Slash", "denied"],
      ["Shift++", "Shift+Equal", "absent"],
      ["Ctrl+A", "Control+KeyQ", "mapped"],
      ["Shift+Ü", "Shift+BracketLeft", "mapped"],
    ]
  ) {
    const before = await page.evaluate(() => window.sidebarClicks);
    await page.evaluate(({ binding, layoutMode }) => {
      window
        .bindings["plugin_superprod-vim-motions:toggle-schedule-day-panel"] =
          binding;
      window.layoutMode = layoutMode;
      window.dispatchEvent(new Event("hashchange"));
    }, { binding, layoutMode });
    await page.waitForTimeout(80);
    await card.focus();
    await page.keyboard.down("Meta");
    await page.keyboard.press(pressed);
    await page.keyboard.up("Meta");
    assert.equal(
      await page.evaluate(() => window.sidebarClicks),
      before,
      `${binding} accepted an extra modifier`,
    );
    await page.keyboard.press(pressed);
    assert.equal(
      await page.evaluate(() => window.sidebarClicks),
      before + 1,
      `${binding} did not normalize ${pressed} with ${layoutMode} layout API`,
    );
  }
  await page.evaluate(() => {
    window.bindings["plugin_superprod-vim-motions:toggle-schedule-day-panel"] =
      "Alt+S";
    window.layoutMode = "absent";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(80);
  const beforeReload = await page.evaluate(() => window.sidebarClicks);
  await page.addScriptTag({ content: `(() => {${keyboard}\n})()` });
  await page.evaluate(() => window.initialized);
  // An old instance's unload must not remove its replacement's listeners.
  await card.focus();
  await page.keyboard.press("Alt+S");
  assert.equal(
    await page.evaluate(() => window.sidebarClicks),
    beforeReload + 1,
    "reload left duplicate shortcut listeners",
  );
  await page.evaluate(() => window.unloads[0]());
  await card.focus();
  await page.keyboard.press("Alt+S");
  assert.equal(
    await page.evaluate(() => window.sidebarClicks),
    beforeReload + 2,
    "reload duplicated shortcut listeners or stale unload removed the replacement",
  );
  await page.evaluate(() => window.unloads.forEach((fn) => fn()));
  await card.focus();
  await page.keyboard.press("Control+O");
  assert.equal(
    await page.locator("#spvm-input").count(),
    0,
    "unload left iframe shortcut listeners",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS configured iframe picker/sidebar/Inbox/Today/focus/List shortcuts, code/layout normalization, input guard, rebinding and unload; navigation preserves task dates/tags/estimate",
  );
} finally {
  await browser.close();
}
