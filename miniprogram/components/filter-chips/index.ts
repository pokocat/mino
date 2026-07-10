// filter-chips：报告库筛选条（全部 N + 4 类，计数来自 /reports/stats）。
// active='' 表示「全部」；点击 triggerEvent('change', {type})。标识符英文、注释中文。
import type { ReportStats } from '../../utils/api';

interface ChipOption {
  key: string; // '' | ReportType
  label: string;
  count: number;
}

Component({
  options: { addGlobalClass: true },
  properties: {
    active: { type: String, value: '' },
    counts: { type: Object, value: null as unknown as ReportStats, observer: 'refresh' },
  },
  data: { options: [] as ChipOption[] },
  lifetimes: {
    attached() {
      this.refresh();
    },
  },
  methods: {
    refresh() {
      const s = this.data.counts as ReportStats | null;
      const by = s ? s.byType : { strategy: 0, resume: 0, review: 0, decision: 0 };
      const total = s ? s.total : 0;
      this.setData({
        options: [
          { key: '', label: '全部', count: total },
          { key: 'strategy', label: '战略分析', count: by.strategy },
          { key: 'resume', label: '创业履历', count: by.resume },
          { key: 'review', label: '复盘战报', count: by.review },
          { key: 'decision', label: '决策记录', count: by.decision },
        ],
      });
    },
    onTap(e: WechatMiniprogram.TouchEvent) {
      const type = (e.currentTarget.dataset.key as string) || '';
      if (type === this.data.active) return;
      this.triggerEvent('change', { type });
    },
  },
});
