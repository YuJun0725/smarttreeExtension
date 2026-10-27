# 智慧树视频助手：项目交接与上下文

记录日期：2026-10-27。

这是项目状态摘要，不是完整聊天记录。新会话请先阅读本文件，再阅读 README.md 和相关代码。

## 当前工作目录

- 用户已将项目复制到 `F:\yujun\github_file\project\smarttree_extension`，后续维护使用这个目录。
- 旧目录是 `C:\Users\13736\Desktop\tree`，后续不要继续在旧目录修改项目。
- 迁移时检查了 `extension/core.js`、`extension/content.js`、`extension/manifest.json` 和 `tests/browser.test.cjs`，与旧目录对应文件的 SHA-256 一致。
- 仅复制项目文件不会复制或重新关联应用中的聊天记录。继续原聊天可以保留原对话；另开聊天时可以读取本文件恢复项目背景。

## 产品与当前版本

- Chrome / Edge Manifest V3 扩展，名称为「智慧树视频助手」，当前版本 **0.1.7**。
- 功能：自动播放与续播、视频结束后切换下一节、可选的弹窗随机作答、识别提交完成后关闭已适配的弹窗。
- 首次安装默认暂停，随机作答默认关闭。随机作答不保证正确；多选题也只随机选一个选项。
- 设置保存在 `chrome.storage.local` 的 `zhsHelperSettings` 中，对同一浏览器中的智慧树标签页生效。
- 通过网页 DOM、播放器状态和点击事件工作，没有直接调用平台的进度上报或答题接口。

## 文件与职责

- `extension/manifest.json`：版本、域名范围、扩展权限、入口。
- `extension/core.js`：播放器、目录、选项、完成状态、提交与关闭按钮的 DOM 识别。
- `extension/content.js`：定时检查、播放与切换流程、弹题状态机、右下角面板、连接失效恢复提示。
- `extension/background.js`：框架状态汇总，以及播放器 iframe 请求主页面切换的消息转发。
- `extension/popup.html`、`popup.css`、`popup.js`：插件设置与运行记录。
- `tests/browser.test.cjs`：使用 Playwright 与本机 Chrome 的模拟浏览器测试。
- `releases/`：各版本的分发文件及简单使用说明。

## 已处理的重要问题

1. 连续或叠加弹窗：按上层弹窗优先处理，每个弹窗分别记录状态，支持提交后的「确定」。
2. 扩展重载后出现 `Extension context invalidated`：停止旧脚本并提示刷新课程网页。
3. `wisdom-mooc.zhihuishu.com/study/index`：适配 `.catalog-com`、`.chapter-item.current` 和三级小节，支持展开后续章节。
4. 新版 MOOC「AI随堂练习」：适配 `.ai-class-exercise-dialog`、自定义 `.option`、`.class-question-select.isSelect` 和「提交作答」；多题逐题选择后统一提交。
5. 自动切换后返回首页：公开页面对部分脚本点击事件有异常操作判断。当前点击辅助函数统一派发显式 `MouseEvent`，并保留相关回归测试；不要随意改回 HTMLElement.click()。
6. AI 弹窗已显示「已提交」，助手仍等待提交按钮：以页面完成状态为准恢复关闭流程，支持弹窗组件重建、禁用的完成按钮及选项被移除的情况。
7. `ai-smart-course-student-pro.zhihuishu.com/learnPage/…`：0.1.7 新增个性化目录及章节目录适配。先寻找当前知识点内的下一视频资源，再进入下一知识点；忽略 PDF 等其他资源，不随意选择推荐项。

## 最近一次用户反馈与验证范围

- 用户在 AI 智慧课程页看到：「本节已播完：未识别到下一节按钮或课程目录，请检查页面适配设置」。
- 因此最近修复针对新页面的目录识别，播放器已经能够报告结束。
- 0.1.7 在旧目录运行 `npm run check` 和 `npm test`，**54 项模拟测试全部通过**；上面列出的迁移后核心文件与测试文件一致。
- 尚未在登录后的真实课程中完成端到端验证。不要将模拟测试通过描述为已在用户课程中验证。
- 新目录没有重新运行测试；后续改动后应在新目录验证。

## 维护和发布

```powershell
npm run check
npm test
```

- 修改版本时同步 `extension/manifest.json`、`package.json` 和 `package-lock.json`。
- 分发包只放 `extension/` 中的插件文件和简单使用说明，不打包 `node_modules`、浏览器配置或账号数据。
- 更新扩展后，在扩展管理页点击「重新加载」，再刷新课程网页，并核对面板底部版本号。
- 浏览器原先加载的扩展如果仍指向旧目录，移动源码不会自动修改其加载路径；需要改为加载新目录中的 `extension` 文件夹。
- 遇到新页面优先核对真实 DOM 或官方页面组件，避免只猜选择器。截图能辅助诊断，但不能替代实际结构验证。
- 公共页面资源的研究缓存可能位于 `test-results/research/`，仅用于读取分析，不执行这些第三方脚本。

## 给下一会话的起始提示

请在 `F:\yujun\github_file\project\smarttree_extension` 工作，先阅读 `CONTEXT_HANDOFF.md` 和 `README.md`。这是一个当前版本为 0.1.7 的智慧树浏览器扩展，请沿用已有实现与测试，不要重新从零创建；继续处理我随后描述的问题。
