// nav-bar：衬线标题 + 字距，可选返回键与右侧 action（文本或具名 slot）。
// 顶部按状态栏高度撑开（wx.getWindowInfo），适配刘海屏。
Component({
  options: {
    addGlobalClass: true,
    multipleSlots: true, // 支持具名 slot="action"
  },
  properties: {
    title: { type: String, value: '' },
    back: { type: Boolean, value: false }, // 是否显示返回键
    actionText: { type: String, value: '' }, // 右侧文字动作（可选，或用 slot）
  },
  data: {
    statusBarHeight: 20, // px，attached 时以真实值覆盖
  },
  lifetimes: {
    attached() {
      const info = wx.getWindowInfo();
      this.setData({ statusBarHeight: info.statusBarHeight });
    },
  },
  methods: {
    onBack() {
      this.triggerEvent('back');
    },
    onAction() {
      this.triggerEvent('action');
    },
  },
});
