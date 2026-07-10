import { computeStreak, daysBetween, shanghaiYmd } from './streak.util';

/** 造一个 `@db.Date` 列读回值：UTC 零点的日历日（对应上海某日）。 */
function dateCol(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

describe('streak.util', () => {
  describe('shanghaiYmd（UTC → 上海日历日）', () => {
    it('UTC 15:59 仍算上海当日（+8 未跨日）', () => {
      // 2026-07-10 15:59Z → 上海 2026-07-10 23:59
      const ymd = shanghaiYmd(new Date('2026-07-10T15:59:00Z'));
      expect(ymd).toEqual({ y: 2026, m: 6, d: 10 });
    });
    it('UTC 16:01 已是上海次日（+8 跨日）', () => {
      // 2026-07-10 16:01Z → 上海 2026-07-11 00:01
      const ymd = shanghaiYmd(new Date('2026-07-10T16:01:00Z'));
      expect(ymd).toEqual({ y: 2026, m: 6, d: 11 });
    });
  });

  describe('daysBetween（跨月/跨年）', () => {
    it('跨月：1-31 → 2-01 差 1 天', () => {
      expect(
        daysBetween({ y: 2026, m: 0, d: 31 }, { y: 2026, m: 1, d: 1 }),
      ).toBe(1);
    });
    it('跨年：12-31 → 次年 1-01 差 1 天', () => {
      expect(
        daysBetween({ y: 2025, m: 11, d: 31 }, { y: 2026, m: 0, d: 1 }),
      ).toBe(1);
    });
  });

  describe('computeStreak', () => {
    // 固定「现在」为上海 2026-07-10 10:00（UTC 02:00）
    const now = new Date('2026-07-10T02:00:00Z');

    it('首次活跃（lastActiveDate=null）→ 重置为 1', () => {
      const r = computeStreak({ lastActiveDate: null, streakDays: 0, now });
      expect(r.streakDays).toBe(1);
      expect(r.changed).toBe(true);
      expect(r.lastActiveDate.toISOString()).toBe('2026-07-10T00:00:00.000Z');
    });

    it('昨天活跃 → +1', () => {
      const r = computeStreak({
        lastActiveDate: dateCol(2026, 7, 9),
        streakDays: 4,
        now,
      });
      expect(r.streakDays).toBe(5);
      expect(r.changed).toBe(true);
    });

    it('今天已活跃 → 不变、不写回（幂等）', () => {
      const r = computeStreak({
        lastActiveDate: dateCol(2026, 7, 10),
        streakDays: 5,
        now,
      });
      expect(r.streakDays).toBe(5);
      expect(r.changed).toBe(false);
    });

    it('断签（前天活跃）→ 重置为 1', () => {
      const r = computeStreak({
        lastActiveDate: dateCol(2026, 7, 8),
        streakDays: 9,
        now,
      });
      expect(r.streakDays).toBe(1);
      expect(r.changed).toBe(true);
    });

    it('跨月连续：昨天=6-30，今天=7-01 → +1', () => {
      const julyFirst = new Date('2026-07-01T02:00:00Z'); // 上海 7-01 10:00
      const r = computeStreak({
        lastActiveDate: dateCol(2026, 6, 30),
        streakDays: 3,
        now: julyFirst,
      });
      expect(r.streakDays).toBe(4);
      expect(r.changed).toBe(true);
    });

    it('UTC 边界：now=UTC 15:59（上海仍当日），昨天活跃 → +1', () => {
      // now 上海 = 2026-07-10 23:59；lastActiveDate = 7-09 → 差 1 天
      const late = new Date('2026-07-10T15:59:00Z');
      const r = computeStreak({
        lastActiveDate: dateCol(2026, 7, 9),
        streakDays: 2,
        now: late,
      });
      expect(r.streakDays).toBe(3);
      expect(r.changed).toBe(true);
    });

    it('UTC 边界：now=UTC 16:01（上海次日 7-11），7-10 活跃 → +1（而非不变）', () => {
      const nextDay = new Date('2026-07-10T16:01:00Z'); // 上海 7-11 00:01
      const r = computeStreak({
        lastActiveDate: dateCol(2026, 7, 10),
        streakDays: 6,
        now: nextDay,
      });
      expect(r.streakDays).toBe(7);
      expect(r.changed).toBe(true);
      expect(r.lastActiveDate.toISOString()).toBe('2026-07-11T00:00:00.000Z');
    });

    it('时钟回拨（lastActiveDate 在未来）→ 保守重置为 1', () => {
      const r = computeStreak({
        lastActiveDate: dateCol(2026, 7, 12),
        streakDays: 5,
        now,
      });
      expect(r.streakDays).toBe(1);
      expect(r.changed).toBe(true);
    });
  });
});
