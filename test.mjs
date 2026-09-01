import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const workerSource = fs.readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");

function event() {
  return {
    listeners: [],
    addListener(listener) {
      this.listeners.push(listener);
    },
    emit(...args) {
      for (const listener of this.listeners) {
        listener(...args);
      }
    },
  };
}

function createHarness(initialTabs) {
  const onActivated = event();
  const onRemoved = event();
  const onWindowRemoved = event();
  const onCommand = event();
  let stored = {};
  let nextTabId = 100;
  let tabs = structuredClone(initialTabs);

  const chrome = {
    storage: {
      session: {
        async get(key) {
          return { [key]: stored[key] };
        },
        async set(value) {
          stored = { ...stored, ...structuredClone(value) };
        },
      },
    },
    tabs: {
      onActivated,
      onRemoved,
      async query(query) {
        return tabs.filter(tab =>
          (!query.currentWindow || tab.windowId === 10) &&
          (!query.active || tab.active)
        );
      },
      async get(tabId) {
        const tab = tabs.find(candidate => candidate.id === tabId);
        if (!tab) {
          throw new Error("Unknown tab");
        }
        return tab;
      },
      async update(tabId, changes) {
        if (changes.active) {
          tabs = tabs.map(tab => ({
            ...tab,
            active: tab.windowId === 10 ? tab.id === tabId : tab.active,
          }));
          onActivated.emit({ tabId, windowId: 10 });
        }
      },
      async create() {
        tabs = tabs.map(tab => ({ ...tab, active: false }));
        const tab = { id: nextTabId++, windowId: 10, active: true, pinned: false };
        tabs.push(tab);
        return tab;
      },
      async remove(tabIds) {
        tabs = tabs.filter(tab => !tabIds.includes(tab.id));
      },
    },
    windows: { onRemoved: onWindowRemoved },
    commands: { onCommand },
  };

  vm.runInNewContext(workerSource, { chrome, console });

  return {
    activate(tabId) {
      tabs = tabs.map(tab => ({
        ...tab,
        active: tab.windowId === 10 ? tab.id === tabId : tab.active,
      }));
      onActivated.emit({ tabId, windowId: 10 });
    },
    command(name) {
      onCommand.emit(name);
    },
    tabs() {
      return structuredClone(tabs);
    },
    async settle() {
      await new Promise(resolve => setTimeout(resolve, 10));
    },
  };
}

test("repeated commands toggle between the two most recent tabs", async () => {
  const harness = createHarness([
    { id: 1, windowId: 10, active: true, pinned: false },
    { id: 2, windowId: 10, active: false, pinned: false },
  ]);

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

test("close command retains pinned tabs", async () => {
  const harness = createHarness([
    { id: 1, windowId: 10, active: true, pinned: false },
    { id: 2, windowId: 10, active: false, pinned: true },
    { id: 3, windowId: 10, active: false, pinned: false },
  ]);

  harness.command("close-unpinned-tabs");
  await harness.settle();
  assert.deepEqual(harness.tabs().map(tab => tab.id), [2]);
});

test("close command leaves a new tab when no tabs are pinned", async () => {
  const harness = createHarness([
    { id: 1, windowId: 10, active: true, pinned: false },
    { id: 2, windowId: 10, active: false, pinned: false },
  ]);

  harness.command("close-unpinned-tabs");
  await harness.settle();
  assert.deepEqual(harness.tabs().map(tab => tab.id), [100]);
});
