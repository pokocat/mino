// detail-action-bar：报告详情底部操作条。
// 主按钮（跟米诺聊/补充这份报告）+ 副按钮（↧ 导出 / ✎ 补充）。
// 单副按钮：传 icon（'export' | 'edit'，向后兼容三类现有用法）。
// 双副按钮：传 icons（如 ['edit','export']，非空时覆盖 icon）。
// icon: 'export' → ↧；'edit' → ✎。triggerEvent('primary')；('secondary', { icon }) 区分按了哪个。
Component({
  options: { addGlobalClass: true },
  properties: {
    primaryText: { type: String, value: '跟米诺聊这份报告' },
    icon: { type: String, value: 'export', observer: 'refresh' }, // 单副按钮
    icons: { type: Array, value: [], observer: 'refresh' }, // 多副按钮（非空覆盖 icon）
  },
  data: { secondaries: [] as Array<{ icon: string; char: string }> },
  lifetimes: {
    attached() {
      this.refresh();
    },
  },
  methods: {
    refresh() {
      const src =
        this.data.icons && this.data.icons.length
          ? (this.data.icons as string[])
          : [this.data.icon];
      this.setData({
        secondaries: src.map((ic) => ({ icon: ic, char: ic === 'edit' ? '✎' : '↧' })),
      });
    },
    onPrimary() {
      this.triggerEvent('primary');
    },
    onSecondary(e: WechatMiniprogram.TouchEvent) {
      this.triggerEvent('secondary', { icon: e.currentTarget.dataset.icon });
    },
  },
});
