import { ReportMarker, ReportMarkerStream } from './report-marker';

/** 把若干 chunk 顺序喂入拦截器（含 flush），汇总下发文本与拦到的标记。 */
function feedAll(chunks: string[]): { text: string; markers: ReportMarker[] } {
  const stream = new ReportMarkerStream();
  let text = '';
  const markers: ReportMarker[] = [];
  for (const c of chunks) {
    const r = stream.push(c);
    text += r.text;
    markers.push(...r.markers);
  }
  const tail = stream.flush();
  text += tail.text;
  markers.push(...tail.markers);
  return { text, markers };
}

describe('ReportMarkerStream 标记拦截器', () => {
  it('整段单 chunk：剥离完整标记并解析 type/topic', () => {
    const { text, markers } = feedAll([
      '这事聊透了，该记一笔。\n<mino:report_ready type="strategy" topic="本周聚焦老客"/>',
    ]);
    expect(text).toBe('这事聊透了，该记一笔。\n');
    expect(markers).toEqual([{ type: 'strategy', topic: '本周聚焦老客' }]);
  });

  it('跨 chunk 拆分：标记被劈成两片仍能拦截、不泄漏', () => {
    const { text, markers } = feedAll([
      '聊透了',
      '\n<mino:report',
      '_ready type="review" topic="留客复盘"/>',
    ]);
    expect(text).toBe('聊透了\n');
    expect(text).not.toContain('mino:report');
    expect(markers).toEqual([{ type: 'review', topic: '留客复盘' }]);
  });

  it('逐字符拆分：极端分包边界下依旧不泄漏标记', () => {
    const raw =
      '好的<mino:report_ready type="decision" topic="要不要扩张"/>收工';
    const { text, markers } = feedAll(raw.split(''));
    expect(text).toBe('好的收工');
    expect(markers).toEqual([{ type: 'decision', topic: '要不要扩张' }]);
  });

  it('伪前缀：<mino:rep 后面不是标记，最终原样下发、不误吞', () => {
    const { text, markers } = feedAll(['你好<mino:rep', ' air 屋顶']);
    expect(text).toBe('你好<mino:rep air 屋顶');
    expect(markers).toEqual([]);
  });

  it('多标记：同一流中出现两个标记，全部拦截', () => {
    const { text, markers } = feedAll([
      'A<mino:report_ready type="strategy" topic="一"/>B',
      '<mino:report_ready type="resume" topic="二"/>C',
    ]);
    expect(text).toBe('ABC');
    expect(markers).toEqual([
      { type: 'strategy', topic: '一' },
      { type: 'resume', topic: '二' },
    ]);
  });

  it('非法 type 回落 strategy，topic 缺省空串', () => {
    const { markers } = feedAll(['<mino:report_ready type="xxx"/>']);
    expect(markers).toEqual([{ type: 'strategy', topic: '' }]);
  });

  it('无标记：纯文本原样透传', () => {
    const { text, markers } = feedAll(['兄弟，', '这周该收缩。']);
    expect(text).toBe('兄弟，这周该收缩。');
    expect(markers).toEqual([]);
  });

  it('flush 丢弃收尾残缺标记，防止泄漏半截标记', () => {
    const { text, markers } = feedAll([
      '结束了\n<mino:report_ready type="review"',
    ]);
    expect(text).toBe('结束了\n');
    expect(markers).toEqual([]);
  });
});
