-- per-user 记忆链路（@mastra/pg PgVector）依赖 pgvector 扩展。
-- 幂等：IF NOT EXISTS，重复 migrate deploy 不报错。向量表由 PgVector 运行时自建，不在此迁移内。
CREATE EXTENSION IF NOT EXISTS "vector";
