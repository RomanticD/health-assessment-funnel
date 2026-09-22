# 工程技术说明目录

这里是交付包中面向工程验收的详细说明。它解释当前 `main` 中后端、Supabase 数据库、自动化测试和 GitHub Actions 的关键难点、实现边界和验证方式；页面如何操作仍以 [交付验收入口](../README.md) 和 [UI 验收说明](../evidence/ui-acceptance.md) 为准。

## 文档索引

| 文档                                               | 重点                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [backend-architecture.md](backend-architecture.md) | API 分层、session 鉴权、15 题持久化、revision/ETag、幂等、服务端算法、preview/full 和 `/pay` 闭环 |
| [database-supabase.md](database-supabase.md)       | PostgreSQL 表关系、状态不变量、事务 RPC、RLS/ACL、结果字段分区、索引、fixture 和 Supabase 运维    |
| [testing-ci.md](testing-ci.md)                     | 47 个 unit、21 个 integration/API、3 个 Chromium E2E、覆盖率门槛、真实本地 stack、CI jobs 和证据  |

## 阅读这些文档时的边界

- 代码和 migration 是 source of truth；文档中的设计解释不会替代 [supabase/migrations](../../supabase/migrations/)、[src/server](../../src/server/) 或 [tests](../../tests/)。
- 当前支付是题目要求的可重放模拟支付，不声称接入真实 provider、退款、拒付或签名验签。
- 所有公开 fixture 和测试数据均为合成数据；session bearer credential 不是 Supabase key，不能用于修改公开 fixture。
- 线上运行证据、fixture 轮换、CI 和 smoke 结果分别见 [evidence/ci-and-production.md](../evidence/ci-and-production.md)、[evidence/supabase-fixture.md](../evidence/supabase-fixture.md) 和 [evidence/test-delivery.md](../evidence/test-delivery.md)。
