"use strict";
// Status lives in memory and is refreshed by each frame every second.
const reports = new Map();
chrome.tabs.onRemoved.addListener(tabId => reports.delete(tabId));
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const tabId = sender.tab?.id;
  if (message?.type === "zhs:report" && tabId !== undefined) {
    if (!reports.has(tabId)) reports.set(tabId, new Map());
    reports.get(tabId).set(sender.frameId, { ...message.snapshot, at: Date.now(), frameId: sender.frameId });
    respond({ parentBlocked: sender.frameId !== 0 && !!reports.get(tabId).get(0)?.blockingDialog });
  } else if (message?.type === "zhs:collect" && !sender.tab && Number.isInteger(message.tabId)) {
    const frames = [...(reports.get(message.tabId)?.values() || [])].filter(item => Date.now() - item.at < 5000);
    frames.sort((a, b) => Number(b.hasVideo) - Number(a.hasVideo) || a.frameId - b.frameId);
    respond({ frames });
  } else if (message?.type === "zhs:next-in-parent" && tabId !== undefined && sender.frameId !== 0) {
    chrome.tabs.sendMessage(tabId, { type: "zhs:next-in-parent" }, { frameId: 0 })
      .then(respond).catch(() => respond({ clicked: false }));
    return true;
  }
});
