// paper-page：纸底 + 横纹背景容器，统一安全区 padding，各页复用。
// tabbar=true 时为底部 tabBar 留出高度；scroll=true 时内容区可纵向滚动。
Component({
  options: {
    // 允许外部 class（app.wxss 全局样式与 token 变量）作用到组件根
    addGlobalClass: true,
    multipleSlots: true,
  },
  properties: {
    tabbar: { type: Boolean, value: false },
    fill: { type: Boolean, value: false },
  },
});
