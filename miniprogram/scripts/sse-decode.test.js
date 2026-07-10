// 纯逻辑自测（可在 Node 直接跑）：验证 utils/sse-decode.ts 的
//   ① UTF-8 增量解码（多字节字符跨 chunk 拆分）
//   ② SSE 帧跨 chunk 拼接
//   ③ 一个 chunk 内连续多帧
// 运行：npm run test:sse （先 tsc 编译 sse-decode.ts 到 scripts/dist，再 node 本文件）
'use strict';
const assert = require('assert');
const { Utf8IncrementalDecoder, SseFrameSplitter, parseFrame } = require('./dist/sse-decode');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log('  ✓ ' + name);
}

// 把 Node Buffer 转成普通字节数组，模拟 onChunkReceived 的 Uint8Array
function bytes(str) {
  return Array.prototype.slice.call(Buffer.from(str, 'utf8'));
}

// ---------- 用例 1：多字节字符跨 chunk 拆分 ----------
(function testMultibyteSplit() {
  console.log('用例 1 · 多字节字符跨 chunk 拆分');
  const dec = new Utf8IncrementalDecoder();

  // 「你好」：每个汉字 3 字节；在第一个汉字中间(第 2 字节后)切开
  const all = bytes('你好');
  const c1 = all.slice(0, 2); // 「你」的前 2 字节（不完整）
  const c2 = all.slice(2); // 「你」剩 1 字节 + 完整「好」

  const out1 = dec.decode(c1);
  ok('半个汉字不吐字（留存尾字节）', out1 === '');
  const out2 = dec.decode(c2);
  ok('补齐后完整还原「你好」', out1 + out2 === '你好');

  // 4 字节 emoji 跨三次 chunk（😀 = F0 9F 98 80）
  const dec2 = new Utf8IncrementalDecoder();
  const eb = bytes('a😀b');
  let acc = '';
  acc += dec2.decode(eb.slice(0, 2)); // 'a' + emoji 第 1 字节
  acc += dec2.decode(eb.slice(2, 4)); // emoji 第 2、3 字节
  acc += dec2.decode(eb.slice(4)); // emoji 第 4 字节 + 'b'
  ok('4 字节 emoji 逐字节到位仍还原 a😀b', acc === 'a😀b');
})();

// ---------- 用例 2：帧跨 chunk ----------
(function testFrameAcrossChunks() {
  console.log('用例 2 · SSE 帧跨 chunk');
  const sp = new SseFrameSplitter();
  const frame = 'event: token\ndata: {"t":"你"}\n\n';
  const mid = Math.floor(frame.length / 2);

  const r1 = sp.push(frame.slice(0, mid)); // 半帧：不应产出
  ok('半帧不产出', r1.length === 0);
  const r2 = sp.push(frame.slice(mid)); // 补齐：产出 1 帧
  ok('补齐后产出 1 帧', r2.length === 1);
  ok('事件名为 token', r2[0].event === 'token');
  ok('data 为 JSON 字符串', JSON.parse(r2[0].data).t === '你');
})();

// ---------- 用例 3：一个 chunk 内连续多帧 ----------
(function testMultipleFramesOneChunk() {
  console.log('用例 3 · 连续多帧一个 chunk');
  const sp = new SseFrameSplitter();
  const blob =
    'event: token\ndata: {"t":"甲"}\n\n' +
    'event: token\ndata: {"t":"乙"}\n\n' +
    'event: suggestions\ndata: {"items":[]}\n\n' +
    'event: done\ndata: {"messageId":"m1","conversationId":"c1"}\n\n';
  const frames = sp.push(blob);
  ok('一次切出 4 帧', frames.length === 4);
  ok('第 1 帧 token=甲', JSON.parse(frames[0].data).t === '甲');
  ok('第 3 帧为 suggestions', frames[2].event === 'suggestions');
  ok('第 4 帧 done 带 messageId', JSON.parse(frames[3].data).messageId === 'm1');

  // 末尾残留半帧应留在缓冲，直到补齐
  const sp2 = new SseFrameSplitter();
  const two = sp2.push('event: token\ndata: {"t":"1"}\n\nevent: token\ndata: {"t":"2"}');
  ok('两帧+半帧 → 先出 1 帧', two.length === 1);
  const rest = sp2.push('\n\n');
  ok('补齐分隔符 → 再出第 2 帧', rest.length === 1 && JSON.parse(rest[0].data).t === '2');
})();

// ---------- 附加：parseFrame data 前导空格与缺省事件 ----------
(function testParseFrame() {
  console.log('附加 · parseFrame 细节');
  const f = parseFrame('event: token\ndata: {"t":"x"}');
  ok('去掉 data 冒号后单个前导空格', f.data === '{"t":"x"}');
  const f2 = parseFrame('data: {"a":1}');
  ok('缺省事件名为 message', f2.event === 'message');
})();

// ---------- 附加：retract 事件帧切分与解析（M6 军师收回）----------
(function testRetractFrame() {
  console.log('附加 · retract 事件');
  const sp = new SseFrameSplitter();
  const blob =
    'event: token\ndata: {"t":"甲"}\n\n' +
    'event: retract\ndata: {"messageId":"m-42"}\n\n';
  const frames = sp.push(blob);
  ok('token 与 retract 各切出 1 帧', frames.length === 2);
  ok('第 2 帧事件名为 retract', frames[1].event === 'retract');
  ok('retract data 带 messageId', JSON.parse(frames[1].data).messageId === 'm-42');
})();

console.log('\n全部通过：' + passed + ' 条断言');
