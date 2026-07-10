// report-card：报告库列表卡。
// isNew（!isRead && ready）→ 朱砂描边 +「军师刚写好」角标；
// generating → 转圈 +「军师正在执笔…」，不可点。
// 点击（仅 ready）triggerEvent('tap', {id, type})。标识符英文、注释中文。
import type { ReportListItem, ReportOrigin } from '../../utils/api';

const ORIGIN_LABEL: Record<ReportOrigin, string> = {
  user: '我请军师写的',
  agent: '军师执笔',
};

Component({
  options: { addGlobalClass: true },
  properties: {
    report: { type: Object, value: null as unknown as ReportListItem, observer: 'refresh' },
  },
  data: {
    isNew: false,
    isGenerating: false,
    isFailed: false, // 生成失败态
    originLabel: '',
    dateLabel: '',
    wordLabel: '',
  },
  lifetimes: {
    attached() {
      this.refresh();
    },
  },
  methods: {
    refresh() {
      const r = this.data.report as ReportListItem | null;
      if (!r || !r.id) return;
      this.setData({
        isNew: !r.isRead && r.status === 'ready',
        isGenerating: r.status === 'generating',
        isFailed: r.status === 'failed',
        originLabel: ORIGIN_LABEL[r.origin] || '军师执笔',
        dateLabel: formatDate(r.createdAt),
        wordLabel: r.wordCount ? `约 ${r.wordCount} 字` : '',
      });
    },
    onTap() {
      const r = this.data.report as ReportListItem | null;
      if (!r || r.status === 'generating') return; // 生成中不可点
      if (r.status === 'failed') {
        // 失败卡：请求重写（页面弹确认后重新生成）
        this.triggerEvent('retry', { id: r.id, type: r.type });
        return;
      }
      this.triggerEvent('tap', { id: r.id, type: r.type });
    },
  },
});

// ISO → 「今天 HH:MM」（当天）/「M月D日」（往日）
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `今天 ${hh}:${mm}`;
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
