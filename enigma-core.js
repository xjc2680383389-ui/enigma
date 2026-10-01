/* 恩尼格玛 Enigma I（Wehrmacht 三转子型）模拟核心 —— 纯逻辑，无 DOM，node 可直跑 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EnigmaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 标准 Enigma I 转子内部接线（字母序 A-Z 映射）与缺口位置（notch）
  // notch = 转子窗口显示该字母后再步进时，带动左侧转子
  const ROTORS = {
    'I':   { wiring: 'EKMFLGDQVZNTOWYHXUSPAIBRCJ', notch: 'Q' },
    'II':  { wiring: 'AJDKSIRUXBLHWTMCQGZNPYFVOE', notch: 'E' },
    'III': { wiring: 'BDFHJLCPRTXVZNYEIWGAKMUSQO', notch: 'V' },
    'IV':  { wiring: 'ESOVPZJAYQUIRHXLNFTGKDCMWB', notch: 'J' },
    'V':   { wiring: 'VZBRGITYUPSDNHLXAWMJQOFECK', notch: 'Z' },
  };
  // 反射板（UKW）接线
  const REFLECTORS = {
    'A': 'EJMZALYXVBWFCRQUONTSPIKHGD',
    'B': 'YRUHQSLDPXNGOKMIEBFZCWVJAT',
    'C': 'FVPJIAOYEDRZXWGCTKUQSBNMHL',
  };

  const A = 65;
  const mod26 = (n) => ((n % 26) + 26) % 26;
  const letterToNum = (ch) => ch.charCodeAt(0) - A;
  const numToLetter = (n) => String.fromCharCode(A + mod26(n));

  // 插线板："AB CD EF" → 长度 26 的互逆置换数组；非法输入抛错
  function parsePlugs(str) {
    const perm = Array.from({ length: 26 }, (_, i) => i);
    const seen = new Set();
    const pairs = String(str || '').trim().toUpperCase().split(/[\s,;]+/).filter(Boolean);
    if (pairs.length > 13) throw new Error('插线板最多 13 对，当前 ' + pairs.length + ' 对');
    for (const pair of pairs) {
      if (!/^[A-Z]{2}$/.test(pair)) throw new Error('插线板格式错误：' + pair + '（应为成对字母，如 AB CD）');
      const a = letterToNum(pair[0]), b = letterToNum(pair[1]);
      if (a === b) throw new Error('插线板不能把字母接到自身：' + pair);
      if (seen.has(a) || seen.has(b)) throw new Error('插线板字母重复使用：' + pair);
      seen.add(a); seen.add(b);
      perm[a] = b; perm[b] = a;
    }
    return perm;
  }

  function parseLetters(str, count, what) {
    const s = String(str || '').trim().toUpperCase();
    if (!new RegExp('^[A-Z]{' + count + '}$').test(s))
      throw new Error(what + '必须为 ' + count + ' 个 A-Z 字母，当前："' + str + '"');
    return [...s].map(letterToNum);
  }

  class Enigma {
    // rotors: 从左到右的 3 个转子名（如 ['I','II','III']，最右为快轮）
    // rings: 环设置 3 字母；positions: 起始位置 3 字母；plugs: 插线板字母对串
    constructor({ rotors, reflector = 'B', rings = 'AAA', positions = 'AAA', plugs = '' }) {
      if (!Array.isArray(rotors) || rotors.length !== 3) throw new Error('必须按左中右顺序指定 3 个转子');
      if (new Set(rotors).size !== 3) throw new Error('三个转子不能重复：' + rotors.join(' '));
      this.slots = rotors.map((name) => {
        const r = ROTORS[name];
        if (!r) throw new Error('未知转子：' + name + '（可选 I/II/III/IV/V）');
        const wiring = [...r.wiring].map(letterToNum);
        const inv = Array(26);
        wiring.forEach((v, i) => (inv[v] = i));
        return { wiring, inv, notch: letterToNum(r.notch) };
      });
      if (!REFLECTORS[reflector]) throw new Error('未知反射板：' + reflector + '（可选 A/B/C）');
      this.reflector = [...REFLECTORS[reflector]].map(letterToNum);
      this.rings = parseLetters(rings, 3, '环设置');
      this.home = parseLetters(positions, 3, '起始位置');
      this.pos = [...this.home];
      this.plugboard = parsePlugs(plugs);
    }

    // 转子步进：含中轮双步进（double-step）——中轮在缺口时，中轮带动左轮再走一步
    step() {
      const [l, m, r] = this.pos;
      if (m === this.slots[1].notch) {
        this.pos[1] = mod26(m + 1);
        this.pos[0] = mod26(l + 1);
      } else if (r === this.slots[2].notch) {
        this.pos[1] = mod26(m + 1);
      }
      this.pos[2] = mod26(r + 1);
    }

    // 转子正向穿越：x 从右往左穿过第 idx 个转子
    fwd(idx, x) {
      const s = this.slots[idx];
      const shift = this.pos[idx] - this.rings[idx];
      return mod26(s.wiring[mod26(x + shift)] - shift);
    }
    // 反向穿越：x 从左往右返回（用接线逆表）
    bwd(idx, x) {
      const s = this.slots[idx];
      const shift = this.pos[idx] - this.rings[idx];
      return mod26(s.inv[mod26(x + shift)] - shift);
    }

    // 按一键：真实机器先机械步进、后接通电路，故先 step 再加密
    encryptChar(ch) {
      const c = String(ch).toUpperCase();
      if (!/^[A-Z]$/.test(c)) throw new Error('只能输入单个字母：' + ch);
      this.step();
      const p = this.plugboard;
      let x = p[letterToNum(c)];
      x = this.fwd(2, x);
      x = this.fwd(1, x);
      x = this.fwd(0, x);
      x = this.reflector[x];
      x = this.bwd(0, x);
      x = this.bwd(1, x);
      x = this.bwd(2, x);
      return numToLetter(p[x]);
    }

    // 整段文本：只处理字母，其余字符忽略
    encryptText(text) {
      let out = '';
      for (const ch of String(text)) {
        if (/[a-zA-Z]/.test(ch)) out += this.encryptChar(ch);
      }
      return out;
    }

    // 转子窗口读数（左中右三个可见字母）
    get window() { return this.pos.map(numToLetter).join(''); }

    // 手拧某个转子 ±1（模拟真实机器直接转动转子设位置；绕过联动，不带动邻轮）
    nudge(idx, delta) {
      if (idx < 0 || idx > 2) throw new Error('转子下标 0-2');
      this.pos[idx] = mod26(this.pos[idx] + delta);
    }

    // 回到起始位置
    reset() { this.pos = [...this.home]; return this; }
  }

  return { Enigma, ROTORS, REFLECTORS, parsePlugs, mod26 };
});
