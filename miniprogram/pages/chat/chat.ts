// 军师对话页（tab 根 1）。M2 实现流式对话 / 今日一问 / suggestions。
Page({
  data: {
    title: '军师对话',
  },
  onShow() {
    // 同步自定义 tabBar 选中态
    const tabBar = this.getTabBar?.();
    if (tabBar) {
      tabBar.setData({ active: 'chat' });
    }
  },
});
