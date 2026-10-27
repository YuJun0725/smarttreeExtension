/* Shared DOM adapter. No network requests or page-private APIs. */
(() => {
  "use strict";
  const defaults = Object.freeze({
    enabled: false,
    autoPlay: true,
    autoNext: true,
    randomAnswer: false,
    muted: false,
    actionDelay: 1500,
    selectors: { video: "", next: "", quiz: "", option: "", submit: "", close: "" }
  });
  function normalizeSettings(raw = {}) {
    const result = { ...defaults, selectors: { ...defaults.selectors } };
    for (const key of ["enabled", "autoPlay", "autoNext", "randomAnswer", "muted"]) {
      if (typeof raw[key] === "boolean") result[key] = raw[key];
    }
    result.actionDelay = Math.min(10000, Math.max(500, Number(raw.actionDelay) || defaults.actionDelay));
    for (const key of Object.keys(defaults.selectors)) {
      if (typeof raw.selectors?.[key] === "string") result.selectors[key] = raw.selectors[key].trim().slice(0, 1000);
    }
    return result;
  }
  const builtin = {
    video: "video",
    next: ".next_lesson_btn, .next-lesson, .next-btn, .prism-next-btn, [aria-label='下一节'], [title='下一节']",
    quiz: ".el-dialog, .el-message-box, [role='dialog'], [role='alertdialog'], .ant-modal-content, .layui-layer, .dialog-test, .topic-dialog, .ai-class-exercise-dialog",
    option: "label.el-radio, label.el-checkbox, label.ant-radio-wrapper, label.ant-checkbox-wrapper, .topic-item, .answer-option, .answerOption, .ai-class-exercise-dialog .ques-list .item > .option, [role='radio'], [role='checkbox'], label:has(input[type='radio']), label:has(input[type='checkbox']), input[type='radio'], input[type='checkbox']",
    submit: "button, [role='button'], .btn, .submit, .answer-submit, .topic-submit, .el-dialog__footer span, .el-message-box__btns span, input[type='button'], input[type='submit']",
    close: "button, [role='button'], .btn, .el-dialog__footer span, .el-message-box__btns span, input[type='button'], input[type='submit']"
  };
  const cleanText = node => (node?.innerText || node?.textContent || node?.getAttribute?.("aria-label") || node?.value || "").replace(/\s+/g, " ").trim();
  function visible(node) {
    if (!(node instanceof Element) || !node.isConnected || node.closest("[data-zhs-helper]")) return false;
    if (node.closest("[hidden], [aria-hidden='true']")) return false;
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && node.getClientRects().length > 0;
  }
  function available(node) {
    return visible(node) && !node.disabled && node.getAttribute("aria-disabled") !== "true" && !node.matches(".disabled, .is-disabled") && !node.closest("fieldset:disabled");
  }
  function query(root, selector) {
    return [...root.querySelectorAll(selector)]; // Invalid custom selectors are reported by the caller.
  }
  function nodes(root, key, settings) {
    return query(root, settings.selectors[key] || builtin[key]);
  }
  function video(root, settings) {
    return nodes(root, "video", settings).filter(node => node.tagName === "VIDEO" && visible(node))
      .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0] || null;
  }
  function moocNextAction(catalogue) {
    const expand = (target, label) => ({ target, kind: "expand", label });
    if (catalogue.matches(".is-collapse")) {
      const toggle = catalogue.querySelector(".collapse-box");
      if (available(toggle)) return expand(toggle, "课程目录");
    }
    const rows = query(catalogue, ".chapter-item, .chapter-content-second");
    const marked = rows.filter(row => row.matches(".current"));
    const current = marked.find(row => !marked.some(child => child !== row && row.contains(child)));
    if (!current) return { reason: "已找到新版目录，但未识别到当前课程标记；请在目录中点一次当前课程" };
    const label = row => cleanText(row.querySelector(":scope > .item-box") || row);
    const chapters = query(catalogue, ".el-collapse-item");
    const openChapter = chapter => {
      const header = chapter?.querySelector(".el-collapse-item__header");
      if (header && available(header) && !chapter.matches(".is-disabled, .disabled") && header.getAttribute("aria-expanded") !== "true" && !chapter.matches(".is-active")) return expand(header, cleanText(header));
      return null;
    };
    const targetRow = rows[rows.indexOf(current) + 1];
    if (targetRow) {
      const chapter = targetRow.closest(".el-collapse-item");
      if (!visible(targetRow)) return openChapter(chapter) || { reason: "下一节在隐藏的目录中，请先展开课程目录" };
      if (!available(targetRow) || targetRow.matches(".font_gray_inclined")) return { reason: "已识别下一节，但该课程行暂不可点击" };
      // Click the same title area as a user; clicking only its outer container can miss a child handler.
      const target = targetRow.querySelector(":scope > .item-box") || targetRow;
      return { target, kind: "lesson", label: label(targetRow), currentLabel: label(current) };
    }
    const chapter = current.closest(".el-collapse-item");
    const nextChapter = chapter && chapters[chapters.indexOf(chapter) + 1];
    if (nextChapter) return openChapter(nextChapter) || { reason: "后续章节已显示，但尚未识别到视频行，请展开章节后重试" };
    return { reason: "当前已加载目录中未发现后续视频，请检查是否还有未展开的章节" };
  }
  function nextAction(root, settings) {
    // Prefer the course's own catalogue; generic next buttons may belong to unrelated navigation.
    if (!settings.selectors.next) {
      const moocCatalogue = root.querySelector(".course-catalog .catalog-com, .catalog-com");
      if (moocCatalogue) return moocNextAction(moocCatalogue);
    }
    const explicit = nodes(root, "next", settings).find(available);
    if (explicit) return { target: explicit, kind: "button", label: cleanText(explicit) || "下一节" };
    if (settings.selectors.next) return { reason: "自定义的下一节选择器未匹配到可用按钮，请清空该设置以使用自动识别" };
    const labelled = query(root, "button, a, [role='button'], .nextButton, .next-btn, .next_lesson_btn")
      .find(node => available(node) && /^(下一[节课]|下一个视频|播放下一[节课]|下一[节课]视频|next\s*(lesson|video))$/i.test(cleanText(node)));
    if (labelled) return { target: labelled, kind: "button", label: cleanText(labelled) };
    // Some course versions expose only a catalogue, without a next button.
    const catalogue = root.querySelector(".video-study .box-right .list");
    if (!catalogue) return { reason: "未识别到下一节按钮或课程目录，请检查页面适配设置" };
    const rows = query(catalogue, "li").filter(row => row.querySelector(".catalogue_title, .catalogue_title3, .catalogue_title4") && !row.matches(".chapter-test") && (row.matches(".video") || row.querySelector(".time_ico_box, .time_ico_half, .time_icofinish, .learningPercentage-div")));
    const index = rows.findIndex(row => row.matches(".current_play") || row.querySelector(".current_play"));
    const target = index >= 0 ? rows[index + 1] : null;
    return target && available(target) && !target.matches(".font_gray_inclined") ? { target, kind: "lesson", label: cleanText(target) } : { reason: "已找到目录，但未匹配到可点击的后续视频，请检查当前课程和目录状态" };
  }
  function next(root, settings) {
    return nextAction(root, settings).target || null;
  }
  function options(dialog, settings) {
    const candidates = nodes(dialog, "option", settings).filter(node => {
      if (available(node)) return true;
      // Component libraries visually hide their native inputs.
      return node.matches("input[type='radio'], input[type='checkbox']") && !node.disabled && visible(node.closest("label"));
    });
    return candidates.filter(node => !candidates.some(parent => parent !== node && parent.contains(node)));
  }
  function questionGroups(dialog, settings) {
    if (dialog.matches(".ai-class-exercise-dialog")) {
      return query(dialog, ".ques-list .item").filter(item => item.querySelector(":scope > .row"))
        .map(container => ({ container, options: options(container, settings) }));
    }
    return [{ container: dialog, options: options(dialog, settings) }];
  }
  function dialogs(root, settings) {
    const candidates = nodes(root, "quiz", settings).filter(visible);
    // A dialog wrapper and its inner dialog describe one modal, not two.
    const leaves = candidates.filter(node => !candidates.some(child => child !== node && node.contains(child)));
    const layer = node => {
      for (let parent = node; parent; parent = parent.parentElement) {
        const zIndex = getComputedStyle(parent).zIndex;
        if (zIndex !== "auto" && Number.isFinite(Number(zIndex))) return Number(zIndex);
      }
      return 0;
    };
    return leaves.sort((a, b) => layer(b) - layer(a) || (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1));
  }
  function quiz(root, settings) {
    // Limit automatic answers to a visible modal on a page with a video.
    const dialog = dialogs(root, settings)[0];
    if (!dialog) return null;
    const choices = options(dialog, settings);
    const completed = submitted(dialog);
    return completed || choices.length > 0 && (settings.selectors.quiz || dialog.closest(".dialog-test, .topic-dialog") || /弹题|随堂|单选|多选|判断|选择|答题|问题|题目/.test(cleanText(dialog))) ? { dialog, options: choices, completed } : null;
  }
  function submitted(dialog) {
    if (!dialog.matches(".ai-class-exercise-dialog")) return false;
    // The page state is authoritative, including when a component was recreated
    // or the helper attached after submission. Disabled alone does not mean done.
    return query(dialog, ".el-dialog__footer .btn, .el-dialog__footer button, .el-dialog__footer [role='button']")
      .some(node => visible(node) && (node.matches(".is-finish") || /^已提交$/.test(cleanText(node).replace(/\s/g, ""))));
  }
  function submit(dialog, settings) {
    return nodes(dialog, "submit", settings).find(node => available(node) && (settings.selectors.submit || /^(提交(答案|回答|作答)?|确定|确认|回答|提交并继续)$/.test(cleanText(node).replace(/\s/g, "")))) || null;
  }
  function close(dialog, settings) {
    const labelled = nodes(dialog, "close", settings).find(node => available(node) && (settings.selectors.close || /^(确定|确认|继续(学习|播放)?|关闭|我知道了|知道了|完成|下一题)$/.test(cleanText(node).replace(/\s/g, ""))));
    if (labelled || settings.selectors.close) return labelled || null;
    // The AI exercise's finished footer has no click handler; its header icon closes it.
    if (submitted(dialog)) {
      return query(dialog, ".ai-class-exercise-dialog-header .header-icon, .el-dialog__header .el-dialog__headerbtn").find(available) || null;
    }
    return null;
  }
  function selected(node) {
    return node.checked === true || !!node.querySelector("input:checked") || node.getAttribute("aria-checked") === "true" || node.matches(".is-checked, .checked, .selected, .active") || !!node.querySelector(".is-checked, [aria-checked='true'], .topic-option-item.active, .topic-option.active, .iconxuanzhong, .class-question-select.isSelect");
  }
  function click(node) {
    if (!available(node)) return false;
    // HTMLElement.click() emits an untrusted PointerEvent in current Chromium,
    // which this course component rejects. Use an explicit MouseEvent consistently.
    return node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 0, detail: 1 }));
  }
  function randomChoice(items, random = Math.random) {
    return items.length ? items[Math.min(items.length - 1, Math.max(0, Math.floor(random() * items.length)))] : null;
  }
  function fingerprint(dialog, settings) {
    if (dialog.matches(".ai-class-exercise-dialog")) {
      return JSON.stringify(questionGroups(dialog, settings).map(group => [cleanText(group.container.querySelector(":scope > .row .question-info")), group.options.map(cleanText)]));
    }
    const labels = options(dialog, settings).map(cleanText);
    const heading = dialog.querySelector(".question-title, .topic-title, .stem, [data-question]");
    const text = cleanText(dialog);
    const optionStart = labels[0] ? text.indexOf(labels[0]) : -1;
    return JSON.stringify([heading ? cleanText(heading) : (optionStart >= 0 ? text.slice(0, optionStart) : text.slice(0, 800)), labels]);
  }
  globalThis.ZhsHelperCore = Object.freeze({ defaults, builtin, normalizeSettings, cleanText, visible, available, video, next, nextAction, options, questionGroups, dialogs, quiz, submitted, submit, close, selected, click, randomChoice, fingerprint });
})();
