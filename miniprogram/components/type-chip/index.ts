// type-chip：报告 4 类型 → 4 色映射的小 chip。
// 可选 suffix（如「· 第一篇」）拼在类型名后。标识符英文、注释中文。
import type { ReportType } from '../../utils/api';

const LABELS: Record<ReportType, string> = {
  strategy: '战略分析',
  resume: '创业履历',
  review: '复盘战报',
  decision: '决策记录',
};

Component({
  options: { addGlobalClass: true },
  properties: {
    type: { type: String, value: 'strategy', observer: 'refresh' },
    suffix: { type: String, value: '', observer: 'refresh' },
  },
  data: { label: '战略分析' },
  lifetimes: {
    attached() {
      this.refresh();
    },
  },
  methods: {
    refresh() {
      const type = this.data.type as ReportType;
      const base = LABELS[type] || LABELS.strategy;
      this.setData({ label: this.data.suffix ? `${base} ${this.data.suffix}` : base });
    },
  },
});
