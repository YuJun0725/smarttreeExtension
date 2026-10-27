(() => {
  "use strict";
  if (globalThis.__zhsHelperRunning) return;
  globalThis.__zhsHelperRunning = true;
  const core = globalThis.ZhsHelperCore;
  const storageKey = "zhsHelperSettings";
  let settings = core.normalizeSettings();
  let ready = false;
  let running = false;
  let currentVideo = null;
  let videoSource = "";
  let endedAt = 0;
  let nextAttempts = 0;
  let nextAttemptAt = 0;
  let pendingNext = null;
  let catalogueExpandAt = 0;
  let catalogueExpandAttempts = 0;
  let lastPlayAttempt = 0;
  let autoplayBlocked = false;
  let quizStates = new WeakMap();
  let seenDialogs = new Set();
  let pendingConfirmation = null;
  let panel;
  const logs = [];
  let status = "正在加载设置";
  let errorText = "";
  let parentBlocked = false;
  let contextLost = false;
  let timer;
  const now = () => Date.now();
  function invalidateContext() {
    if (contextLost) return;
    contextLost = true;
    ready = false;
    settings = { ...settings, enabled: false };
    clearInterval(timer);
    resetQuizFlow();
    status = "扩展已更新，等待刷新页面";
    errorText = "扩展连接已失效，请刷新当前课程页面后继续。";
    render();
  }
  function ensureContext() {
    if (contextLost) return false;
    try {
      if (chrome.runtime?.id) return true;
    } catch { /* An invalidated extension can also throw when inspecting runtime. */ }
    invalidateContext();
    return false;
  }
  function contextError(error) {
    if (/extension context invalidated/i.test(error?.message || "") || !ensureContext()) {
      invalidateContext();
      return true;
    }
    return false;
  }
  function log(message) {
    if (logs[0]?.message === message) return;
    logs.unshift({ time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), message });
    logs.splice(12);
    render();
  }
  function setStatus(message) {
    if (status !== message) { status = message; render(); }
  }
  function snapshot() {
    return { settings, status, error: errorText, hasVideo: !!currentVideo, blockingDialog: core.dialogs(document, settings).length > 0, logs: [...logs], frame: window === window.top ? "主页面" : "播放器框架" };
  }
  function mountPanel() {
    // Frames run the same automation; only the top-level page displays a panel.
    if (window !== window.top || panel || !document.body) return;
    const host = document.createElement("div");
    host.setAttribute("data-zhs-helper", "");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
      :host{all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647;font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif;color:#233630}
      section{width:250px;background:#fff;border:1px solid #d9e5df;border-radius:14px;box-shadow:0 8px 32px #12352622;overflow:hidden}
      header{padding:12px 14px;display:flex;align-items:center;justify-content:space-between;background:#eff7f2;font-weight:700}
      button{font:inherit;cursor:pointer;border:0;border-radius:7px;padding:5px 12px;background:#187951;color:white}
      button:focus-visible{outline:3px solid #edc766}button:disabled{opacity:.5;cursor:default}header button{background:none;color:#456055;padding:0 5px}
      main{padding:12px 14px}p{margin:0 0 8px;overflow-wrap:anywhere}label{display:flex;gap:7px;margin:6px 0;align-items:center}input{accent-color:#187951}
      small{color:#6b7c74;display:block;margin-top:9px}.error{color:#a53832}section.folded main{display:none}
    </style><section><header><span>智慧树视频助手</span><button id="fold" aria-label="收起或展开">−</button></header><main>
      <p id="status" role="status"></p><p class="error" id="error"></p><button id="toggle">启动助手</button><button id="reload" hidden>刷新课程页面</button>
      <label><input type="checkbox" id="autoPlay">自动播放／暂停后续播</label>
      <label><input type="checkbox" id="autoNext">播完切换下一节</label>
      <label><input type="checkbox" id="randomAnswer">弹窗随机作答</label>
      <small id="lastLog"></small><small id="version" hidden></small><small>更多设置：点击浏览器工具栏的插件图标。</small>
    </main></section>`;
    document.body.append(host);
    panel = shadow;
    try {
      const version = chrome.runtime.getManifest?.()?.version;
      if (version) {
        shadow.getElementById("version").textContent = `版本 ${version}`;
        shadow.getElementById("version").hidden = false;
      }
    } catch { /* The recovery panel must still render if the extension was reloaded. */ }
    shadow.getElementById("fold").addEventListener("click", () => {
      const folded = shadow.querySelector("section").classList.toggle("folded");
      shadow.getElementById("fold").textContent = folded ? "+" : "−";
    });
    shadow.getElementById("toggle").addEventListener("click", () => {
      if (!ensureContext()) return;
      const enabled = !settings.enabled;
      // A direct user gesture can satisfy the browser's first-play requirement.
      if (enabled && settings.autoPlay && currentVideo && !core.quiz(document, settings)) {
        currentVideo.play().catch(() => {});
      }
      void save({ enabled });
    });
    shadow.getElementById("reload").addEventListener("click", () => location.reload());
    for (const key of ["autoPlay", "autoNext", "randomAnswer"]) {
      shadow.getElementById(key).addEventListener("change", event => { void save({ [key]: event.target.checked }); });
    }
    render();
  }
  function render() {
    if (!panel) return;
    panel.getElementById("status").textContent = status;
    panel.getElementById("error").textContent = errorText;
    panel.getElementById("toggle").textContent = contextLost ? "等待刷新" : settings.enabled ? "暂停助手" : "启动助手";
    panel.getElementById("toggle").disabled = contextLost;
    panel.getElementById("reload").hidden = !contextLost;
    for (const key of ["autoPlay", "autoNext", "randomAnswer"]) {
      panel.getElementById(key).checked = settings[key];
      panel.getElementById(key).disabled = contextLost;
    }
    panel.getElementById("lastLog").textContent = logs[0] ? `${logs[0].time} · ${logs[0].message}` : "等待启动";
  }
  async function save(patch) {
    if (!ensureContext()) return;
    try {
      const saved = await chrome.storage.local.get(storageKey);
      if (!ensureContext()) return;
      const next = core.normalizeSettings({ ...(saved[storageKey] || settings), ...patch });
      await chrome.storage.local.set({ [storageKey]: next });
    } catch (error) {
      if (contextError(error)) return;
      errorText = `设置保存失败：${error.message}`; render();
    }
  }
  function applySettings(raw) {
    if (!ensureContext()) return;
    const previous = settings;
    settings = core.normalizeSettings(raw);
    autoplayBlocked = false;
    errorText = "";
    if (!settings.enabled || !previous.enabled || JSON.stringify(previous.selectors) !== JSON.stringify(settings.selectors)) {
      resetQuizFlow();
      nextAttempts = 0;
      pendingNext = null;
      catalogueExpandAttempts = 0;
      catalogueExpandAt = 0;
      endedAt = 0;
    }
    if (previous.enabled !== settings.enabled) log(settings.enabled ? "助手已启动" : "助手已暂停");
    render();
    void tick();
  }
  function bindVideo(video) {
    const source = video ? `${video.currentSrc || video.src}|${location.href}` : "";
    if (video === currentVideo && source === videoSource) return;
    const preserveQuizFlow = currentVideo && !video && core.dialogs(document, settings).length > 0;
    currentVideo = video;
    videoSource = source;
    endedAt = 0;
    nextAttempts = 0;
    nextAttemptAt = 0;
    pendingNext = null;
    catalogueExpandAttempts = 0;
    catalogueExpandAt = 0;
    lastPlayAttempt = 0;
    autoplayBlocked = false;
    if (!preserveQuizFlow) resetQuizFlow();
    if (video) log("已识别视频播放器");
  }
  function questionSignature(dialog) {
    // Exclude footer text changes (e.g. a submission countdown) when a stem exists.
    return core.fingerprint(dialog, settings);
  }
  function resetQuizFlow() {
    quizStates = new WeakMap();
    seenDialogs = new Set();
    pendingConfirmation = null;
  }
  function handleConfirmation(dialog) {
    const pending = pendingConfirmation;
    if (!settings.randomAnswer || !pending || now() > pending.expiresAt || pending.before.has(dialog) || core.options(dialog, settings).length > 0) return false;
    const button = core.close(dialog, settings);
    if (!button) return false;
    if (pending.attempts >= 3) { setStatus("确认弹窗未关闭，请手动处理"); return true; }
    setStatus("正在确认答题结果");
    if (now() < pending.due) return true;
    pending.attempts += 1;
    pending.due = now() + Math.max(2500, settings.actionDelay);
    core.click(button);
    log("已点击答题后弹窗的确定／继续");
    return true;
  }
  function handleQuiz(quiz) {
    if (!settings.randomAnswer) {
      setStatus("检测到弹窗题目，等待你作答");
      return;
    }
    let state = quizStates.get(quiz.dialog);
    const completed = core.submitted(quiz.dialog);
    const signature = quiz.followup ? state.signature : questionSignature(quiz.dialog);
    if (!state || !completed && (state.signature !== signature || state.completed)) {
      state = { signature, stage: completed ? "submitted" : "waiting", due: now() + settings.actionDelay, attempts: 0, completed };
      quizStates.set(quiz.dialog, state);
      log(completed ? "已识别题目提交完成，准备关闭弹窗" : "检测到弹窗题目，准备随机选择");
    } else if (completed) {
      if (state.stage !== "submitted") {
        state.stage = "submitted";
        state.due = now() + settings.actionDelay;
        state.attempts = 0;
        log("已识别题目提交完成，准备关闭弹窗");
      }
      state.completed = true;
    }
    if (now() < state.due) { setStatus(state.stage === "submitted" ? "题目已提交，等待关闭弹窗" : "正在处理弹窗题目"); return; }
    if (state.stage === "waiting") {
      const groups = core.questionGroups(quiz.dialog, settings);
      const unsupported = groups.findIndex(group => group.options.length === 0);
      if (unsupported >= 0) { setStatus(`第${unsupported + 1}题没有可识别的选项，请手动处理`); return; }
      const missing = groups.filter(group => !group.options.some(core.selected));
      if (missing.length) {
        const picked = core.randomChoice(missing[0].options);
        if (picked) { core.click(picked); log(`第${groups.indexOf(missing[0]) + 1}题已随机选择一个选项`); }
      }
      state.stage = missing.length <= 1 ? "selected" : "waiting";
      state.due = now() + settings.actionDelay;
    } else if (state.stage === "selected") {
      const groups = core.questionGroups(quiz.dialog, settings);
      if (groups.length === 0 || !groups.every(group => group.options.some(core.selected))) {
        setStatus("无法确认选项是否选中，请手动作答或设置选项选择器");
        return;
      }
      const button = core.submit(quiz.dialog, settings);
      if (!button) { setStatus("已选择选项，等待可用的提交按钮"); return; }
      state.stage = "submitted";
      state.due = now() + settings.actionDelay;
      // Only a newly opened confirmation after our own submission is eligible.
      pendingConfirmation = { before: new Set(core.dialogs(document, settings)), expiresAt: now() + 30000, due: state.due, attempts: 0 };
      core.click(button);
      log("已点击提交答案");
    } else if (state.stage === "submitted") {
      const button = core.close(quiz.dialog, settings);
      if (button && state.attempts < 3) {
        state.attempts += 1;
        state.due = now() + Math.max(2500, settings.actionDelay);
        core.click(button);
        log("已点击确定／继续学习／关闭");
        setStatus("已点击关闭，等待弹窗结束");
      } else setStatus(state.attempts >= 3 ? "关闭弹窗未成功，请手动点击右上角 ×" : "题目已提交，等待可用的关闭按钮；可手动点击右上角 ×");
    }
  }
  async function play(video) {
    if (!settings.autoPlay || !video.paused || autoplayBlocked || now() - lastPlayAttempt < 4000) return;
    lastPlayAttempt = now();
    if (settings.muted) video.muted = true;
    try {
      await video.play();
      if (settings.enabled) log("已请求播放视频");
    } catch (error) {
      if (error.name === "NotAllowedError") {
        autoplayBlocked = true;
        setStatus("浏览器阻止自动播放，请先手动点一次视频播放");
      } else if (error.name !== "AbortError") {
        errorText = `播放失败：${error.message}`;
        render();
      }
    }
  }
  async function tick() {
    if (!ensureContext() || !ready || running) return;
    running = true;
    try {
      mountPanel();
      bindVideo(core.video(document, settings));
      if (!settings.enabled) { setStatus("助手已暂停"); return; }
      const dialogs = core.dialogs(document, settings);
      for (const previous of seenDialogs) {
        if (!dialogs.includes(previous)) quizStates.delete(previous);
      }
      seenDialogs = new Set(dialogs);
      const topDialog = dialogs[0];
      const videoPage = currentVideo || document.querySelector("video, iframe");
      if (topDialog && videoPage && handleConfirmation(topDialog)) return;
      const detectedQuiz = core.quiz(document, settings);
      const modal = detectedQuiz || (topDialog && quizStates.get(topDialog)?.stage === "submitted" ? { dialog: topDialog, options: [], followup: true } : null);
      if (modal && videoPage) { handleQuiz(modal); return; }
      if (!currentVideo) {
        setStatus(window === window.top && document.querySelector("iframe") ? "当前页面未找到视频；若播放器在框架中，请通过插件图标查看框架状态" : "等待视频播放器，请打开课程视频页面");
        return;
      }
      if (parentBlocked) { setStatus("主页面有弹窗，等待弹窗处理完毕"); return; }
      // Keep other visible dialogs open for manual handling; never click arbitrary confirmations.
      if (dialogs.length > 0) {
        setStatus("检测到其他弹窗，等待手动处理"); return;
      }
      pendingConfirmation = null;
      const video = currentVideo;
      if (video.ended) {
        if (!settings.autoNext) { setStatus("本节已播完，自动切换已关闭"); return; }
        if (!endedAt) endedAt = now();
        if (now() - endedAt < settings.actionDelay) { setStatus("本节已播完，等待切换"); return; }
        if (nextAttempts >= 3) { setStatus("下一节未成功加载，已停止重试；请手动切换"); return; }
        if (now() - nextAttemptAt < 8000) { setStatus("已点击下一节，等待视频加载"); return; }
        const action = pendingNext || core.nextAction(document, settings);
        if (action.kind === "expand") {
          if (catalogueExpandAttempts >= 3) { setStatus("章节未成功展开，请手动展开后暂停并重新启动助手"); return; }
          if (now() - catalogueExpandAt < 3000) { setStatus("等待章节目录加载"); return; }
          catalogueExpandAt = now();
          catalogueExpandAttempts += 1;
          core.click(action.target);
          log(`已展开${action.label || "后续章节"}，等待课程目录加载`);
          setStatus("已展开目录，等待识别下一节");
          return;
        }
        const button = action.target;
        if (!button && window === window.top) { setStatus(`本节已播完：${action.reason}`); return; }
        if (button && (!button.isConnected || !core.available(button))) { setStatus("已请求的下一节暂不可点击，请等待加载或手动切换"); return; }
        nextAttempts += 1;
        nextAttemptAt = now();
        if (button) {
          pendingNext = action;
          core.click(button);
          log(`视频播放结束，已请求下一节：${action.label || "下一节"}`);
          setStatus(`正在切换：${action.label || "下一节"}`);
        }
        else {
          const result = await chrome.runtime.sendMessage({ type: "zhs:next-in-parent" });
          if (result?.expanded) {
            nextAttempts -= 1;
            log("已展开主页面的后续章节，等待课程目录加载");
          } else if (result?.clicked) log("视频播放结束，已点击主页面下一节");
          else setStatus("未找到主页面的下一节按钮，请检查适配设置");
        }
        return;
      }
      endedAt = 0;
      nextAttempts = 0;
      pendingNext = null;
      catalogueExpandAttempts = 0;
      catalogueExpandAt = 0;
      if (!video.paused) {
        autoplayBlocked = false;
        setStatus("视频播放中");
      } else if (autoplayBlocked) {
        setStatus("浏览器阻止自动播放，请先手动点一次视频播放");
      } else {
        setStatus(settings.autoPlay ? "视频已暂停，准备续播" : "等待手动播放");
        await play(video);
      }
    } catch (error) {
      if (contextError(error)) return;
      errorText = error.name === "SyntaxError" ? "CSS 选择器无效，请在插件设置中修正" : error.message;
      setStatus("操作遇到问题，请检查设置");
      render();
    } finally {
      running = false;
      if (!contextLost) {
        try {
          const reply = await chrome.runtime.sendMessage({ type: "zhs:report", snapshot: snapshot() });
          parentBlocked = !!reply?.parentBlocked;
        } catch (error) { contextError(error); }
      }
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === "zhs:status") respond(snapshot());
    if (message?.type === "zhs:next-in-parent") {
      try {
        const action = ensureContext() && settings.enabled && settings.autoNext && !snapshot().blockingDialog && core.nextAction(document, settings);
        if (action?.target) { core.click(action.target); log(`播放器框架已播完，已${action.kind === "expand" ? "展开目录" : "请求下一节"}：${action.label}`); }
        respond({ clicked: !!action?.target, expanded: action?.kind === "expand" });
      } catch { respond({ clicked: false }); }
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[storageKey]) applySettings(changes[storageKey].newValue);
  });
  async function initialize() {
    try {
      if (!ensureContext()) { mountPanel(); return; }
      const value = await chrome.storage.local.get(storageKey);
      if (!ensureContext()) { mountPanel(); return; }
      settings = core.normalizeSettings(value[storageKey]);
      ready = true;
      mountPanel();
      void tick();
    } catch (error) {
      if (!contextError(error)) errorText = `无法读取设置：${error.message}`;
      mountPanel(); render();
    }
  }
  timer = setInterval(() => { void tick(); }, 1000);
  void initialize();
  window.addEventListener("pagehide", event => { if (!event.persisted) clearInterval(timer); });
})();
