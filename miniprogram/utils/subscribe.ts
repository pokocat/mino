// 订阅消息授权封装（R4）。
// 在两个高意愿时机请求一次性订阅：a) 今日一问「开始聊」 b)「生成报告」触发 generate 前。
// 纪律：模板 id 为空数组时直接跳过、不调 API；用户拒绝静默不阻塞主流程；
// 每场景每日最多请求一次（storage 记日期）。

import { config, STORAGE_KEYS } from './config';

// 授权场景（对应 R4 两个高意愿时机）
export type SubscribeScene = 'dailyStart' | 'generateReport';

// 本地日期串 YYYY-MM-DD（用于「每场景每日一次」的去重键值）
function todayStr(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// 在高意愿时机请求订阅消息授权（不阻塞调用方，无返回值）。
export function requestSubscribe(scene: SubscribeScene): void {
  const tmplIds = config.subscribeTmplIds;
  // 未配置模板：跳过，避免空 tmplIds 调 API 报错
  if (!tmplIds || tmplIds.length === 0) return;

  // 每场景每日仅请求一次：命中今日记录即跳过
  const key = `${STORAGE_KEYS.subscribeDatePrefix}${scene}`;
  const today = todayStr();
  if (wx.getStorageSync(key) === today) return;
  // 请求前先记日期：无论用户接受/拒绝，今日不再打扰
  wx.setStorageSync(key, today);

  wx.requestSubscribeMessage({
    tmplIds,
    success: () => {
      /* 用户勾选结果由服务端配额侧消费，前端无需处理 */
    },
    fail: () => {
      /* 拒绝/异常静默：不阻塞主流程 */
    },
  });
}
