// generating-modal：报告生成弹层（对照 05 屏）。
// phase='generating' → 蒙层 + 转圈 + 三步清单 + 「可先回去接着聊」；
// phase='success'   → 成功态（查看报告 / 继续聊）。
// 事件：close（收起，后台继续）/ view（查看报告，跳 detail）。标识符英文、注释中文。
import type { ReportType } from '../../utils/api';

const TYPE_LABELS: Record<ReportType, string> = {
  strategy: '战略分析',
  resume: '创业履历',
  review: '复盘战报',
  decision: '决策记录',
};

Component({
  options: { addGlobalClass: true },
  properties: {
    visible: { type: Boolean, value: false },
    phase: { type: String, value: 'generating' }, // 'generating' | 'success'
    topic: { type: String, value: '' },
    type: { type: String, value: 'strategy', observer: 'refresh' },
  },
  data: { typeLabel: '战略分析' },
  lifetimes: {
    attached() {
      this.refresh();
    },
  },
  methods: {
    refresh() {
      const t = this.data.type as ReportType;
      this.setData({ typeLabel: TYPE_LABELS[t] || '战略分析' });
    },
    onClose() {
      this.triggerEvent('close');
    },
    onView() {
      this.triggerEvent('view');
    },
    // 吞掉卡片内点击，避免冒泡到蒙层触发 close
    noop() {},
  },
});
