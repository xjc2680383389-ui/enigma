/* Enigma I 界面：逐键和整段操作共享已应用密钥，表单修改作为草稿。 */
(function () {
  'use strict';
  const C = window.EnigmaCore;
  const $ = (id) => document.getElementById(id);
  const ROWS = ['QWERTZUIO', 'ASDFGHJK', 'PYXCVBNML'];
  const lamps = {};
  const rotEls = document.querySelectorAll('.rotor');
  const winEls = Array.from(rotEls, (el) => el.querySelector('.win'));
  const configIds = ['rotL', 'rotM', 'rotR', 'ukw', 'ringL', 'ringM', 'ringR', 'posL', 'posM', 'posR', 'plugInput'];
  let machine = null;
  let activeConfig = null;
  let batchResult = '';
  let lampTimer = null;
  let copyTimer = null;
  let resultVersion = 0;
  const tape = { plain: '', cipher: '' };

  ROWS.forEach((row) => {
    const lr = document.createElement('div'); lr.className = 'lrow';
    const kr = document.createElement('div'); kr.className = 'krow';
    for (const ch of row) {
      const lamp = document.createElement('div'); lamp.className = 'lamp'; lamp.textContent = ch;
      lr.appendChild(lamp); lamps[ch] = lamp;
      const key = document.createElement('button'); key.type = 'button'; key.className = 'key'; key.textContent = ch;
      key.setAttribute('aria-label', '输入字母 ' + ch);
      // 原生 click 同时支持鼠标、触屏和 Enter/空格，不接受右键。
      key.addEventListener('click', (e) => { if (e.button === undefined || e.button === 0) press(ch); });
      kr.appendChild(key);
    }
    $('lampboard').appendChild(lr); $('keyboard').appendChild(kr);
  });

  function readConfig() {
    return {
      rotors: [$('rotL').value, $('rotM').value, $('rotR').value],
      reflector: $('ukw').value,
      rings: ['ringL', 'ringM', 'ringR'].map((id) => $(id).value.trim().toUpperCase()).join(''),
      positions: ['posL', 'posM', 'posR'].map((id) => $(id).value.trim().toUpperCase()).join(''),
      plugs: $('plugInput').value.trim().toUpperCase().split(/[\s,;]+/).filter(Boolean).join(' '),
    };
  }

  function renderConfigStatus() {
    const pending = JSON.stringify(readConfig()) !== JSON.stringify(activeConfig);
    $('cfgStatus').textContent = pending
      ? '有尚未应用的修改；逐键和整段处理仍使用已应用密钥。'
      : '当前设置已应用；整段处理从起始位置 ' + activeConfig.positions + ' 开始。';
  }

  function group5(s) { return s.replace(/(.{5})/g, '$1 ').trim(); }

  function renderMachine() {
    winEls.forEach((el, i) => (el.textContent = machine.window[i]));
    $('ukwTag').textContent = 'UKW-' + activeConfig.reflector;
    ['L', 'M', 'R'].forEach((side, i) => {
      $('rotorName' + side).textContent = activeConfig.rotors[i];
      $('ringLbl' + side).textContent = activeConfig.rings[i];
    });
    $('tapeIn').textContent = tape.plain ? group5(tape.plain) : '—';
    $('tapeOut').textContent = tape.cipher ? group5(tape.cipher) : '—';
  }

  function clearLamps() {
    clearTimeout(lampTimer);
    for (const ch in lamps) lamps[ch].classList.remove('lit');
  }

  function invalidateBatch(message = '') {
    batchResult = '';
    resultVersion++;
    clearTimeout(copyTimer);
    $('batchOut').textContent = '—';
    $('copyBtn').disabled = true;
    $('copyBtn').textContent = '复制结果';
    $('batchStatus').textContent = message;
  }

  function applyConfig() {
    try {
      const config = readConfig();
      const nextMachine = new C.Enigma(config); // 校验成功后才替换旧状态。
      machine = nextMachine;
      activeConfig = config;
      ['L', 'M', 'R'].forEach((side, i) => {
        $('ring' + side).value = config.rings[i];
        $('pos' + side).value = config.positions[i];
      });
      $('plugInput').value = config.plugs;
      tape.plain = ''; tape.cipher = '';
      clearLamps();
      invalidateBatch();
      $('cfgErr').textContent = '';
      renderMachine();
    } catch (err) {
      invalidateBatch('设置未应用，旧结果已清除。');
      $('cfgErr').textContent = '✗ ' + err.message;
    }
    if (activeConfig) renderConfigStatus();
  }

  function press(ch) {
    if (!machine) return;
    const lit = machine.encryptChar(ch);
    tape.plain += ch; tape.cipher += lit;
    clearLamps();
    lamps[lit].classList.add('lit');
    lampTimer = setTimeout(() => lamps[lit].classList.remove('lit'), 420);
    renderMachine();
  }

  rotEls.forEach((el, idx) => el.addEventListener('click', () => {
    if (!machine) return;
    machine.nudge(idx, 1);
    renderMachine();
  }));

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const target = e.target;
    const tag = (target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
    if (!/^[a-zA-Z]$/.test(e.key)) return;
    e.preventDefault();
    press(e.key.toUpperCase());
  });

  configIds.forEach((id) => {
    ['input', 'change'].forEach((event) => $(id).addEventListener(event, () => {
      $('cfgErr').textContent = '';
      if (activeConfig) renderConfigStatus();
    }));
  });

  $('runBtn').addEventListener('click', () => {
    invalidateBatch();
    try {
      if (!activeConfig) throw new Error('请先应用有效密钥');
      const m = new C.Enigma(activeConfig);
      batchResult = m.encryptText($('batchIn').value);
      $('batchOut').textContent = group5(batchResult) || '—';
      $('copyBtn').disabled = !batchResult;
      $('batchStatus').textContent = batchResult ? '已处理 ' + batchResult.length + ' 个 A–Z 字母。' : '没有可处理的 A–Z 字母。';
    } catch (err) {
      invalidateBatch('✗ ' + err.message);
    }
  });

  $('batchIn').addEventListener('input', () => invalidateBatch('输入已修改，请重新运行。'));
  $('clearBtn').addEventListener('click', () => {
    $('batchIn').value = '';
    invalidateBatch();
  });

  function fallbackCopy(text) {
    const previous = document.activeElement;
    const ta = document.createElement('textarea'); ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    try { ta.select(); return document.execCommand('copy'); }
    finally { document.body.removeChild(ta); if (previous) previous.focus(); }
  }

  $('copyBtn').addEventListener('click', async () => {
    if (!batchResult) return;
    const text = batchResult;
    const version = resultVersion;
    try {
      let copied = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try { await navigator.clipboard.writeText(text); copied = true; } catch (_) { /* 尝试本地文件兼容路径。 */ }
      }
      if (!copied) copied = fallbackCopy(text);
      if (version !== resultVersion) return;
      if (!copied) throw new Error('浏览器未允许复制，请手动选择结果复制。');
      $('copyBtn').textContent = '已复制';
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => ($('copyBtn').textContent = '复制结果'), 1200);
    } catch (err) {
      if (version === resultVersion) $('batchStatus').textContent = '✗ ' + err.message;
    }
  });

  $('applyBtn').addEventListener('click', applyConfig);
  applyConfig();
})();
