// 军师对话页（tab 根 1）。M1 只做空态骨架；M2 实现流式对话 / 今日一问 / suggestions。
Page({
  data: {
    streakDays: 0, // M1 占位，M5 由 GET /me 填充
  },
  onShow() {
    // 同步自定义 tabBar 选中态
    const tabBar = this.getTabBar?.();
    if (tabBar) {
      tabBar.setData({ active: 'chat' });
    }
  },
});
