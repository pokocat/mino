// detail-action-bar：报告详情底部操作条。
// 主按钮（跟军师聊/补充这份报告）+ 副按钮（↧ 导出 / ✎ 补充，本期占位）。
// icon: 'export' → ↧；'edit' → ✎。triggerEvent('primary')/('secondary')。标识符英文、注释中文。
Component({
  options: { addGlobalClass: true },
  properties: {
    primaryText: { type: String, value: '跟军师聊这份报告' },
    icon: { type: String, value: 'export', observer: 'refresh' }, // 'export' | 'edit'
  },
  data: { iconChar: '↧' },
  lifetimes: {
    attached() {
      this.refresh();
    },
  },
  methods: {
    refresh() {
      this.setData({ iconChar: this.data.icon === 'edit' ? '✎' : '↧' });
    },
    onPrimary() {
      this.triggerEvent('primary');
    },
    onSecondary() {
      this.triggerEvent('secondary');
    },
  },
});
