import { parseBodyToParagraphs, reportTypeLabel } from './report-export';

describe('report-export', () => {
  describe('reportTypeLabel', () => {
    it.each([
      ['strategy', '战略分析'],
      ['resume', '创业履历'],
      ['review', '复盘战报'],
      ['decision', '决策记录'],
    ] as const)('%s → %s', (type, label) => {
      expect(reportTypeLabel(type)).toBe(label);
    });
  });

  describe('parseBodyToParagraphs（受限 Markdown → 段落）', () => {
    it('解析小节标题 / 有序列表 / 段落，并剥离行内粗体', () => {
      const md =
        '## 主要矛盾\n\n你想扩张，但**信任**是慢功夫。\n\n## 三步走\n\n1. **守。**先守老客户。\n2. **攒。**写成手册。\n3. **扩。**再开第二家。';
      const paras = parseBodyToParagraphs(md);
      expect(paras).toEqual([
        { kind: 'heading', text: '主要矛盾' },
        { kind: 'text', text: '你想扩张，但信任是慢功夫。' },
        { kind: 'heading', text: '三步走' },
        { kind: 'item', text: '守。先守老客户。' },
        { kind: 'item', text: '攒。写成手册。' },
        { kind: 'item', text: '扩。再开第二家。' },
      ]);
    });

    it('自传体（无小节）全部按 text 段落', () => {
      const md = '二〇一七年冬天，牧之辞职。\n\n头半年很苦。';
      expect(parseBodyToParagraphs(md)).toEqual([
        { kind: 'text', text: '二〇一七年冬天，牧之辞职。' },
        { kind: 'text', text: '头半年很苦。' },
      ]);
    });

    it('空正文 → 空数组', () => {
      expect(parseBodyToParagraphs('')).toEqual([]);
    });
  });
});
