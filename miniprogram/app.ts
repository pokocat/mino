// 米诺 V3 小程序入口
import { getToken } from './utils/request';
import { loadSerifFont } from './utils/fonts';
import { config } from './utils/config';

App<IAppOption>({
  globalData: {
    token: '',
    apiBaseUrl: config.baseUrl,
  },
  onLaunch() {
    // 1) 衬线字体异步加载（R3 第一步），失败静默降级，不阻塞后续启动
    loadSerifFont();

    // 2) 鉴权路由：有 token → 进 chat tab；无 → 留在/回到 onboarding
    const token = getToken();
    this.globalData.token = token;
    if (token) {
      // onboarding 是默认首页（非 tabBar 页）：已登录直接切到 tab 根
      wx.switchTab({ url: '/pages/chat/chat' });
    } else {
      // 无 token：确保停在登录页（onboarding 已是首页，reLaunch 保证干净栈）
      wx.reLaunch({ url: '/pages/onboarding/onboarding' });
    }
  },
});
