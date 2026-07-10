/// <reference types="miniprogram-api-typings" />

// 全局 App 选项类型
interface IAppOption {
  globalData: {
    token: string;
    apiBaseUrl: string;
  };
  onLaunch?: () => void;
}
