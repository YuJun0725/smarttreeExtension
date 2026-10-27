const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
let browser;
before(async () => {
  const executablePath = process.env.CHROME_PATH || [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(value => fs.existsSync(value));
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
after(async () => { await browser?.close(); });

async function fixture(settings = {}, html = '') {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.clock.install();
  await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font:16px system-ui;padding:40px}video{width:640px;height:360px;background:#182b24}label{display:block;padding:10px}.el-dialog{position:absolute;left:90px;top:60px;background:white;padding:30px;border:1px solid #aaa;min-width:400px}button{padding:8px}</style><h1>模拟课程页面</h1><video></video>${html}</html>`);
  await page.evaluate(settings => {
    window.__settings = { enabled: true, actionDelay: 500, ...settings };
    window.__storageListeners = [];
    window.__messageListeners = [];
    window.__plays = 0;
    window.__next = 0;
    window.__submitted = 0;
    window.__closed = 0;
    window.__video = { paused: true, ended: false, currentSrc: 'https://media.example/lesson-1.mp4' };
    const video = document.querySelector('video');
    for (const key of ['paused', 'ended', 'currentSrc']) Object.defineProperty(video, key, { get: () => window.__video[key], configurable: true });
    video.play = () => {
      window.__plays++;
      if (window.__blockPlay) return Promise.reject(new DOMException('User gesture needed', 'NotAllowedError'));
      window.__video.paused = false;
      return Promise.resolve();
    };
    window.__update = async patch => {
      const oldValue = window.__settings;
      window.__settings = { ...oldValue, ...patch };
      for (const listener of window.__storageListeners) listener({ zhsHelperSettings: { oldValue, newValue: window.__settings } }, 'local');
    };
    window.chrome = {
      storage: {
        local: { get: async () => ({ zhsHelperSettings: window.__settings }), set: async value => window.__update(value.zhsHelperSettings) },
        onChanged: { addListener: listener => window.__storageListeners.push(listener) }
      },
      runtime: {
        id: 'test-extension',
        onMessage: { addListener: listener => window.__messageListeners.push(listener) },
        sendMessage: async () => ({ parentBlocked: false })
      }
    };
    document.querySelector('.next_lesson_btn')?.addEventListener('click', () => window.__next++);
  }, settings);
  await page.addScriptTag({ path: path.join(root, 'extension/core.js') });
  await page.addScriptTag({ path: path.join(root, 'extension/content.js') });
  await page.waitForFunction(() => document.querySelector('[data-zhs-helper]'));
  return page;
}
async function status(page) {
  return page.evaluate(() => new Promise(resolve => window.__messageListeners[0]({ type: 'zhs:status' }, {}, resolve)));
}
const quizHtml = `<div class="el-dialog" role="dialog"><h3 class="question-title">随堂单选：请选择一个选项</h3><div class="choices"><label><input type="radio" name="quiz" value="a">A. 第一个选项</label><label><input type="radio" name="quiz" value="b">B. 第二个选项</label></div><button class="answer-submit">提交答案</button><button class="continue-button" hidden>继续学习</button></div>`;
const aiQuestionHtml = '<div class="item"><div class="row"><span class="type">1. [单选题]</span><div class="question-info">在应用稳定性判据时，请选择一个选项。</div></div><div class="option"><span class="class-question-select">A</span><span class="answer">第一个选项</span></div><div class="option"><span class="class-question-select">B</span><span class="answer">第二个选项</span></div></div>';
const aiQuizHtml = `<div class="el-overlay" style="position:fixed;inset:0;z-index:3000"><div role="dialog" class="el-overlay-dialog"><div class="el-dialog ai-class-exercise-dialog"><div class="el-dialog__header"><div class="ai-class-exercise-dialog-header"><div><p class="tit">AI随堂练习</p><p class="tips">以下所有内容均由AI生成请注意甄别</p></div><span class="header-icon">×</span></div></div><div class="el-dialog__body"><div class="ques-list"><div class="el-scrollbar__wrap"><div class="el-scrollbar__view">${aiQuestionHtml}</div></div></div></div><div class="el-dialog__footer"><div class="dialog-footer"><button class="btn">提交作答</button></div></div></div></div></div>`;
async function wireAiExercise(page, { keepFeedback = false } = {}) {
  await page.evaluate(({ keepFeedback }) => {
    document.addEventListener('click', event => {
      const option = event.target.closest('.ai-class-exercise-dialog .option');
      if (option) {
        option.parentElement.querySelectorAll('.class-question-select').forEach(node => node.classList.remove('isSelect'));
        option.querySelector('.class-question-select').classList.add('isSelect');
      }
      const submit = event.target.closest('.ai-class-exercise-dialog .el-dialog__footer .btn:not(.is-finish)');
      if (submit) {
        const dialog = submit.closest('.ai-class-exercise-dialog');
        const questions = [...dialog.querySelectorAll('.ques-list .item')];
        if (questions.every(item => item.querySelector('.class-question-select.isSelect'))) {
          window.__answeredAtSubmit = questions.map(item => item.querySelectorAll('.class-question-select.isSelect').length);
          window.__submitted++;
          if (keepFeedback) {
            submit.classList.add('is-finish');
            submit.textContent = '已提交';
            for (const item of questions) {
              const feedback = document.createElement('span');
              feedback.className = 'correct-ops';
              feedback.textContent = '正确答案：A';
              item.append(feedback);
            }
          } else dialog.closest('.el-overlay').remove();
        }
      }
      const close = event.target.closest('.ai-class-exercise-dialog .header-icon');
      if (close && close.closest('.ai-class-exercise-dialog').querySelector('.btn.is-finish')) {
        window.__closed++;
        close.closest('.el-overlay').remove();
      }
    });
  }, { keepFeedback });
}

test('second popup AI exercise selects a custom option and clicks 提交作答', async () => {
  const page = await fixture({ randomAnswer: true }, quizHtml);
  await wireAiExercise(page);
  await page.evaluate(html => {
    const first = document.querySelector('.el-dialog');
    first.querySelector('.answer-submit').addEventListener('click', () => {
      window.__submitted++;
      first.remove();
      document.body.insertAdjacentHTML('beforeend', html);
    });
  }, aiQuizHtml);
  await page.clock.runFor(14000);
  assert.deepEqual(await page.evaluate(() => [window.__submitted, window.__plays]), [2, 1]);
  assert.equal(await page.locator('.ai-class-exercise-dialog').count(), 0);
  await page.close();
});

test('AI exercise answers every question before a single submission', async () => {
  const html = aiQuizHtml.replace(aiQuestionHtml, aiQuestionHtml + aiQuestionHtml.replace('1. [单选题]', '2. [单选题]').replace('在应用稳定性判据时', '在计算其他条件时'));
  const page = await fixture({ randomAnswer: true }, html);
  await wireAiExercise(page, { keepFeedback: true });
  await page.clock.runFor(5000);
  assert.equal(await page.evaluate(() => window.__submitted), 1);
  assert.deepEqual(await page.evaluate(() => window.__answeredAtSubmit), [1, 1]);
  await page.clock.runFor(8000);
  assert.deepEqual(await page.evaluate(() => [window.__submitted, window.__closed, window.__plays]), [1, 1, 1]);
  await page.close();
});

test('AI feedback does not reset the question state or reselect the answer', async () => {
  const page = await fixture({ randomAnswer: true }, aiQuizHtml);
  await wireAiExercise(page, { keepFeedback: true });
  await page.clock.runFor(13000);
  assert.deepEqual(await page.evaluate(() => [window.__submitted, window.__closed, window.__plays]), [1, 1, 1]);
  await page.close();
});

test('AI random answering off waits for manual input', async () => {
  const page = await fixture({ randomAnswer: false }, aiQuizHtml);
  await wireAiExercise(page);
  await page.clock.runFor(8000);
  assert.equal(await page.locator('.class-question-select.isSelect').count(), 0);
  assert.deepEqual(await page.evaluate(() => [window.__submitted, window.__plays]), [0, 0]);
  assert.match((await status(page)).status, /等待你作答/);
  await page.close();
});

test('AI unsupported question prevents submitting only a partial set of answers', async () => {
  const unsupported = '<div class="item"><div class="row"><span class="type">2. [填空题]</span><div class="question-info">请输入内容。</div></div><textarea></textarea></div>';
  const page = await fixture({ randomAnswer: true }, aiQuizHtml.replace(aiQuestionHtml, aiQuestionHtml + unsupported));
  await wireAiExercise(page);
  await page.clock.runFor(10000);
  assert.equal(await page.evaluate(() => window.__submitted), 0);
  assert.match((await status(page)).status, /第2题.*手动/);
  await page.close();
});

test('AI exercise can be handled while the page video element is temporarily hidden', async () => {
  const page = await fixture({ randomAnswer: true }, aiQuizHtml);
  await wireAiExercise(page);
  await page.evaluate(() => { document.querySelector('video').hidden = true; });
  await page.clock.runFor(10000);
  assert.equal(await page.evaluate(() => window.__submitted), 1);
  await page.close();
});

test('AI submitted state survives the video being hidden after submission', async () => {
  const page = await fixture({ randomAnswer: true }, aiQuizHtml);
  await wireAiExercise(page, { keepFeedback: true });
  await page.evaluate(() => {
    document.addEventListener('click', event => {
      if (event.target.closest('.ai-class-exercise-dialog .el-dialog__footer .btn')) document.querySelector('video').hidden = true;
    });
  });
  await page.clock.runFor(10000);
  assert.deepEqual(await page.evaluate(() => [window.__submitted, window.__closed]), [1, 1]);
  await page.close();
});

test('AI exercise finished feedback can be closed using its SVG header icon', async () => {
  const html = aiQuizHtml.replace('<span class="header-icon">×</span>', '<svg class="header-icon" width="30" height="30"><path d="M0 0L30 30M30 0L0 30"></path></svg>');
  const page = await fixture({ randomAnswer: true }, html);
  await wireAiExercise(page, { keepFeedback: true });
  await page.clock.runFor(10000);
  assert.deepEqual(await page.evaluate(() => [window.__submitted, window.__closed, window.__plays]), [1, 1, 1]);
  await page.close();
});

const aiSubmittedHtml = aiQuizHtml
  .replace(aiQuestionHtml, aiQuestionHtml.replace('class="class-question-select">A', 'class="class-question-select isSelect isError">A').replace('</div></div>', '</div><span class="correct-ops">正确答案：B</span></div>'))
  .replace('<button class="btn">提交作答</button>', '<button class="btn is-finish" disabled>已提交</button>');

test('AI already-submitted dialog is closed when the helper has no submission history', async () => {
  const page = await fixture({ randomAnswer: true }, aiSubmittedHtml);
  await wireAiExercise(page, { keepFeedback: true });
  await page.evaluate(() => {
    window.__optionClicks = 0;
    document.addEventListener('click', event => {
      if (event.target.closest('.ai-class-exercise-dialog .option')) window.__optionClicks++;
    });
  });
  await page.clock.runFor(10000);
  assert.deepEqual(await page.evaluate(() => [window.__submitted, window.__closed, window.__plays, window.__optionClicks]), [0, 1, 1, 0]);
  await page.close();
});

test('AI completed dialog recreated after submit does not get stuck waiting for a submit button', async () => {
  const page = await fixture({ randomAnswer: true }, aiQuizHtml);
  await wireAiExercise(page, { keepFeedback: true });
  await page.evaluate(() => {
    document.addEventListener('click', event => {
      const button = event.target.closest('.ai-class-exercise-dialog .el-dialog__footer .btn.is-finish');
      if (button) {
        const overlay = button.closest('.el-overlay');
        overlay.replaceWith(overlay.cloneNode(true));
      }
    });
  });
  await page.clock.runFor(12000);
  assert.deepEqual(await page.evaluate(() => [window.__submitted, window.__closed, window.__plays]), [1, 1, 1]);
  await page.close();
});

test('AI 已提交 footer text also identifies completion without the finish CSS class', async () => {
  const page = await fixture({ randomAnswer: true }, aiSubmittedHtml.replace('btn is-finish', 'btn is-disabled'));
  await page.evaluate(() => {
    document.querySelector('.header-icon').addEventListener('click', () => {
      window.__closed++;
      document.querySelector('.el-overlay').remove();
    });
  });
  await page.clock.runFor(10000);
  assert.deepEqual(await page.evaluate(() => [window.__submitted, window.__closed, window.__plays]), [0, 1, 1]);
  await page.close();
});

test('AI completed feedback without option rows can still close', async () => {
  const page = await fixture({ randomAnswer: true }, aiSubmittedHtml.replace(/<div class="option">.*?<\/div>/g, ''));
  await wireAiExercise(page, { keepFeedback: true });
  await page.clock.runFor(10000);
  assert.deepEqual(await page.evaluate(() => [window.__submitted, window.__closed, window.__plays]), [0, 1, 1]);
  await page.close();
});

test('AI disabled submit button before submission is not treated as completed', async () => {
  const page = await fixture({ randomAnswer: true }, aiQuizHtml.replace('<button class="btn">提交作答</button>', '<button class="btn" disabled>提交作答</button>'));
  await page.evaluate(() => {
    document.querySelector('.header-icon').addEventListener('click', () => window.__closed++);
  });
  await wireAiExercise(page, { keepFeedback: true });
  await page.clock.runFor(10000);
  assert.deepEqual(await page.evaluate(() => [window.__submitted, window.__closed, window.__plays]), [0, 0, 0]);
  assert.equal(await page.locator('.ai-class-exercise-dialog').count(), 1);
  await page.close();
});

test('disabled by default: no play, answer or next; start respects autoPlay=false', async () => {
  const page = await fixture({ enabled: false, autoPlay: false }, '<button class="next_lesson_btn">下一节</button>');
  await page.clock.runFor(6000);
  assert.equal(await page.evaluate(() => window.__plays), 0);
  await page.locator('[data-zhs-helper]').getByRole('button', { name: '启动助手' }).click();
  await page.clock.runFor(1000);
  assert.equal(await page.evaluate(() => window.__plays), 0);
  await page.close();
});

test('plays and resumes video; disabling the helper stops further attempts', async () => {
  const page = await fixture();
  assert.equal(await page.evaluate(() => window.__plays), 1);
  await page.evaluate(() => { window.__video.paused = true; });
  await page.clock.runFor(6000);
  assert.equal(await page.evaluate(() => window.__plays), 2, JSON.stringify(await status(page)));
  await page.evaluate(async () => { await window.__update({ enabled: false }); window.__video.paused = true; });
  await page.clock.runFor(9000);
  assert.equal(await page.evaluate(() => window.__plays), 2);
  await page.close();
});

test('reloading the extension disables stale page controls and stops automation', async () => {
  const page = await fixture({}, '<button class="next_lesson_btn">下一节</button>');
  await page.evaluate(() => {
    delete chrome.runtime.id;
    window.__video.paused = true;
    window.__video.ended = true;
  });
  await page.clock.runFor(20000);
  assert.equal(await page.evaluate(() => window.__next), 0);
  assert.equal(await page.evaluate(() => window.__plays), 1);
  const panel = page.locator('[data-zhs-helper]');
  assert.equal(await panel.getByRole('button', { name: '等待刷新' }).isDisabled(), true);
  assert.equal(await panel.getByRole('button', { name: '刷新课程页面' }).isVisible(), true);
  assert.equal(await panel.locator('input:enabled').count(), 0);
  assert.match((await status(page)).error, /刷新当前课程页面/);
  await page.close();
});

test('invalidated storage on a start click shows refresh recovery without playing', async () => {
  const page = await fixture({ enabled: false });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => {
    chrome.storage.local.get = async () => { throw new Error('Extension context invalidated.'); };
    // A stale click must detect the invalid runtime before trying playback.
    delete chrome.runtime.id;
  });
  await page.locator('[data-zhs-helper]').getByRole('button', { name: '启动助手' }).click();
  assert.equal(await page.evaluate(() => window.__plays), 0);
  assert.match((await status(page)).status, /等待刷新页面/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('storage invalidation rejection is translated into a refresh instruction', async () => {
  const page = await fixture({ enabled: false });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => {
    chrome.storage.local.get = async () => { throw new Error('Extension context invalidated.'); };
  });
  await page.locator('[data-zhs-helper]').locator('#randomAnswer').click();
  await page.waitForFunction(() => document.querySelector('[data-zhs-helper]').shadowRoot.getElementById('reload').hidden === false);
  await page.clock.runFor(6000);
  const state = await status(page);
  assert.match(state.error, /刷新当前课程页面/);
  assert.equal(state.settings.enabled, false);
  assert.deepEqual(errors, []);
  await page.close();
});

test('temporary background messaging errors do not invalidate the page controls', async () => {
  const page = await fixture();
  await page.evaluate(() => {
    chrome.runtime.sendMessage = async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); };
    window.__video.paused = true;
  });
  await page.clock.runFor(7000);
  assert.equal(await page.evaluate(() => window.__plays), 2);
  assert.equal(await page.locator('[data-zhs-helper]').getByRole('button', { name: '暂停助手' }).isEnabled(), true);
  await page.close();
});

test('only switches after ended; source replacement starts the next video', async () => {
  const page = await fixture({}, '<button class="next_lesson_btn">下一节</button>');
  await page.clock.runFor(5000);
  assert.equal(await page.evaluate(() => window.__next), 0);
  await page.evaluate(() => { window.__video.ended = true; window.__video.paused = true; });
  await page.clock.runFor(4000);
  assert.equal(await page.evaluate(() => window.__next), 1);
  await page.evaluate(() => { window.__video = { paused: true, ended: false, currentSrc: 'https://media.example/lesson-2.mp4' }; });
  await page.clock.runFor(1500);
  assert.equal(await page.evaluate(() => window.__plays), 2);
  await page.close();
});

test('never clicks disabled next or arbitrary next-page buttons; retries stop at three', async () => {
  const page = await fixture({}, '<button class="next_lesson_btn" disabled>下一节</button><button onclick="window.__next++">下一页</button>');
  await page.evaluate(() => { window.__video.ended = true; });
  await page.clock.runFor(4000);
  assert.equal(await page.evaluate(() => window.__next), 0);
  await page.evaluate(() => { document.querySelector('.next_lesson_btn').disabled = false; });
  await page.clock.runFor(40000);
  assert.equal(await page.evaluate(() => window.__next), 3);
  assert.match((await status(page)).status, /停止重试/);
  await page.close();
});

test('quiz with random answering off waits for manual input without resuming', async () => {
  const page = await fixture({ randomAnswer: false }, quizHtml);
  await page.clock.runFor(12000);
  assert.equal(await page.locator('.el-dialog input:checked').count(), 0);
  assert.equal(await page.evaluate(() => window.__plays), 0);
  assert.match((await status(page)).status, /等待你作答/);
  await page.close();
});

test('random quiz selects once, submits once, closes feedback with removed options, and resumes', async () => {
  const page = await fixture({ randomAnswer: true }, quizHtml);
  await page.evaluate(() => {
    document.querySelector('.answer-submit').addEventListener('click', event => {
      window.__submitted++;
      document.querySelector('.choices').remove();
      event.target.hidden = true;
      document.querySelector('.continue-button').hidden = false;
    });
    document.querySelector('.continue-button').addEventListener('click', () => {
      window.__closed++;
      document.querySelector('.el-dialog').remove();
    });
  });
  await page.clock.runFor(12000);
  assert.deepEqual(await page.evaluate(() => [window.__submitted, window.__closed, window.__plays]), [1, 1, 1]);
  await page.close();
});

test('existing selected answer is preserved', async () => {
  const page = await fixture({ randomAnswer: true }, quizHtml.replace('value="b"', 'value="b" checked'));
  await page.clock.runFor(6000);
  assert.equal(await page.locator('input[value="b"]').isChecked(), true);
  assert.equal(await page.locator('.el-dialog input:checked').count(), 1);
  await page.close();
});

test('two consecutive quizzes also click the second quiz confirmation after submission', async () => {
  const page = await fixture({ randomAnswer: true }, quizHtml);
  await page.evaluate(() => {
    const attach = (dialog, second) => {
      dialog.querySelector('.answer-submit').addEventListener('click', event => {
        window.__submitted++;
        dialog.querySelector('.choices').remove();
        event.target.hidden = true;
        const confirm = dialog.querySelector('.continue-button');
        confirm.textContent = second ? '确 定' : '继续学习';
        confirm.hidden = false;
      });
      dialog.querySelector('.continue-button').addEventListener('click', () => {
        window.__closed++;
        if (!second) {
          const next = dialog.cloneNode(true);
          next.querySelector('.question-title').textContent = '第二道随堂选择题';
          next.querySelector('.answer-submit').hidden = false;
          next.querySelector('.continue-button').hidden = true;
          const choices = document.createElement('div');
          choices.className = 'choices';
          choices.innerHTML = '<label><input type="radio" name="second" value="a">A. 第二题选项一</label><label><input type="radio" name="second" value="b">B. 第二题选项二</label>';
          next.querySelector('.answer-submit').before(choices);
          dialog.replaceWith(next);
          attach(next, true);
        } else dialog.remove();
      });
    };
    attach(document.querySelector('.el-dialog'), false);
  });
  await page.clock.runFor(18000);
  assert.deepEqual(await page.evaluate(() => [window.__submitted, window.__closed, window.__plays]), [2, 2, 1]);
  await page.close();
});

test('stacked quizzes are handled from front to back without losing each dialog state', async () => {
  const second = quizHtml.replace('name="quiz"', 'name="second"').replace('name="quiz"', 'name="second"');
  const page = await fixture({ randomAnswer: true }, `<div style="position:relative;z-index:2000" id="front">${second}</div><div style="position:relative;z-index:1000" id="back">${quizHtml}</div>`);
  await page.evaluate(() => {
    window.__order = [];
    for (const dialog of document.querySelectorAll('.el-dialog')) {
      dialog.querySelector('.answer-submit').addEventListener('click', event => {
        window.__order.push(dialog.parentElement.id);
        dialog.querySelector('.choices').remove();
        event.target.hidden = true;
        const confirm = dialog.querySelector('.continue-button');
        confirm.textContent = '确定';
        confirm.hidden = false;
      });
      dialog.querySelector('.continue-button').addEventListener('click', () => dialog.parentElement.remove());
    }
  });
  await page.clock.runFor(18000);
  assert.deepEqual(await page.evaluate(() => window.__order), ['front', 'back']);
  assert.equal(await page.locator('.el-dialog').count(), 0);
  assert.equal(await page.evaluate(() => window.__plays), 1);
  await page.close();
});

test('separate answer confirmation is clicked before returning to the underlying question', async () => {
  const page = await fixture({ randomAnswer: true }, quizHtml);
  await page.evaluate(() => {
    document.querySelector('.answer-submit').addEventListener('click', () => {
      window.__submitted++;
      const confirm = document.createElement('div');
      confirm.className = 'el-message-box';
      confirm.style.cssText = 'position:fixed;z-index:4000;left:80px;top:50px;background:white;padding:40px';
      confirm.innerHTML = '<p>答案已提交</p><div class="el-message-box__btns"><button>确 定</button></div>';
      confirm.querySelector('button').addEventListener('click', () => {
        window.__closed++;
        confirm.remove();
        document.querySelector('.el-dialog').remove();
      });
      document.body.append(confirm);
    });
  });
  await page.clock.runFor(12000);
  assert.deepEqual(await page.evaluate(() => [window.__submitted, window.__closed, window.__plays]), [1, 1, 1]);
  await page.close();
});

test('second quiz submits using a footer span labelled 确定 after selecting an option', async () => {
  const second = '<div class="el-dialog" role="dialog" id="second" hidden><h3 class="question-title">第二道随堂选择题</h3><label><input type="radio" name="second">A. 选项一</label><label><input type="radio" name="second">B. 选项二</label><div class="el-dialog__footer"><span class="final-confirm">确 定</span></div></div>';
  const page = await fixture({ randomAnswer: true }, quizHtml + second);
  await page.evaluate(() => {
    const first = document.querySelector('.el-dialog');
    first.querySelector('.answer-submit').addEventListener('click', () => {
      window.__submitted++;
      first.remove();
      document.querySelector('#second').hidden = false;
    });
    document.querySelector('.final-confirm').addEventListener('click', () => {
      if (document.querySelector('#second input:checked')) {
        window.__submitted++;
        document.querySelector('#second').remove();
      }
    });
  });
  await page.clock.runFor(12000);
  assert.deepEqual(await page.evaluate(() => [window.__submitted, window.__plays]), [2, 1]);
  assert.equal(await page.locator('.el-dialog').count(), 0);
  await page.close();
});

test('new question in a reused modal gets a fresh answer', async () => {
  const page = await fixture({ randomAnswer: true }, quizHtml);
  await page.evaluate(() => {
    document.querySelector('.answer-submit').addEventListener('click', () => {
      window.__submitted++;
      if (window.__submitted === 1) {
        document.querySelector('.question-title').textContent = '随堂单选：第二道题';
        document.querySelectorAll('input').forEach(input => { input.checked = false; });
      } else document.querySelector('.el-dialog').remove();
    });
  });
  await page.clock.runFor(10000);
  assert.equal(await page.evaluate(() => window.__submitted), 2);
  await page.close();
});

test('non-question modal is left for manual handling', async () => {
  const page = await fixture({ randomAnswer: true }, '<div role="dialog"><p>请进行身份验证</p><button onclick="window.__submitted++">确定</button></div>');
  await page.clock.runFor(6000);
  assert.deepEqual(await page.evaluate(() => [window.__submitted, window.__plays]), [0, 0]);
  assert.match((await status(page)).status, /其他弹窗/);
  await page.close();
});

test('autoplay rejection produces actionable status without repeated play attempts', async () => {
  const page = await fixture({ enabled: false });
  await page.evaluate(async () => { window.__blockPlay = true; await window.__update({ enabled: true }); });
  await page.clock.runFor(15000);
  assert.equal(await page.evaluate(() => window.__plays), 1);
  assert.match((await status(page)).status, /手动点一次/);
  await page.evaluate(() => { window.__blockPlay = false; window.__video.paused = false; });
  await page.clock.runFor(1500);
  assert.equal((await status(page)).status, '视频播放中');
  await page.close();
});

test('custom selectors supported; malformed selectors reported', async () => {
  const page = await fixture({ selectors: { next: '#custom-next' } }, '<button id="custom-next" onclick="window.__next++">后续课程</button>');
  await page.evaluate(() => { window.__video.ended = true; });
  await page.clock.runFor(4000);
  assert.equal(await page.evaluate(() => window.__next), 1);
  await page.evaluate(() => window.__update({ selectors: { video: '[' } }));
  await page.clock.runFor(1000);
  assert.match((await status(page)).error, /选择器无效/);
  await page.close();
});

test('course catalogue fallback advances a video row, skipping chapter test rows', async () => {
  const page = await fixture({}, '<div class="video-study"><div class="box-right"><ul class="list"><li class="video current_play"><span class="catalogue_title">第一节</span></li><li class="chapter-test"><span>章节测验</span></li><li class="video" onclick="window.__next++"><span class="catalogue_title">第二节</span></li></ul></div></div>');
  await page.evaluate(() => { window.__video.ended = true; });
  await page.clock.runFor(4000);
  assert.equal(await page.evaluate(() => window.__next), 1);
  await page.close();
});

const moocCatalogue = '<aside class="course-catalog"><div class="catalog-com"><div class="el-collapse-item"><div class="el-collapse-item__header" aria-expanded="true">第五章</div><div class="chapter-content"><div class="chapter-item"><div class="item-box"><img class="finish-icon"><div class="item-num">5.2</div><div class="item-name">代数稳定性判据</div></div></div><div class="chapter-item current"><div class="item-box"><img class="finish-icon"><div class="item-num">5.3</div><div class="item-name">乃奎斯特稳定性判据</div></div></div><div class="chapter-item" id="lesson-54"><div class="item-box"><div class="item-num">5.4</div><div class="item-name">伯德稳定性判据</div></div></div><div class="chapter-item" id="lesson-55"><div class="item-box"><div class="item-num">5.5</div><div class="item-name">控制系统的相对稳定性</div></div></div><div class="test-box">章节测验</div></div></div></div></aside>';

const smartPersonalCatalogue = '<aside class="section-item knowledge-list"><div class="catalog-tabs"><div class="catalog-tabs__item is-active">个性化学习</div></div><div class="catalog-card"><div class="list-container"><div class="list-item is-selected" data-node-uid="1889941809455566801"><div class="item-content"><span class="chapter-title">当前知识点</span></div><div class="item-meta">资源 1/2</div></div><div class="list-item" data-node-uid="1889941809455566802" id="next-point"><div class="item-content"><span class="chapter-title">下一个知识点</span></div></div></div></div><div class="recommend-card"><div class="recommend-card__item" id="suggestion">推荐的其他知识点</div></div></aside>';
const smartVideoCards = '<main id="middle-section-id"><div class="resources-list"><div class="resources-item"><div class="basic-info-video-card-container active" id="resource-one"><div class="video-wrap"><div class="icon-box video"></div></div><h5 class="video-title">视频一</h5></div></div><div class="resources-item"><div class="basic-info-video-card-container" id="resource-pdf"><div class="video-wrap"><div class="icon-box pdf"></div></div><h5 class="video-title">参考讲义</h5></div></div><div class="resources-item"><div class="basic-info-video-card-container" id="resource-two"><div class="video-wrap"><div class="icon-box video"></div></div><h5 class="video-title">视频二</h5></div></div></div></main>';

test('smart-course personal catalogue clicks the next data-node-uid row', async () => {
  const page = await fixture({}, smartPersonalCatalogue);
  await page.evaluate(() => {
    document.querySelector('#next-point').addEventListener('click', () => window.__next++);
    window.__video.ended = true;
  });
  await page.clock.runFor(4000);
  assert.equal(await page.evaluate(() => window.__next), 1);
  assert.match((await status(page)).logs[0].message, /下一个知识点/);
  await page.close();
});

test('smart-course plays the next video resource before advancing the knowledge point', async () => {
  const page = await fixture({}, smartPersonalCatalogue + smartVideoCards);
  await page.evaluate(() => {
    window.__wrong = 0;
    document.querySelector('#resource-two').addEventListener('click', () => window.__next++);
    document.querySelector('#resource-pdf').addEventListener('click', () => window.__wrong++);
    document.querySelector('#next-point').addEventListener('click', () => window.__wrong++);
    window.__video.ended = true;
  });
  await page.clock.runFor(4000);
  assert.deepEqual(await page.evaluate(() => [window.__next, window.__wrong]), [1, 0]);
  assert.match((await status(page)).logs[0].message, /视频二/);
  await page.close();
});

test('smart-course last video resource advances to the next knowledge point', async () => {
  const html = smartVideoCards.replace('container active', 'container').replace('container" id="resource-two"', 'container active" id="resource-two"');
  const page = await fixture({}, smartPersonalCatalogue + html);
  await page.evaluate(() => {
    document.querySelector('#next-point').addEventListener('click', () => window.__next++);
    window.__video.ended = true;
  });
  await page.clock.runFor(4000);
  assert.equal(await page.evaluate(() => window.__next), 1);
  assert.match((await status(page)).logs[0].message, /下一个知识点/);
  await page.close();
});

test('smart-course missing active video does not skip directly to another knowledge point', async () => {
  const page = await fixture({}, smartPersonalCatalogue + smartVideoCards.replace('container active', 'container'));
  await page.evaluate(() => {
    document.querySelector('#next-point').addEventListener('click', () => window.__next++);
    window.__video.ended = true;
  });
  await page.clock.runFor(6000);
  assert.equal(await page.evaluate(() => window.__next), 0);
  assert.match((await status(page)).status, /当前视频资源/);
  await page.close();
});

test('smart-course chapter catalogue expands the next knowledge unit and then selects it', async () => {
  const html = '<aside class="section-item knowledge-list"><div class="section-item-collapse"><div class="el-collapse-item is-active"><div class="el-collapse-item__header" aria-expanded="true">知识单元一</div><div class="section-item-collapse-info active"><div class="section-item-collapse-title">当前知识点</div></div></div><div class="el-collapse-item"><div role="tab"><div class="el-collapse-item__header" aria-expanded="false" id="expand-unit">知识单元二</div></div><div class="el-collapse-item__wrap" hidden><div class="section-item-collapse-info" id="next-point"><div class="section-item-collapse-title">下一单元知识点</div></div></div></div></div></aside>';
  const page = await fixture({}, html);
  await page.evaluate(() => {
    document.querySelector('#expand-unit').addEventListener('click', event => {
      event.currentTarget.setAttribute('aria-expanded', 'true');
      event.currentTarget.closest('.el-collapse-item').classList.add('is-active');
      document.querySelector('.el-collapse-item__wrap').hidden = false;
    });
    document.querySelector('#next-point').addEventListener('click', () => window.__next++);
    window.__video.ended = true;
  });
  await page.clock.runFor(7000);
  assert.equal(await page.evaluate(() => window.__next), 1);
  await page.close();
});

test('smart-course disabled next resource is not skipped to the next knowledge point', async () => {
  const page = await fixture({}, smartPersonalCatalogue + smartVideoCards.replace('id="resource-two"', 'id="resource-two" aria-disabled="true"'));
  await page.evaluate(() => {
    document.querySelector('#next-point').addEventListener('click', () => window.__next++);
    window.__video.ended = true;
  });
  await page.clock.runFor(6000);
  assert.equal(await page.evaluate(() => window.__next), 0);
  assert.match((await status(page)).status, /下一视频资源.*不可点击/);
  await page.close();
});

test('smart-course end of personal directory does not choose an unrelated recommendation', async () => {
  const html = smartPersonalCatalogue.replace('list-item is-selected', 'list-item').replace('class="list-item" data-node-uid="1889941809455566802"', 'class="list-item is-selected" data-node-uid="1889941809455566802"');
  const page = await fixture({}, html);
  await page.evaluate(() => {
    document.querySelector('#suggestion').addEventListener('click', () => window.__next++);
    window.__video.ended = true;
  });
  await page.clock.runFor(5000);
  assert.equal(await page.evaluate(() => window.__next), 0);
  assert.match((await status(page)).status, /个性化目录/);
  await page.close();
});

test('smart-course catalogue takes priority over a global carousel next button', async () => {
  const page = await fixture({}, '<button class="next-btn" id="carousel">下一张图片</button>' + smartPersonalCatalogue);
  await page.evaluate(() => {
    window.__wrong = 0;
    document.querySelector('#carousel').addEventListener('click', () => window.__wrong++);
    document.querySelector('#next-point').addEventListener('click', () => window.__next++);
    window.__video.ended = true;
  });
  await page.clock.runFor(4000);
  assert.deepEqual(await page.evaluate(() => [window.__next, window.__wrong]), [1, 0]);
  await page.close();
});

test('wisdom-mooc catalogue advances 5.3 to 5.4 using the real current chapter-item markup', async () => {
  const page = await fixture({}, moocCatalogue);
  await page.evaluate(() => {
    document.querySelector('#lesson-54 .item-box').addEventListener('click', () => window.__next++);
    window.__video.ended = true;
  });
  await page.clock.runFor(4000);
  assert.equal(await page.evaluate(() => window.__next), 1);
  assert.match((await status(page)).logs[0].message, /5\.4.*伯德/);
  await page.close();
});

test('wisdom-mooc 5.4 to 5.5 does not trigger its untrusted PointerEvent homepage redirect', async () => {
  const html = moocCatalogue.replace('chapter-item current', 'chapter-item').replace('class="chapter-item" id="lesson-54"', 'class="chapter-item current" id="lesson-54"');
  const page = await fixture({}, html);
  await page.evaluate(() => {
    window.__homepage = false;
    window.__rejectedClicks = 0;
    window.__receivedClick = null;
    document.querySelector('#lesson-55').addEventListener('click', event => {
      window.__receivedClick = { type: event.type, pointer: event instanceof PointerEvent, trusted: event.isTrusted };
      // This is the published course component's event check and redirect delay.
      if (event instanceof PointerEvent && event.isTrusted === false) {
        window.__rejectedClicks++;
        setTimeout(() => {
          window.__homepage = true;
          document.querySelector('video').remove();
          document.querySelector('.catalog-com').remove();
        }, 3000);
        return;
      }
      window.__next++;
      document.querySelector('.chapter-item.current').classList.remove('current');
      document.querySelector('#lesson-55').classList.add('current');
      window.__video = { paused: true, ended: false, currentSrc: 'https://media.example/lesson-55.mp4' };
    });
    window.__video.ended = true;
  });
  await page.clock.runFor(10000);
  assert.deepEqual(await page.evaluate(() => [window.__next, window.__rejectedClicks, window.__homepage]), [1, 0, false]);
  assert.deepEqual(await page.evaluate(() => window.__receivedClick), { type: 'click', pointer: false, trusted: false });
  assert.match((await status(page)).logs.find(item => /5\.5/.test(item.message)).message, /5\.5.*相对稳定性/);
  await page.close();
});

test('wisdom-mooc prioritizes its actual catalogue over unrelated global next buttons', async () => {
  const page = await fixture({}, '<a class="next-btn" href="#home" id="unrelated-next">首页轮播</a>' + moocCatalogue);
  await page.evaluate(() => {
    window.__wrong = 0;
    document.querySelector('#unrelated-next').addEventListener('click', event => { event.preventDefault(); window.__wrong++; });
    document.querySelector('#lesson-54 .item-box').addEventListener('click', () => window.__next++);
    window.__video.ended = true;
  });
  await page.clock.runFor(4000);
  assert.deepEqual(await page.evaluate(() => [window.__next, window.__wrong]), [1, 0]);
  await page.close();
});

test('wisdom-mooc keeps retrying the same target when the highlight changes but playback fails', async () => {
  const page = await fixture({}, moocCatalogue);
  await page.evaluate(() => {
    window.__skipped = 0;
    document.querySelector('#lesson-54 .item-box').addEventListener('click', () => {
      window.__next++;
      document.querySelector('.chapter-item.current').classList.remove('current');
      document.querySelector('#lesson-54').classList.add('current');
    });
    document.querySelector('#lesson-55').addEventListener('click', () => window.__skipped++);
    window.__video.ended = true;
  });
  await page.clock.runFor(32000);
  assert.deepEqual(await page.evaluate(() => [window.__next, window.__skipped]), [3, 0]);
  await page.close();
});

test('wisdom-mooc opens a collapsed next chapter before clicking its first lesson', async () => {
  const html = '<div class="course-catalog"><div class="catalog-com"><div class="el-collapse-item"><div class="el-collapse-item__header" aria-expanded="true">第五章</div><div class="chapter-content"><div class="chapter-item current"><div class="item-box"><div class="item-num">5.5</div><div class="item-name">最后一小节</div></div></div><div class="test-box">章节测验</div></div></div><div class="el-collapse-item"><div class="el-collapse-item__header" aria-expanded="false" id="open-next">第六章</div><div class="chapter-content" hidden id="new-chapter"></div></div></div></div>';
  const page = await fixture({}, html);
  await page.evaluate(() => {
    document.querySelector('#open-next').addEventListener('click', event => {
      event.currentTarget.setAttribute('aria-expanded', 'true');
      const chapter = document.querySelector('#new-chapter');
      chapter.hidden = false;
      chapter.innerHTML = '<div class="chapter-item"><div class="item-box"><div class="item-num">6.1</div><div class="item-name">第六章第一节</div></div></div>';
      chapter.querySelector('.item-box').addEventListener('click', () => window.__next++);
    });
    window.__video.ended = true;
  });
  await page.clock.runFor(7000);
  assert.equal(await page.evaluate(() => window.__next), 1);
  assert.equal(await page.locator('#open-next').getAttribute('aria-expanded'), 'true');
  await page.close();
});

test('wisdom-mooc does not describe an unmatched catalogue as the end of the course', async () => {
  const page = await fixture({}, moocCatalogue.replace('chapter-item current', 'chapter-item'));
  await page.evaluate(() => { window.__video.ended = true; });
  await page.clock.runFor(4000);
  const state = await status(page);
  assert.match(state.status, /当前课程/);
  assert.doesNotMatch(state.status, /最后一节/);
  await page.close();
});

test('wisdom-mooc sublesson selection advances to the following sublesson title', async () => {
  const html = '<div class="catalog-com"><div class="chapter-content"><div class="chapter-item"><div class="item-box"><div class="item-num">5.3</div><div class="item-name">父级目录</div></div><div class="chapter-content-second current"><div class="item-num">5.3.1</div><div class="item-name">当前小节</div></div><div class="chapter-content-second" id="next-small"><div class="item-num">5.3.2</div><div class="item-name">下一小节</div></div></div><div class="chapter-item" id="not-yet"><div class="item-box"><div class="item-num">5.4</div><div class="item-name">后续课程</div></div></div></div></div>';
  const page = await fixture({}, html);
  await page.evaluate(() => {
    window.__wrong = 0;
    document.querySelector('#next-small').addEventListener('click', () => window.__next++);
    document.querySelector('#not-yet').addEventListener('click', () => window.__wrong++);
    window.__video.ended = true;
  });
  await page.clock.runFor(4000);
  assert.deepEqual(await page.evaluate(() => [window.__next, window.__wrong]), [1, 0]);
  assert.match((await status(page)).logs[0].message, /5\.3\.2/);
  await page.close();
});

test('wisdom-mooc expands a collapsed chapter whose lesson rows already exist', async () => {
  const html = '<div class="catalog-com"><div class="el-collapse-item"><div class="el-collapse-item__header" aria-expanded="true">第五章</div><div class="chapter-item current"><div class="item-box"><div class="item-num">5.5</div><div class="item-name">当前小节</div></div></div></div><div class="el-collapse-item"><div class="el-collapse-item__header" aria-expanded="false" id="open-next">第六章</div><div class="chapter-content" hidden id="hidden-rows"><div class="chapter-item"><div class="item-box" id="next-loaded"><div class="item-num">6.1</div><div class="item-name">下一章视频</div></div></div></div></div></div>';
  const page = await fixture({}, html);
  await page.evaluate(() => {
    document.querySelector('#open-next').addEventListener('click', event => {
      event.currentTarget.setAttribute('aria-expanded', 'true');
      document.querySelector('#hidden-rows').hidden = false;
    });
    document.querySelector('#next-loaded').addEventListener('click', () => window.__next++);
    window.__video.ended = true;
  });
  await page.clock.runFor(7000);
  assert.equal(await page.evaluate(() => window.__next), 1);
  await page.close();
});

test('wisdom-mooc disabled lesson is reported without skipping to a later lesson', async () => {
  const page = await fixture({}, moocCatalogue.replace('id="lesson-54"', 'id="lesson-54" aria-disabled="true"'));
  await page.evaluate(() => {
    document.querySelector('#lesson-54').addEventListener('click', () => window.__next++);
    document.querySelector('#lesson-55').addEventListener('click', () => window.__next++);
    window.__video.ended = true;
  });
  await page.clock.runFor(10000);
  assert.equal(await page.evaluate(() => window.__next), 0);
  assert.match((await status(page)).status, /课程行暂不可点击/);
  await page.close();
});

test('topic-item custom controls confirm their selected child before submitting', async () => {
  const page = await fixture({ randomAnswer: true }, '<div role="dialog"><h3 class="topic-title">随堂选择题</h3><div class="topic-item" onclick="this.firstElementChild.classList.add(\'active\')"><i class="topic-option-item"></i>A. 选项一</div><div class="topic-item" onclick="this.firstElementChild.classList.add(\'active\')"><i class="topic-option-item"></i>B. 选项二</div><button onclick="window.__submitted++">提交</button></div>');
  await page.clock.runFor(6000);
  assert.equal(await page.evaluate(() => window.__submitted), 1);
  assert.equal(await page.locator('.topic-option-item.active').count(), 1);
  await page.close();
});

test('unconfirmed custom option does not cause submission', async () => {
  const page = await fixture({ randomAnswer: true, selectors: { option: '.fake-option' } }, '<div role="dialog"><h3>随堂单选</h3><div class="fake-option">A. 不响应点击</div><button onclick="window.__submitted++">提交</button></div>');
  await page.clock.runFor(10000);
  assert.equal(await page.evaluate(() => window.__submitted), 0);
  assert.match((await status(page)).status, /无法确认选项/);
  await page.close();
});

test('popup validates selectors and persists settings', async () => {
  const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://helper.test/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'popup.html';
    const file = path.join(root, 'extension', name);
    route.fulfill({ body: fs.readFileSync(file), contentType: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await page.addInitScript(() => {
    window.__saved = {};
    window.chrome = {
      storage: { local: { get: async () => window.__saved, set: async value => { window.__saved = value; } } },
      tabs: { query: async () => [{ id: 1 }] },
      runtime: { sendMessage: async () => ({ frames: [{ frame: '主页面', settings: { enabled: true }, status: '视频播放中', logs: [] }] }) }
    };
  });
  await page.goto('http://helper.test/popup.html');
  await page.locator('#status').filter({ hasText: '视频播放中' }).waitFor();
  await page.locator('summary').first().click();
  await page.locator('#video').fill('[');
  await page.getByRole('button', { name: '保存设置' }).click();
  assert.match(await page.locator('#error').textContent(), /选择器无效/);
  await page.locator('#video').fill('video');
  await page.locator('#enabled').check();
  await page.locator('#randomAnswer').check();
  await page.getByRole('button', { name: '保存设置' }).click();
  assert.equal(await page.evaluate(() => window.__saved.zhsHelperSettings.randomAnswer), true);
  assert.deepEqual(errors, []);
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results/popup.png'), fullPage: true });
  await page.close();
});

test('background aggregates frame reports and delegates next button to parent', async () => {
  const vm = require('node:vm');
  let handler;
  let removed;
  let target;
  const sandbox = { Map, Date, Number, chrome: {
    tabs: { onRemoved: { addListener: callback => { removed = callback; } }, sendMessage: async (...args) => { target = args; return { clicked: true }; } },
    runtime: { onMessage: { addListener: callback => { handler = callback; } } }
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'extension/background.js'), 'utf8'), sandbox);
  let response;
  const respond = value => { response = value; };
  handler({ type: 'zhs:report', snapshot: { hasVideo: false, blockingDialog: true } }, { tab: { id: 4 }, frameId: 0 }, respond);
  handler({ type: 'zhs:report', snapshot: { hasVideo: true } }, { tab: { id: 4 }, frameId: 2 }, respond);
  assert.equal(response.parentBlocked, true);
  handler({ type: 'zhs:collect', tabId: 4 }, {}, respond);
  assert.equal(response.frames[0].frameId, 2);
  assert.equal(handler({ type: 'zhs:next-in-parent' }, { tab: { id: 4 }, frameId: 2 }, respond), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(target[2].frameId, 0);
  assert.equal(response.clicked, true);
  removed(4);
  handler({ type: 'zhs:collect', tabId: 4 }, {}, respond);
  assert.equal(response.frames.length, 0);
});
