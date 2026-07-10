import {
  buildReportMessages,
  buildSummary,
  countWords,
  parseReportJson,
} from './report-prompt';

describe('report-prompt', () => {
  describe('parseReportJson', () => {
    it('解析裸 JSON', () => {
      const r = parseReportJson(
        '{"title":"标题","bodyMd":"## 小节\\n正文","annotation":"批注","wordCount":9}',
      );
      expect(r).toEqual({
        title: '标题',
        bodyMd: '## 小节\n正文',
        annotation: '批注',
      });
    });

    it('剥离 ```json 围栏后解析', () => {
      const r = parseReportJson('```json\n{"title":"T","bodyMd":"B"}\n```');
      expect(r?.title).toBe('T');
      expect(r?.annotation).toBe(''); // 缺省 annotation → 空串
    });

    it('非 JSON / 缺 title / 缺 bodyMd → null', () => {
      expect(parseReportJson('这不是 JSON')).toBeNull();
      expect(parseReportJson('{"bodyMd":"B"}')).toBeNull();
      expect(parseReportJson('{"title":"T"}')).toBeNull();
    });
  });

  describe('countWords', () => {
    it('剥离 ##/列表号/粗体星号后按非空白字符计数', () => {
      const md = '## 主要矛盾\n\n1. **守。**先做复购\n2. **攒。**写手册';
      // 「主要矛盾 守。先做复购 攒。写手册」= 15 个非空白字符（含中文句号）
      expect(countWords(md)).toBe(15);
    });
  });

  describe('buildSummary', () => {
    it('取首个非标题段落，去标记截 60 字', () => {
      const md = '## 主要矛盾\n\n**扩张**要慢，信任要攒。';
      const s = buildSummary(md);
      expect(s.startsWith('扩张要慢')).toBe(true);
      expect(s).not.toContain('#');
      expect(s.length).toBeLessThanOrEqual(60);
    });
  });

  describe('buildReportMessages', () => {
    it('拼入画像/检索片段/对话，system 含类型结构要求', () => {
      const msgs = buildReportMessages({
        type: 'strategy',
        dialogue: '老板：我想扩张',
        kbFragments: ['老板做宠物殡葬'],
        industry: '宠物殡葬',
        bizNote: '两家店',
        topic: null,
      });
      expect(msgs[0].role).toBe('system');
      expect(msgs[0].content).toContain('主要矛盾');
      expect(msgs[1].content).toContain('宠物殡葬');
      expect(msgs[1].content).toContain('老板做宠物殡葬');
      expect(msgs[1].content).toContain('我想扩张');
    });
  });
});
