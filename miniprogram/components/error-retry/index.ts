// error-retry：统一网络错误占位（列表/详情首屏加载失败）。
// 文案「天机连线断了」+ 重试按钮，点击 triggerEvent('retry')。标识符英文、注释中文。
Component({
  options: { addGlobalClass: true },
  properties: {
    // 主文案可覆盖（默认「天机连线断了」）
    text: { type: String, value: '天机连线断了' },
    // 副文案
    hint: { type: String, value: '点一下，再试试。' },
  },
  methods: {
    onRetry() {
      this.triggerEvent('retry');
    },
  },
});
