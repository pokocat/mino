// suggestion-chips：回复完成后的「接着聊」建议气泡列。
// items[{text, primary?, action?, reportType?}]；primary=深墨底金字（写报告项）。
// 点击 triggerEvent('select', {item, index})，具体语义（chat 发送 / generateReport 占位）由页面处理。
import type { SuggestionItem } from '../../utils/api';

Component({
  options: { addGlobalClass: true },
  properties: {
    items: { type: Array, value: [] as SuggestionItem[] },
  },
  methods: {
    onTap(e: WechatMiniprogram.TouchEvent) {
      const index = e.currentTarget.dataset.index as number;
      const item = (this.data.items as SuggestionItem[])[index];
      this.triggerEvent('select', { item, index });
    },
  },
});
