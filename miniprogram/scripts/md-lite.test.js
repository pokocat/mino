// 纯逻辑自测（可在 Node 直接跑）：验证 utils/md-lite.ts 的受限 Markdown 解析。
//   ① 三小节解析　② 粗体拆分　③ 有序列表归并 + 项内粗体
//   ④ 无序列表 / 表格 / ### 等规范外语法兜底为段落　⑤ 空行处理
// 运行：npm run test:md （先 tsc 编译 md-lite.ts 到 scripts/dist，再 node 本文件）
'use strict';
const assert = require('assert');
const { parseMdLite, splitBold } = require('./dist/md-lite');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log('  ✓ ' + name);
}

// ---------- 用例 1：三小节解析 ----------
(function testThreeSections() {
  console.log('用例 1 · 三小节解析');
  const md = ['## 主要矛盾', '正文一。', '', '## 定位', '正文二。', '', '## 三步走', '正文三。'].join(
    '\n'
  );
  const nodes = parseMdLite(md);
  const sections = nodes.filter((n) => n.type === 'section');
  ok('解析出 3 个 section', sections.length === 3);
  ok('小节标题顺序正确', sections.map((s) => s.title).join(',') === '主要矛盾,定位,三步走');
  ok('每节后各一段落', nodes.filter((n) => n.type === 'paragraph').length === 3);
})();

// ---------- 用例 2：粗体拆分 ----------
(function testBold() {
  console.log('用例 2 · 粗体拆分');
  const spans = splitBold('扩张要看 **速度 vs 沉淀**，别急。');
  ok('拆成 3 段', spans.length === 3);
  ok('中段为粗体且内容去掉星号', spans[1].bold === true && spans[1].text === '速度 vs 沉淀');
  ok('首尾非粗体', spans[0].bold === false && spans[2].bold === false);

  const multi = splitBold('**守。**先做好，再 **扩。**');
  ok('多处粗体各自成段', multi.filter((s) => s.bold).length === 2);

  const plain = splitBold('没有粗体的一行');
  ok('无粗体 → 单个非粗体 span', plain.length === 1 && plain[0].bold === false);

  const unclosed = splitBold('未闭合 ** 星号保留');
  ok('未闭合 ** 按普通文本保留', unclosed.length === 1 && unclosed[0].bold === false);
})();

// ---------- 用例 3：有序列表归并 + 项内粗体 ----------
(function testOrderedList() {
  console.log('用例 3 · 有序列表归并');
  const md = ['## 三步走', '1. **守。**先守住老客户。', '2. **攒。**写成手册。', '3. **扩。**再开第二家。'].join(
    '\n'
  );
  const nodes = parseMdLite(md);
  const lists = nodes.filter((n) => n.type === 'olist');
  ok('连续列表行归并为 1 个 olist', lists.length === 1);
  ok('olist 含 3 项', lists[0].items.length === 3);
  ok('首项首 span 为粗体引导词「守。」', lists[0].items[0][0].bold === true && lists[0].items[0][0].text === '守。');
})();

// ---------- 用例 4：规范外语法兜底 ----------
(function testFallback() {
  console.log('用例 4 · 规范外语法兜底为段落');
  const md = ['- 无序项一', '- 无序项二', '', '| 表头 | 值 |', '| --- | --- |', '', '### 三级标题'].join('\n');
  const nodes = parseMdLite(md);
  ok('无 section / olist 节点', nodes.every((n) => n.type === 'paragraph'));
  ok('无序列表兜底为段落且保留原文', nodes[0].spans[0].text.indexOf('- 无序项一') === 0);
  ok('表格行兜底为段落且保留竖线', nodes[1].spans[0].text.indexOf('| 表头 | 值 |') === 0);
  ok('### 三级标题兜底为段落（非 section）', nodes[2].spans[0].text === '### 三级标题');
})();

// ---------- 用例 5：空行处理 ----------
(function testBlankLines() {
  console.log('用例 5 · 空行处理');
  const md = ['段一。', '', '', '', '段二。', '   ', '段三。'].join('\n');
  const nodes = parseMdLite(md);
  ok('连续多空行不产出空段落', nodes.length === 3 && nodes.every((n) => n.type === 'paragraph'));
  ok('空行正确分段', nodes.map((n) => n.spans[0].text).join('|') === '段一。|段二。|段三。');

  const empty = parseMdLite('');
  ok('空字符串 → 空数组', Array.isArray(empty) && empty.length === 0);
})();

console.log('\n全部通过：' + passed + ' 条断言');
