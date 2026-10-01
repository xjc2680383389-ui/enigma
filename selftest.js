/* 恩尼格玛模拟器确定性自检 —— 运行：node selftest.js
   输出用英文（避免 cmd 下 GBK 乱码），全过时最后一行输出 ALL PASS */
const { Enigma } = require('./enigma-core.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  [PASS] ' + msg); }
  else { fail++; console.log('  [FAIL] ' + msg); }
}
function section(name) { console.log('\n== ' + name + ' =='); }
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }

// —— 1. 经典测试向量（Enigma I / UKW-B / 转子I-II-III / 环AAA / 起始AAA / 无插线）——
section('1. Known test vector (I-II-III, B, AAA/AAA, no plugs)');
{
  const e = new Enigma({ rotors: ['I', 'II', 'III'], reflector: 'B' });
  assert(e.window === 'AAA', 'initial window = AAA');
  assert(e.encryptChar('A') === 'B', '1st A -> B');
  assert(e.encryptChar('A') === 'D', '2nd A -> D');
  assert(e.encryptChar('A') === 'Z', '3rd A -> Z');
  assert(e.encryptChar('A') === 'G', '4th A -> G');
  assert(e.encryptChar('A') === 'O', '5th A -> O');
  const e2 = new Enigma({ rotors: ['I', 'II', 'III'], reflector: 'B' });
  assert(e2.encryptText('AAAAA') === 'BDZGO', 'encryptText("AAAAA") === "BDZGO" (Wikipedia vector)');
}

// —— 2. 加解密同机：同一起始配置的新实例解回明文（反射板互逆性质）——
section('2. Symmetry: same config decrypts ciphertext back to plaintext');
{
  const cfg = { rotors: ['II', 'I', 'III'], reflector: 'B', rings: 'XZM', positions: 'QEV', plugs: 'AB CD EF GH IJ KL MN OP' };
  const enc = new Enigma(cfg);
  const plain = 'ANGRIFFSAUFMOSKAUBEGINNTMORGEN';
  const cipher = enc.encryptText(plain);
  const dec = new Enigma(cfg);
  assert(dec.encryptText(cipher) === plain, 'round-trip with 8 plugs / rings XZM / pos QEV');
  assert(cipher.length === plain.length, 'length preserved (30 chars)');
}

// —— 3. 双步进（middle-rotor double-step）——
section('3. Rotor double-step sequence');
{
  // I-II-III 从 ADU 出发，窗口序列应为 ADV AEW BFX BFY（AEW 后中轮带左轮）
  const e = new Enigma({ rotors: ['I', 'II', 'III'], reflector: 'B', positions: 'ADU' });
  const seq = [];
  for (let i = 0; i < 4; i++) { e.encryptChar('A'); seq.push(e.window); }
  assert(seq.join(' ') === 'ADV AEW BFX BFY', 'ADU -> ADV -> AEW -> BFX -> BFY');
}
{
  // 换一组转子（IV-II-V）：中轮 II notch=E、右轮 V notch=Z，U/V/W 均不触发进位，
  // 三步只是右轮连走：ADU -> ADV -> ADW -> ADX（中轮不动）
  const e = new Enigma({ rotors: ['IV', 'II', 'V'], reflector: 'B', positions: 'ADU' });
  const seq = [];
  for (let i = 0; i < 3; i++) { e.encryptChar('A'); seq.push(e.window); }
  assert(seq.join(' ') === 'ADV ADW ADX', 'plain stepping when no wheel at notch (IV-II-V)');
}

// —— 4. 反射板性质：任何状态下字母永不加密为自身 ——
section('4. No letter ever encrypts to itself');
{
  let bad = 0;
  const cfgs = [
    { rotors: ['I', 'II', 'III'], reflector: 'B' },
    { rotors: ['V', 'III', 'I'], reflector: 'C', rings: 'KDE', positions: 'ZZZ', plugs: 'AB QZ' },
    { rotors: ['IV', 'V', 'II'], reflector: 'A', rings: 'PCX', positions: 'HIT', plugs: 'AB CD EF GH IJ KL MN OP QR ST UV' },
  ];
  for (const cfg of cfgs) {
    const e = new Enigma(cfg);
    for (let i = 0; i < 150; i++) {
      const ch = String.fromCharCode(65 + ((i * 7 + 3) % 26));
      if (e.encryptChar(ch) === ch) bad++;
    }
  }
  assert(bad === 0, '450 encryptions across 3 configs: 0 self-encryptions');
}

// —— 5. 插线板生效 + 互逆 ——
section('5. Plugboard changes output and stays reciprocal');
{
  const base = { rotors: ['II', 'I', 'III'], reflector: 'B', positions: 'VER' };
  const p = 'DIESE NACHT';
  const c0 = new Enigma(base).encryptText(p);
  const c1 = new Enigma({ ...base, plugs: 'BQ CO' }).encryptText(p);
  assert(c0 !== c1, 'plugs "BQ CO" change ciphertext');
  const enc = new Enigma({ ...base, plugs: 'BQ CO WY' });
  const dec = new Enigma({ ...base, plugs: 'BQ CO WY' });
  assert(dec.encryptText(enc.encryptText(p)) === p.replace(/ /g, ''), 'round-trip with 3 plug pairs');
}

// —— 6. 环设置参与运算 ——
section('6. Ring settings (Ringstellung) matter');
{
  const base = { rotors: ['I', 'II', 'III'], reflector: 'B', positions: 'ABC' };
  const e0 = new Enigma(base).encryptText('RINGSTELLUNGTEST');
  const e1 = new Enigma({ ...base, rings: 'AAC' }).encryptText('RINGSTELLUNGTEST');
  assert(e0 !== e1, 'ring AAC vs AAA give different ciphertext');
  const enc = new Enigma({ ...base, rings: 'PCX' });
  const dec = new Enigma({ ...base, rings: 'PCX' });
  assert(dec.encryptText(enc.encryptText('RINGSTELLUNGTEST')) === 'RINGSTELLUNGTEST', 'round-trip with rings PCX');
}

// —— 7. 确定性 + 长文本往返 ——
section('7. Determinism and long-text round-trip');
{
  const cfg = { rotors: ['IV', 'V', 'I'], reflector: 'C', rings: 'PCX', positions: 'HIT', plugs: 'AB CD EF GH IJ KL MN OP QR ST' };
  const long = 'XKVQWEMPOIURTYZALSKDJFHG'.repeat(13); // 299 chars
  const r1 = new Enigma(cfg).encryptText(long);
  const r2 = new Enigma(cfg).encryptText(long);
  assert(r1 === r2, 'same input twice -> identical ciphertext');
  assert(new Enigma(cfg).encryptText(r1) === long, '300-char round-trip with 10 plugs');
}

// —— 8. nudge / reset / window ——
section('8. Manual nudge, reset and window readout');
{
  const e = new Enigma({ rotors: ['I', 'II', 'III'], reflector: 'B', positions: 'ABC' });
  assert(e.window === 'ABC', 'window starts at ABC');
  e.encryptChar('A');
  assert(e.window === 'ABD', 'after 1 key window = ABD (C steps, no carry)');
  e.nudge(2, 1); // 手拧右轮 +1
  assert(e.window === 'ABE', 'nudge right wheel +1 -> ABE');
  e.nudge(0, -1); // 左轮 -1：A 的前一个字母是 Z
  assert(e.window === 'ZBE', 'nudge left wheel -1 -> ZBE');
  e.nudge(1, 26); // 整圈
  assert(e.window === 'ZBE', 'nudge +26 is identity');
  e.reset();
  assert(e.window === 'ABC', 'reset() returns to ABC');
}

// —— 9. 非法配置必须抛错 ——
section('9. Invalid configs throw');
{
  assert(throws(() => new Enigma({ rotors: ['I', 'I', 'II'] })), 'duplicate rotors throw');
  assert(throws(() => new Enigma({ rotors: ['I', 'II', 'VI'] })), 'unknown rotor VI throws');
  assert(throws(() => new Enigma({ rotors: ['I', 'II', 'III'], reflector: 'D' })), 'unknown reflector D throws');
  assert(throws(() => new Enigma({ rotors: ['I', 'II', 'III'], rings: 'AA' })), 'short rings throw');
  assert(throws(() => new Enigma({ rotors: ['I', 'II', 'III'], plugs: 'AB AC' })), 'plug letter reused throws');
  assert(throws(() => new Enigma({ rotors: ['I', 'II', 'III'], plugs: 'A' })), 'malformed plug pair throws');
  assert(throws(() => new Enigma({ rotors: ['I', 'II', 'III'], plugs: 'AA' })), 'self-plug throws');
  assert(throws(() => new Enigma({ rotors: ['I', 'II'] })), '2 rotors throw');
}

// —— 10. 反射板差异 ——
section('10. Different reflectors give different output');
{
  const base = { rotors: ['I', 'II', 'III'], positions: 'XYZ' };
  const a = new Enigma({ ...base, reflector: 'A' }).encryptText('REFLEKTOR');
  const b = new Enigma({ ...base, reflector: 'B' }).encryptText('REFLEKTOR');
  const c = new Enigma({ ...base, reflector: 'C' }).encryptText('REFLEKTOR');
  assert(a !== b && b !== c && a !== c, 'UKW-A/B/C outputs all differ');
}

console.log('\n================================');
console.log('TOTAL: ' + pass + ' passed, ' + fail + ' failed');
if (fail === 0) console.log('ALL PASS');
process.exit(fail === 0 ? 0 : 1);
