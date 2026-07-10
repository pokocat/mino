/**
 * 连续天数（streak）日界计算 —— 纯函数，方案 R6。
 *
 * 取舍（显式声明，不依赖服务器本地时区）：
 *  - 「今天」以 Asia/Shanghai（固定 UTC+8，无夏令时）为准：把 UTC 时刻 +8h 后取其「日历年月日」。
 *  - `lastActiveDate` 来自 Prisma `@db.Date` 列，读回是「UTC 零点的 Date」，其年月日即当初写入的上海日历日，
 *    故直接取它的 UTC 年月日、**不再 +8**（否则会把日期整体前移一天）。
 *  - 回写的 lastActiveDate 一律取 `Date.UTC(y,m,d)`（UTC 零点），与 `@db.Date` 读写保持自洽。
 * 之所以用手工 +8 偏移而非 Intl：+8 是固定偏移、无 DST，手工偏移足够且零依赖、可在任意运行时区稳定复现。
 */

/** 一个「上海日历日」的年月日三元组。 */
export interface Ymd {
  y: number;
  m: number; // 0-11
  d: number;
}

/** 把任意时刻换算成 Asia/Shanghai（UTC+8）的日历年月日。 */
export function shanghaiYmd(now: Date): Ymd {
  const shifted = new Date(now.getTime() + 8 * 3600 * 1000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
  };
}

/** 读取 `@db.Date` 列（UTC 零点）的日历年月日（不做时区偏移，见文件头取舍）。 */
export function dateColumnYmd(date: Date): Ymd {
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth(),
    d: date.getUTCDate(),
  };
}

/** 把上海日历日转成可写回 `@db.Date` 的 Date（UTC 零点）。 */
export function ymdToDate(ymd: Ymd): Date {
  return new Date(Date.UTC(ymd.y, ymd.m, ymd.d));
}

/** 两个日历日相差的整天数（b - a），跨月/跨年由 UTC 毫秒差自然处理。 */
export function daysBetween(a: Ymd, b: Ymd): number {
  const ta = Date.UTC(a.y, a.m, a.d);
  const tb = Date.UTC(b.y, b.m, b.d);
  return Math.round((tb - ta) / 86400000);
}

/** streak 结算结果。 */
export interface StreakResult {
  streakDays: number;
  lastActiveDate: Date; // 回写值（UTC 零点，对应上海「今天」）
  changed: boolean; // 是否需要写回 users（今天已结算过则 false）
}

/**
 * 结算一次「今日活跃」：
 *  - lastActiveDate = 今天 → 不变（changed=false，幂等，当日再多次消息不重复 +1）
 *  - lastActiveDate = 昨天 → streakDays + 1
 *  - lastActiveDate 更早 / null → 断签（或首次），重置为 1
 */
export function computeStreak(params: {
  lastActiveDate: Date | null;
  streakDays: number;
  now: Date;
}): StreakResult {
  const today = shanghaiYmd(params.now);
  const todayDate = ymdToDate(today);

  if (!params.lastActiveDate) {
    return { streakDays: 1, lastActiveDate: todayDate, changed: true };
  }

  const last = dateColumnYmd(params.lastActiveDate);
  const diff = daysBetween(last, today);

  if (diff === 0) {
    // 今天已结算过：保持原值，不写回
    return {
      streakDays: params.streakDays,
      lastActiveDate: params.lastActiveDate,
      changed: false,
    };
  }
  if (diff === 1) {
    return {
      streakDays: params.streakDays + 1,
      lastActiveDate: todayDate,
      changed: true,
    };
  }
  // diff > 1（断签）或 diff < 0（时钟回拨/异常数据）：重置为 1
  return { streakDays: 1, lastActiveDate: todayDate, changed: true };
}
