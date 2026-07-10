// 衬线字体加载（R3 第一步）：封装 wx.loadFontFace。
// url 走 config 占位，可为空=直接降级系统衬线栈；失败静默降级，不阻塞启动。

import { config } from './config';

export function loadSerifFont(): void {
  // 无 url：不加载，直接用 tokens.wxss 的 --font-serif 系统栈兜底
  if (!config.serifFontUrl) {
    return;
  }
  wx.loadFontFace({
    family: config.serifFontFamily,
    source: `url("${config.serifFontUrl}")`,
    global: true, // 全局生效（含各 webview 页面）
    success: () => {
      // 加载成功：无需处理，样式已通过 font-family 命中
    },
    fail: () => {
      // 静默降级：保持系统衬线，不打断启动
    },
  });
}
