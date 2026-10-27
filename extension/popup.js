(() => {
  "use strict";
  const core = globalThis.ZhsHelperCore;
  const storageKey = "zhsHelperSettings";
  const keys = ["enabled", "autoPlay", "autoNext", "fastestSpeed", "randomAnswer", "muted"];
  const selectorKeys = Object.keys(core.defaults.selectors);
  const byId = id => document.getElementById(id);
  let activeTab;
  function fill(settings) {
    for (const key of keys) byId(key).checked = settings[key];
    byId("actionDelay").value = settings.actionDelay;
    for (const key of selectorKeys) byId(key).value = settings.selectors[key];
  }
  async function refreshStatus() {
    if (!activeTab?.id) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: "zhs:collect", tabId: activeTab.id });
      const frames = result?.frames?.find(frame => frame.blockingDialog) || result?.frames?.[0];
      if (!frames) throw new Error("No active frames");
      byId("status").textContent = `[${frames.frame}] ${frames.status}`;
      if (frames.settings.enabled && frames.settings.fastestSpeed && frames.speedStatus) byId("status").textContent += `；${frames.speedStatus}`;
      byId("badge").textContent = frames.settings.enabled ? "运行中" : "已暂停";
      const list = byId("logs");
      list.replaceChildren(...frames.logs.map(item => {
        const li = document.createElement("li");
        li.textContent = `${item.time} ${item.message}`;
        return li;
      }));
      if (frames.error) byId("error").textContent = frames.error;
    } catch {
      byId("status").textContent = "尚未连接：请打开智慧树课程视频，并刷新页面。";
    }
  }
  byId("settings").addEventListener("submit", async event => {
    event.preventDefault();
    byId("error").textContent = "";
    const raw = { selectors: {} };
    for (const key of keys) raw[key] = byId(key).checked;
    raw.actionDelay = Number(byId("actionDelay").value);
    for (const key of selectorKeys) {
      const value = byId(key).value.trim();
      try { if (value) document.querySelector(value); }
      catch { byId("error").textContent = `「${byId(key).parentElement.firstChild.textContent.trim()}」CSS 选择器无效，请修正后保存。`; return; }
      raw.selectors[key] = value;
    }
    const settings = core.normalizeSettings(raw);
    try {
      await chrome.storage.local.set({ [storageKey]: settings });
      fill(settings);
      byId("saved").textContent = "已保存";
      setTimeout(() => { byId("saved").textContent = ""; }, 2500);
      await refreshStatus();
    } catch (error) { byId("error").textContent = `保存失败：${error.message}`; }
  });
  async function init() {
    try {
      const [stored, tabs] = await Promise.all([chrome.storage.local.get(storageKey), chrome.tabs.query({ active: true, currentWindow: true })]);
      fill(core.normalizeSettings(stored[storageKey]));
      activeTab = tabs[0];
      await refreshStatus();
    } catch (error) { byId("error").textContent = error.message; }
  }
  void init();
  setInterval(() => { void refreshStatus(); }, 2000);
})();
