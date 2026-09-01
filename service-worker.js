const STORAGE_KEY = "tabHistoryByWindow";
let queue = Promise.resolve();

function enqueue(task) {
  queue = queue.then(task, task).catch(error => console.error("Last Tab:", error));
}

async function loadHistory() {
  const stored = await chrome.storage.session.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || {};
}

async function saveHistory(history) {
  await chrome.storage.session.set({ [STORAGE_KEY]: history });
}

chrome.tabs.onActivated.addListener(activeInfo => {
  enqueue(async () => {
    const history = await loadHistory();
    const windowId = String(activeInfo.windowId);
    const entry = history[windowId] || {};

    if (entry.current !== activeInfo.tabId) {
      entry.previous = entry.current;
      entry.current = activeInfo.tabId;
      history[windowId] = entry;
      await saveHistory(history);
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  enqueue(async () => {
    const history = await loadHistory();
    const windowId = String(removeInfo.windowId);
    const entry = history[windowId];

    if (!entry) {
      return;
    }
    if (entry.previous === tabId) {
      delete entry.previous;
    }
    if (entry.current === tabId) {
      delete entry.current;
    }
    if (entry.current === undefined && entry.previous === undefined) {
      delete history[windowId];
    }
    await saveHistory(history);
  });
});

chrome.windows.onRemoved.addListener(windowId => {
  enqueue(async () => {
    const history = await loadHistory();
    delete history[String(windowId)];
    await saveHistory(history);
  });
});

async function toggleLastTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || activeTab.windowId === undefined) {
    return;
  }

  const history = await loadHistory();
  const previousTabId = history[String(activeTab.windowId)]?.previous;
  if (previousTabId === undefined) {
    return;
  }

  try {
    const previousTab = await chrome.tabs.get(previousTabId);
    if (previousTab.windowId === activeTab.windowId) {
      await chrome.tabs.update(previousTabId, { active: true });
    }
  } catch {
    const entry = history[String(activeTab.windowId)];
    if (entry) {
      delete entry.previous;
      await saveHistory(history);
    }
  }
}

async function closeUnpinnedTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const unpinnedTabIds = tabs.filter(tab => !tab.pinned).map(tab => tab.id);

  if (unpinnedTabIds.length === 0) {
    return;
  }
  if (unpinnedTabIds.length === tabs.length) {
    await chrome.tabs.create({ active: true });
  }
  await chrome.tabs.remove(unpinnedTabIds);
}

chrome.commands.onCommand.addListener(command => {
  enqueue(async () => {
    if (command === "toggle-last-tab") {
      await toggleLastTab();
    } else if (command === "close-unpinned-tabs") {
      await closeUnpinnedTabs();
    }
  });
});
