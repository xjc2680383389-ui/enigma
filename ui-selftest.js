/* 零依赖界面脚本回归测试：node --test ui-selftest.js
   使用最小 DOM 运行真实 UI 脚本，验证状态/事件；不替代浏览器排版和原生事件验收。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('./enigma-core.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, 'enigma-ui.js'), 'utf8');

class Element {
  constructor(tag = 'DIV') {
    this.tagName = tag.toUpperCase(); this.value = ''; this.textContent = '';
    this.children = []; this.events = {}; this.attributes = {}; this.style = {};
    this.disabled = false; this.isContentEditable = false;
    const classes = new Set();
    this.classList = { add: (x) => classes.add(x), remove: (x) => classes.delete(x), contains: (x) => classes.has(x) };
  }
  appendChild(el) { this.children.push(el); }
  removeChild(el) { this.children.splice(this.children.indexOf(el), 1); }
  addEventListener(event, fn) { (this.events[event] ||= []).push(fn); }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector(selector) { assert.equal(selector, '.win'); return this.win; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  emit(event, details = {}) {
    return Promise.all((this.events[event] || []).map((fn) => fn({ target: this, preventDefault() {}, ...details })));
  }
}

function fixture({ clipboard, copyResult = true, core = Core } = {}) {
  const ids = {};
  // 直接读取页面的初始控件值，避免测试夹具与 HTML 默认值各自变化。
  for (const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const el = new Element(match[1]);
    el.value = (match[2].match(/\bvalue="([^"]*)"/) || [])[1] || '';
    el.disabled = /\bdisabled\b/.test(match[2]);
    ids[match[3]] = el;
  }
  for (const match of html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const options = [...match[2].matchAll(/<option([^>]*)>([^<]*)<\/option>/g)];
    ids[match[1]].value = (options.find((x) => /selected/.test(x[1])) || options[0])[2];
  }
  const rotors = Array.from({ length: 3 }, () => { const el = new Element('BUTTON'); el.win = new Element('SPAN'); return el; });
  const window = new Element(); window.EnigmaCore = core;
  const timers = new Map(); let timerId = 0; const copies = [];
  const document = {
    body: new Element('BODY'), activeElement: ids.copyBtn,
    getElementById: (id) => { assert.ok(ids[id], 'HTML contains #' + id); return ids[id]; },
    createElement: (tag) => new Element(tag),
    querySelectorAll: (selector) => { assert.equal(selector, '.rotor'); return rotors; },
    execCommand: (command) => { assert.equal(command, 'copy'); copies.push(document.body.children.at(-1).value); return copyResult; },
  };
  vm.runInNewContext(script, {
    window, document, navigator: { clipboard },
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  }, { filename: 'enigma-ui.js' });
  const key = (ch) => ids.keyboard.children.flatMap((row) => row.children).find((el) => el.textContent === ch);
  const edit = (id, value) => { ids[id].value = value; return ids[id].emit('input'); };
  const type = (ch, details = {}) => window.emit('keydown', { target: document.body, key: ch, ...details });
  return { ids, rotors, key, edit, type, copies, document, timers };
}

test('default onscreen input matches BDZGO and advances one step per click', async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) await f.key('A').emit('click', { button: 0 });
  assert.equal(f.ids.tapeOut.textContent, 'BDZGO');
  assert.equal(f.rotors.map((r) => r.win.textContent).join(''), 'AAF');
});

test('draft reflector, rotor and ring edits cannot alter applied labels or cipher', async () => {
  const f = fixture();
  await f.edit('ukw', 'C'); await f.edit('rotL', 'V'); await f.edit('ringL', 'B');
  await f.key('A').emit('click');
  assert.equal(f.ids.ukwTag.textContent, 'UKW-B');
  assert.equal(f.ids.rotorNameL.textContent, 'I');
  assert.equal(f.ids.ringLblL.textContent, 'A');
  assert.equal(f.ids.tapeOut.textContent, 'B');
  assert.match(f.ids.cfgStatus.textContent, /尚未应用/);
});

test('batch uses applied key even with invalid pending draft and leaves key state intact', async () => {
  const f = fixture(); await f.type('A'); await f.edit('rotL', 'II');
  await f.edit('batchIn', 'AAAAA'); await f.ids.runBtn.emit('click');
  assert.equal(f.ids.batchOut.textContent, 'BDZGO');
  assert.equal(f.ids.tapeOut.textContent, 'B');
  assert.equal(f.rotors[2].win.textContent, 'B');
});

test('successful application changes both modes and clears old results and lamps', async () => {
  const f = fixture(); await f.type('A');
  await f.edit('batchIn', 'A'); await f.ids.runBtn.emit('click');
  await f.edit('ukw', 'C'); await f.ids.applyBtn.emit('click');
  assert.equal(f.ids.batchOut.textContent, '—'); assert.equal(f.ids.copyBtn.disabled, true);
  assert.equal(f.ids.tapeOut.textContent, '—');
  assert.ok(f.ids.lampboard.children.flatMap((row) => row.children).every((lamp) => !lamp.classList.contains('lit')));
  await f.type('A'); await f.ids.runBtn.emit('click');
  assert.equal(f.ids.ukwTag.textContent, 'UKW-C');
  assert.equal(f.ids.tapeOut.textContent, 'P'); assert.equal(f.ids.batchOut.textContent, 'P');
});

test('failed application preserves old machine but removes stale batch output', async () => {
  const f = fixture(); await f.type('A');
  await f.edit('batchIn', 'AAAAA'); await f.ids.runBtn.emit('click');
  await f.edit('rotL', 'II'); await f.ids.applyBtn.emit('click');
  assert.match(f.ids.cfgErr.textContent, /不能重复/);
  assert.equal(f.ids.batchOut.textContent, '—'); assert.equal(f.ids.copyBtn.disabled, true);
  await f.type('A'); assert.equal(f.ids.tapeOut.textContent, 'BD');
  assert.equal(f.ids.rotorNameL.textContent, 'I');
});

test('input edits and clear invalidate batch output and disable copying', async () => {
  const f = fixture(); await f.edit('batchIn', 'AAAAA'); await f.ids.runBtn.emit('click');
  assert.equal(f.ids.copyBtn.disabled, false);
  await f.edit('batchIn', 'HELLO'); assert.equal(f.ids.batchOut.textContent, '—');
  assert.equal(f.ids.copyBtn.disabled, true);
  await f.ids.runBtn.emit('click'); await f.ids.clearBtn.emit('click');
  assert.equal(f.ids.batchIn.value, ''); assert.equal(f.ids.batchOut.textContent, '—');
  assert.equal(f.ids.copyBtn.disabled, true);
});

test('batch round-trip restarts from applied home and empty text cannot be copied', async () => {
  const f = fixture(); await f.edit('batchIn', 'Hello, world!'); await f.ids.runBtn.emit('click');
  const cipher = f.ids.batchOut.textContent;
  await f.edit('batchIn', cipher); await f.ids.runBtn.emit('click');
  assert.equal(f.ids.batchOut.textContent, 'HELLO WORLD');
  await f.edit('batchIn', '123 中文'); await f.ids.runBtn.emit('click');
  assert.equal(f.ids.batchOut.textContent, '—'); assert.equal(f.ids.copyBtn.disabled, true);
});

test('batch processing failure clears previous output', async () => {
  let broken = false;
  class Machine extends Core.Enigma { encryptText(text) { if (broken) throw new Error('test processing failure'); return super.encryptText(text); } }
  const f = fixture({ core: { ...Core, Enigma: Machine } });
  await f.edit('batchIn', 'AAAAA'); await f.ids.runBtn.emit('click'); broken = true;
  await f.ids.runBtn.emit('click');
  assert.equal(f.ids.batchOut.textContent, '—'); assert.equal(f.ids.copyBtn.disabled, true);
  assert.match(f.ids.batchStatus.textContent, /test processing failure/);
});

test('non-primary mouse actions do not encrypt; native button click does', async () => {
  const f = fixture(); await f.key('A').emit('mousedown', { button: 2 });
  await f.key('A').emit('click', { button: 2 });
  assert.equal(f.ids.tapeOut.textContent, '—');
  await f.type('Enter', { target: f.key('A') });
  await f.key('A').emit('click', { detail: 0, button: 0 });
  assert.equal(f.ids.tapeOut.textContent, 'B');
});

test('physical keyboard ignores editing, composition, shortcuts and key repeat', async () => {
  const f = fixture();
  for (const details of [{ target: f.ids.batchIn }, { target: f.ids.ringL }, { repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { target: { tagName: 'DIV', isContentEditable: true } }]) await f.type('a', details);
  assert.equal(f.ids.tapeOut.textContent, '—');
  let prevented = false; await f.type('a', { preventDefault() { prevented = true; } });
  assert.equal(f.ids.tapeOut.textContent, 'B'); assert.equal(prevented, true);
});

test('manual nudge changes only live machine; batch still starts at configured home', async () => {
  const f = fixture(); await f.rotors[2].emit('click');
  assert.equal(f.rotors[2].win.textContent, 'B');
  await f.edit('batchIn', 'A'); await f.ids.runBtn.emit('click');
  assert.equal(f.ids.batchOut.textContent, 'B');
  await f.type('A'); assert.equal(f.ids.tapeOut.textContent, 'D');
});

test('lowercase configuration is normalized on application', async () => {
  const f = fixture(); await f.edit('ringL', 'b'); await f.edit('posL', 'z'); await f.edit('plugInput', 'ab, cd');
  await f.ids.applyBtn.emit('click');
  assert.equal(f.ids.ringL.value, 'B'); assert.equal(f.ids.posL.value, 'Z');
  assert.equal(f.ids.plugInput.value, 'AB CD'); assert.equal(f.ids.ringLblL.textContent, 'B');
  assert.doesNotMatch(f.ids.cfgStatus.textContent, /尚未应用/);
});

test('keyboard and lampboard use historical rows and cover all 26 letters', () => {
  const f = fixture();
  for (const id of ['keyboard', 'lampboard']) {
    const rows = f.ids[id].children.map((row) => row.children.map((el) => el.textContent).join(''));
    assert.deepEqual(rows, ['QWERTZUIO', 'ASDFGHJK', 'PYXCVBNML']);
    assert.equal(new Set(rows.join('')).size, 26);
  }
});

test('clipboard rejection falls back and copies ungrouped ciphertext', async () => {
  const f = fixture({ clipboard: { writeText: async () => { throw new Error('denied'); } } });
  await f.edit('batchIn', 'AAAAAA'); await f.ids.runBtn.emit('click'); await f.ids.copyBtn.emit('click');
  assert.deepEqual(f.copies, [new Core.Enigma({ rotors: ['I', 'II', 'III'] }).encryptText('AAAAAA')]);
  assert.equal(f.ids.copyBtn.textContent, '已复制'); assert.equal(f.document.body.children.length, 0);
});

test('failed fallback reports failure instead of saying copied', async () => {
  const f = fixture({ copyResult: false }); await f.edit('batchIn', 'A'); await f.ids.runBtn.emit('click');
  await f.ids.copyBtn.emit('click');
  assert.equal(f.ids.copyBtn.textContent, '复制结果'); assert.match(f.ids.batchStatus.textContent, /未允许复制/);
});

test('delayed clipboard completion cannot restore stale feedback after an edit', async () => {
  let finish;
  const f = fixture({ clipboard: { writeText: () => new Promise((resolve) => { finish = resolve; }) } });
  await f.edit('batchIn', 'A'); await f.ids.runBtn.emit('click');
  const copying = f.ids.copyBtn.emit('click'); await f.edit('batchIn', 'B'); finish(); await copying;
  assert.equal(f.ids.copyBtn.textContent, '复制结果'); assert.equal(f.ids.copyBtn.disabled, true);
  assert.match(f.ids.batchStatus.textContent, /输入已修改/);
});
