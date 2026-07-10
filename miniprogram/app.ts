// 米诺 V3 小程序入口
// globalData 仅放最小地基占位；鉴权/用户态在 M1 补充。
App<IAppOption>({
  globalData: {
    token: '',
    // 后端基础地址（M1 接入登录时由构建配置注入，此处占位）
    apiBaseUrl: '',
  },
  onLaunch() {
    // M1：读取本地 token、静默登录等在此实现
  },
});
