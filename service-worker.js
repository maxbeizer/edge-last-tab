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

function tabIds(entry = {}) {
  return [entry.current, entry.previous, ...(entry.older || [])]
    .filter((tabId, index, ids) => tabId !== undefined && ids.indexOf(tabId) === index);
}

function setTabIds(history, windowId, ids) {
  const key = String(windowId);
  if (ids.length === 0) {
    delete history[key];
    return;
  }

  const [current, previous, ...older] = ids;
  history[key] = { current };
  if (previous !== undefined) history[key].previous = previous;
  if (older.length) history[key].older = older;
}

function recordActivation(history, windowId, tabId) {
  const ids = tabIds(history[String(windowId)]);
  if (ids[0] === tabId) {
    return false;
  }

  setTabIds(history, windowId, [tabId, ...ids.filter(id => id !== tabId)]);
  return true;
}

function removeTabReference(history, windowId, tabId) {
  const entry = history[String(windowId)];
  if (!entry || !tabIds(entry).includes(tabId)) {
    return false;
  }

  setTabIds(history, windowId, tabIds(entry).filter(id => id !== tabId));
  return true;
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

    for (const [windowId, entry] of Object.entries(history)) {
      const ids = tabIds(entry);
      if (ids.includes(removedTabId)) {
        setTabIds(history, windowId, ids.map(id => id === removedTabId ? addedTabId : id));
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
  const ids = tabIds(history[String(windowId)]);

  while (ids.length > 1) {
    const previousTabId = ids[1];
    try {
      const previousTab = await chrome.tabs.get(previousTabId);
      if (previousTab.windowId === windowId) {
        ids.push(ids.shift());
        setTabIds(history, windowId, ids);
        await chrome.tabs.update(previousTabId, { active: true });
        await saveHistory(history);
        return;
      }
    } catch {
      // Remove stale entries and continue farther back in history.
    }
    ids.splice(1, 1);
  }

  setTabIds(history, windowId, ids);
  await saveHistory(history);
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "toggle-last-tab") {
    return;
  }

  const windowId = tab?.windowId;
  if (windowId === undefined) {
    return;
  }

  enqueue(() => toggleLastTab(windowId));
});
