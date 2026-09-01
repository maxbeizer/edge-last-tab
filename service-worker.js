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

function recordActivation(history, windowId, tabId) {
  const key = String(windowId);
  const entry = history[key] || {};

  if (entry.current === tabId) {
    return false;
  }
  if (entry.current === undefined) {
    delete entry.previous;
  } else {
    entry.previous = entry.current;
  }
  entry.current = tabId;
  history[key] = entry;
  return true;
}

function removeTabReference(history, windowId, tabId) {
  const key = String(windowId);
  const entry = history[key];

  if (!entry) {
    return false;
  }

  let changed = false;
  if (entry.previous === tabId) {
    delete entry.previous;
    changed = true;
  }
  if (entry.current === tabId) {
    delete entry.current;
    changed = true;
  }
  if (entry.current === undefined && entry.previous === undefined) {
    delete history[key];
  }
  return changed;
}

chrome.tabs.onActivated.addListener(activeInfo => {
  enqueue(async () => {
    const history = await loadHistory();
    if (recordActivation(history, activeInfo.windowId, activeInfo.tabId)) {
      await saveHistory(history);
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  enqueue(async () => {
    const history = await loadHistory();
    if (removeTabReference(history, removeInfo.windowId, tabId)) {
      await saveHistory(history);
    }
  });
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  enqueue(async () => {
    const history = await loadHistory();
    if (removeTabReference(history, detachInfo.oldWindowId, tabId)) {
      await saveHistory(history);
    }
  });
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  enqueue(async () => {
    const history = await loadHistory();
    let changed = false;

    for (const windowId of Object.keys(history)) {
      if (windowId !== String(attachInfo.newWindowId)) {
        changed = removeTabReference(history, windowId, tabId) || changed;
      }
    }

    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId === attachInfo.newWindowId && tab.active) {
        changed = recordActivation(history, attachInfo.newWindowId, tabId) || changed;
      }
    } catch {
      // A tab can disappear again before its attachment is processed.
    }

    if (changed) {
      await saveHistory(history);
    }
  });
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  enqueue(async () => {
    const history = await loadHistory();
    let changed = false;

    for (const entry of Object.values(history)) {
      if (entry.current === removedTabId) {
        entry.current = addedTabId;
        changed = true;
      }
      if (entry.previous === removedTabId) {
        entry.previous = addedTabId;
        changed = true;
      }
    }

    if (changed) {
      await saveHistory(history);
    }
  });
});

chrome.windows.onRemoved.addListener(windowId => {
  enqueue(async () => {
    const history = await loadHistory();
    delete history[String(windowId)];
    await saveHistory(history);
  });
});

async function toggleLastTab(windowId) {
  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  if (!activeTab) {
    return;
  }

  const history = await loadHistory();
  const previousTabId = history[String(windowId)]?.previous;
  if (previousTabId === undefined) {
    return;
  }

  try {
    const previousTab = await chrome.tabs.get(previousTabId);
    if (previousTab.windowId === windowId) {
      await chrome.tabs.update(previousTabId, { active: true });
      return;
    }
  } catch {
    // The stale entry is removed below.
  }

  const entry = history[String(windowId)];
  if (entry?.previous === previousTabId) {
    delete entry.previous;
    await saveHistory(history);
  }
}

async function closeUnpinnedTabs(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const unpinnedTabIds = tabs.filter(tab => !tab.pinned).map(tab => tab.id);

  if (unpinnedTabIds.length === 0) {
    return;
  }
  if (unpinnedTabIds.length === tabs.length) {
    await chrome.tabs.create({ active: true, windowId });
  }
  await chrome.tabs.remove(unpinnedTabIds);
}

chrome.commands.onCommand.addListener((command, tab) => {
  const windowId = tab?.windowId;
  if (windowId === undefined) {
    return;
  }

  enqueue(async () => {
    if (command === "toggle-last-tab") {
      await toggleLastTab(windowId);
    } else if (command === "close-unpinned-tabs") {
      await closeUnpinnedTabs(windowId);
    }
  });
});
