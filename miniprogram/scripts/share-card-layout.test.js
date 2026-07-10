// 纯逻辑自测（可在 Node 直接跑）：验证 utils/share-card.ts 的布局计算，
// 注入 measure 函数，不依赖 canvas。三用例：
//   ① 长中文折行　② 段落截断（>6 段 + 「……完整报告见小程序」）　③ 高度累计
// 运行：npm run test:share （先 tsc 编译 share-card.ts 到 scripts/dist，再 node 本文件）
'use strict';
const assert = require('assert');
const { wrapText, planCard, CONTENT_W } = require('./dist/share-card-layout');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log('  ✓ ' + name);
}

// 注入测量：CJK 字符宽 ≈ 字号（1em）；ASCII 近似 0.5em。返回像素宽。
function makeMeasure() {
  return (text, size) => {
    let w = 0;
    for (const ch of Array.from(text)) {
      w += ch.charCodeAt(0) < 128 ? size * 0.5 : size;
    }
    return w;
  };
}

// 造一份 export 数据
function makeData(paragraphs, opts) {
  opts = opts || {};
  return {
    title: opts.title || '你的护城河：把信任做成根据地',
    type: 'strategy',
    typeLabel: '战略分析',
    createdAt: '2026-07-10T14:32:00.000Z',
    wordCount: 900,
    origin: 'agent',
    paragraphs: paragraphs,
    annotation: opts.annotation !== undefined ? opts.annotation : '「先把帆张稳，扩张是水到渠成的事。」',
    brand: { name: '米诺战略参谋部', slogan: '对话产出报告，报告喂养对话' },
  };
}

// ---------- 用例 1：长中文折行 ----------
(function testWrap() {
  console.log('用例 1 · 长中文折行');
  const measure = makeMeasure();
  const size = 28;
  const long = '这是一段很长的中文正文用来验证折行逻辑'.repeat(4); // 无标点纯汉字
  const lines = wrapText(long, CONTENT_W, (s) => measure(s, size));
  ok('长文折成多行', lines.length > 1);
  ok('每行宽度不超过可用宽', lines.every((ln) => measure(ln, size) <= CONTENT_W));
  ok('折行不丢字（拼回原文）', lines.join('') === long);

  // 显式换行符强制分行
  const withBreak = wrapText('第一行\n第二行', CONTENT_W, (s) => measure(s, size));
  ok('\\n 强制换行为两行', withBreak.length === 2 && withBreak[0] === '第一行');

  // 单字超宽也至少独占一行（不死循环）
  const narrow = wrapText('甲乙丙', 10, (s) => measure(s, size));
  ok('极窄宽度每字一行', narrow.length === 3);
})();

// ---------- 用例 2：段落截断 ----------
(function testTruncate() {
  console.log('用例 2 · 段落截断（>6 段）');
  const measure = makeMeasure();
  const many = [];
  for (let i = 0; i < 9; i++) many.push({ kind: 'text', text: `第${i}段正文。` });
  const plan = planCard(makeData(many), measure);
  ok('段落超 6 触发截断', plan.truncated === true);
  const textBlocks = plan.blocks.filter((b) => b.kind === 'text');
  ok('正文块只保留 6 段', textBlocks.length === 6);
  ok('存在「完整报告见小程序」截断行', plan.blocks.some((b) => b.kind === 'more'));

  // 恰好 6 段不截断
  const six = many.slice(0, 6);
  const plan6 = planCard(makeData(six), measure);
  ok('恰好 6 段不截断', plan6.truncated === false);
  ok('6 段无 more 块', plan6.blocks.every((b) => b.kind !== 'more'));
})();

// ---------- 用例 3：高度累计 ----------
(function testHeight() {
  console.log('用例 3 · 高度累计');
  const measure = makeMeasure();
  const small = planCard(makeData([{ kind: 'text', text: '一句话。' }]), measure);
  const big = planCard(
    makeData([
      { kind: 'heading', text: '主要矛盾' },
      { kind: 'text', text: '很长的一段正文'.repeat(6) },
      { kind: 'item', text: '守住老客户。' },
      { kind: 'item', text: '写成手册。' },
    ]),
    measure
  );
  ok('高度为正整数', small.height > 0 && Number.isInteger(small.height));
  ok('内容更多 → 高度更大', big.height > small.height);

  // 有批注 vs 无批注：批注块增加高度
  const withAnno = planCard(makeData([{ kind: 'text', text: '一句话。' }]), measure);
  const noAnno = planCard(
    makeData([{ kind: 'text', text: '一句话。' }], { annotation: '' }),
    measure
  );
  ok('批注块占额外高度', withAnno.height > noAnno.height);
  ok('宽度恒为 750', small.width === 750);
})();

console.log('\n全部通过：' + passed + ' 条断言');
