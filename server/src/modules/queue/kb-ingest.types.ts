/** kb.ingest 队列名。 */
export const KB_INGEST_QUEUE = 'kb-ingest';

/** kb.ingest job 载荷：一轮对话的会话与消息 id。 */
export interface KbIngestJobData {
  conversationId: string;
  /** 该轮 user + assistant 消息 id（供提取要点）。 */
  messageIds: string[];
}

/** 建立 BullMQ 连接选项：从 redis:// URL 解析出 host/port/username/password/db。 */
export function parseRedisUrl(url: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
} {
  const u = new URL(url);
  const db = u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0;
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    db: Number.isFinite(db) ? db : 0,
  };
}
