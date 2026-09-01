import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const workerSource = fs.readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");

function createHarness(initialTabs, options = {}) {
  let tabs = structuredClone(initialTabs);
  let stored = {};
  let nextTabId = Math.max(100, ...tabs.map(tab => tab.id + 1));
  let focusedWindowId = options.focusedWindowId ?? tabs.find(tab => tab.active)?.windowId;
  const windowIds = new Set(tabs.map(tab => tab.windowId));
  const detachedTabs = new Map();
  const emittedEvents = [];

  function event(name) {
    return {
      listeners: [],
      addListener(listener) {
        this.listeners.push(listener);
      },
      emit(...args) {
        emittedEvents.push({ name, args: structuredClone(args) });
        for (const listener of this.listeners) {
          listener(...args);
        }
      },
    };
  }

  const onActivated = event("tabs.onActivated");
  const onRemoved = event("tabs.onRemoved");
  const onDetached = event("tabs.onDetached");
  const onAttached = event("tabs.onAttached");
  const onReplaced = event("tabs.onReplaced");
  const onWindowRemoved = event("windows.onRemoved");
  const onWindowFocusChanged = event("windows.onFocusChanged");
  const onCommand = event("commands.onCommand");

  function tabById(tabId) {
    const tab = tabs.find(candidate => candidate.id === tabId);
    if (!tab) throw new Error(`Unknown tab: ${tabId}`);
    return tab;
  }

  function activate(tabId, focus = false) {
    const target = tabById(tabId);
    const changed = !target.active;
    tabs = tabs.map(tab => ({
      ...tab,
      active: tab.windowId === target.windowId ? tab.id === tabId : tab.active,
    }));
    if (focus) focusWindow(target.windowId);
    if (changed) onActivated.emit({ tabId, windowId: target.windowId });
  }

  function focusWindow(windowId) {
    if (!windowIds.has(windowId)) throw new Error(`Unknown window: ${windowId}`);
    if (focusedWindowId !== windowId) {
      focusedWindowId = windowId;
      onWindowFocusChanged.emit(windowId);
    }
  }

  function activateFallback(windowId) {
    const fallback = tabs.find(tab => tab.windowId === windowId);
    if (fallback && !fallback.active) activate(fallback.id);
  }

  function removeTabs(tabIds, isWindowClosing = false) {
    const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
    const removed = ids.map(tabById);
    tabs = tabs.filter(tab => !ids.includes(tab.id));
    for (const tab of removed) {
      onRemoved.emit(tab.id, { windowId: tab.windowId, isWindowClosing });
    }
    if (!isWindowClosing) {
      for (const windowId of new Set(removed.filter(tab => tab.active).map(tab => tab.windowId))) {
        activateFallback(windowId);
      }
    }
  }

  const chrome = {
    storage: {
      session: {
        async get(key) {
          return { [key]: structuredClone(stored[key]) };
        },
        async set(value) {
          stored = { ...stored, ...structuredClone(value) };
        },
      },
    },
    tabs: {
      onActivated,
      onRemoved,
      onDetached,
      onAttached,
      onReplaced,
      async query(queryInfo) {
        return structuredClone(tabs.filter(tab =>
          (!queryInfo.currentWindow || tab.windowId === focusedWindowId) &&
          (!queryInfo.active || tab.active)
        ));
      },
      async get(tabId) {
        return structuredClone(tabById(tabId));
      },
      async update(tabId, changes) {
        if (changes.active) {
          const { active: _active, ...otherChanges } = changes;
          tabs = tabs.map(tab => tab.id === tabId ? { ...tab, ...otherChanges } : tab);
          activate(tabId);
        } else {
          tabs = tabs.map(tab => tab.id === tabId ? { ...tab, ...changes } : tab);
        }
        return structuredClone(tabById(tabId));
      },
      async create(createProperties = {}) {
        const windowId = createProperties.windowId ?? focusedWindowId;
        if (!windowIds.has(windowId)) throw new Error(`Unknown window: ${windowId}`);
        const active = createProperties.active ?? true;
        if (active) {
          tabs = tabs.map(tab => tab.windowId === windowId ? { ...tab, active: false } : tab);
        }
        const tab = {
          id: nextTabId++,
          windowId,
          active,
          pinned: createProperties.pinned ?? false,
        };
        tabs.push(tab);
        if (active) onActivated.emit({ tabId: tab.id, windowId });
        return structuredClone(tab);
      },
      async remove(tabIds) {
        removeTabs(tabIds);
      },
    },
    windows: {
      onRemoved: onWindowRemoved,
      onFocusChanged: onWindowFocusChanged,
    },
    commands: { onCommand },
  };

  const errors = [];
  const workerConsole = { ...console, error: (...args) => errors.push(args) };
  const context = vm.createContext({ chrome, console: workerConsole });
  vm.runInContext(`${workerSource}\n;globalThis.settleWorker = async () => {\n  while (true) {\n    const pending = queue;\n    await pending;\n    if (pending === queue) return;\n  }\n};`, context);

  return {
    activate(tabId) {
      activate(tabId, true);
    },
    focusWindow,
    command(name) {
      onCommand.emit(name);
    },
    removeTabs,
    detach(tabId) {
      const tab = tabById(tabId);
      const oldPosition = tabs.filter(candidate => candidate.windowId === tab.windowId)
        .findIndex(candidate => candidate.id === tabId);
      detachedTabs.set(tabId, structuredClone(tab));
      tabs = tabs.filter(candidate => candidate.id !== tabId);
      onDetached.emit(tabId, { oldWindowId: tab.windowId, oldPosition });
      if (tab.active) activateFallback(tab.windowId);
    },
    attach(tabId, newWindowId) {
      const tab = detachedTabs.get(tabId);
      if (!tab) throw new Error(`Tab is not detached: ${tabId}`);
      windowIds.add(newWindowId);
      const newPosition = tabs.filter(candidate => candidate.windowId === newWindowId).length;
      if (tab.active) {
        tabs = tabs.map(candidate => candidate.windowId === newWindowId
          ? { ...candidate, active: false }
          : candidate);
      }
      tabs.push({ ...tab, windowId: newWindowId });
      detachedTabs.delete(tabId);
      onAttached.emit(tabId, { newWindowId, newPosition });
      if (tab.active) onActivated.emit({ tabId, windowId: newWindowId });
    },
    replace(removedTabId, addedTab = {}) {
      const removed = tabById(removedTabId);
      const replacement = { ...removed, ...addedTab, id: addedTab.id ?? nextTabId++ };
      tabs = tabs.map(tab => tab.id === removedTabId ? replacement : tab);
      onReplaced.emit(replacement.id, removedTabId);
      return replacement.id;
    },
    removeWindow(windowId) {
      const ids = tabs.filter(tab => tab.windowId === windowId).map(tab => tab.id);
      if (ids.length) removeTabs(ids, true);
      windowIds.delete(windowId);
      onWindowRemoved.emit(windowId);
      if (focusedWindowId === windowId) {
        focusedWindowId = windowIds.values().next().value;
        onWindowFocusChanged.emit(focusedWindowId ?? -1);
      }
    },
    tabs() {
      return structuredClone(tabs);
    },
    events() {
      return structuredClone(emittedEvents);
    },
    storage() {
      return structuredClone(stored);
    },
    async settle() {
      await context.settleWorker();
      if (errors.length) throw errors[0][1] ?? new Error(String(errors[0][0]));
    },
  };
}

test("repeated commands toggle between the two most recent tabs", async () => {
  const harness = createHarness([
    { id: 1, windowId: 10, active: true, pinned: false },
    { id: 2, windowId: 10, active: false, pinned: false },
  ]);

  harness.activate(2);
  await harness.settle();
  harness.activate(1);
  await harness.settle();
  harness.activate(2);
  await harness.settle();

  harness.command("toggle-last-tab");
  await harness.settle();
  assert.equal(harness.tabs().find(tab => tab.active).id, 1);

  harness.command("toggle-last-tab");
  await harness.settle();
  assert.equal(harness.tabs().find(tab => tab.active).id, 2);
});

test("tab history and commands use the focused window", async () => {
  const harness = createHarness([
    { id: 1, windowId: 10, active: true, pinned: false },
    { id: 2, windowId: 10, active: false, pinned: false },
    { id: 3, windowId: 20, active: true, pinned: false },
    { id: 4, windowId: 20, active: false, pinned: false },
  ]);

  harness.activate(2);
  await harness.settle();
  harness.activate(1);
  await harness.settle();
  harness.activate(2);
  await harness.settle();
  harness.activate(4);
  await harness.settle();
  harness.activate(3);
  await harness.settle();
  harness.activate(4);
  await harness.settle();

  harness.focusWindow(10);
  harness.command("toggle-last-tab");
  await harness.settle();
  assert.deepEqual(harness.tabs().filter(tab => tab.active).map(tab => tab.id), [1, 4]);

  harness.focusWindow(20);
  harness.command("toggle-last-tab");
  await harness.settle();
  assert.deepEqual(harness.tabs().filter(tab => tab.active).map(tab => tab.id), [1, 3]);
});

test("close command retains pinned tabs in the focused window only", async () => {
  const harness = createHarness([
    { id: 1, windowId: 10, active: true, pinned: false },
    { id: 2, windowId: 10, active: false, pinned: false },
    { id: 3, windowId: 20, active: true, pinned: false },
    { id: 4, windowId: 20, active: false, pinned: true },
  ], { focusedWindowId: 20 });

  harness.command("close-unpinned-tabs");
  await harness.settle();
  assert.deepEqual(harness.tabs().map(tab => tab.id), [1, 2, 4]);
});

test("close command creates the replacement tab in the focused window", async () => {
  const harness = createHarness([
    { id: 1, windowId: 10, active: true, pinned: false },
    { id: 2, windowId: 20, active: true, pinned: false },
    { id: 3, windowId: 20, active: false, pinned: false },
  ], { focusedWindowId: 20 });

  harness.command("close-unpinned-tabs");
  await harness.settle();
  assert.deepEqual(harness.tabs(), [
    { id: 1, windowId: 10, active: true, pinned: false },
    { id: 100, windowId: 20, active: true, pinned: false },
  ]);
});

test("tab removal emits removal and fallback activation events", async () => {
  const harness = createHarness([
    { id: 1, windowId: 10, active: true, pinned: false },
    { id: 2, windowId: 10, active: false, pinned: false },
  ]);

  harness.activate(2);
  await harness.settle();
  const eventCount = harness.events().length;
  harness.removeTabs(2);
  await harness.settle();

  assert.equal(harness.tabs().find(tab => tab.active).id, 1);
  assert.deepEqual(harness.events().slice(eventCount).map(({ name }) => name), [
    "tabs.onRemoved",
    "tabs.onActivated",
  ]);
  assert.equal(harness.storage().tabHistoryByWindow[10].current, 1);
});

test("lifecycle simulations update tabs and emit browser events", async () => {
  const harness = createHarness([
    { id: 1, windowId: 10, active: true, pinned: false },
    { id: 2, windowId: 10, active: false, pinned: false },
    { id: 3, windowId: 20, active: true, pinned: false },
  ]);

  harness.detach(2);
  harness.attach(2, 20);
  const replacementId = harness.replace(2, { id: 4 });
  harness.removeWindow(20);
  await harness.settle();

  assert.equal(replacementId, 4);
  assert.deepEqual(harness.tabs().map(tab => tab.id), [1]);
  assert.deepEqual(harness.events().map(({ name }) => name), [
    "tabs.onDetached",
    "tabs.onAttached",
    "tabs.onReplaced",
    "tabs.onRemoved",
    "tabs.onRemoved",
    "windows.onRemoved",
  ]);
});
