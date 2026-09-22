# AI 协作与否决记录

本页是交付包内的独立复盘；完整叙事见 [docs/ai-retrospective.md](../../docs/ai-retrospective.md)，P0 产品复审见 [plan/16-p0-product-review.md](../../plan/16-p0-product-review.md)。AI 被当作并行分析、实现和反例生成工具，最终结论以 migration、测试、线上 smoke 和人工复算为准。

## AI 参与的工作面

| 工作面          | AI 具体帮助                                                                                                                                                           | 人工/工具如何验收                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 需求与架构      | 将 15 题漏斗拆成 session、draft、submit、entitlement、payment 五个状态边界，并生成 traceability matrix                                                                | 逐项对照原始需求，最终状态写入 `delivery/evidence/requirements-matrix.md`            |
| 数据库建模      | 提出 `app_users`、`anonymous_sessions`、`assessments`、core inputs、funnel answers、basic/details result、subscriptions、payment events 和 idempotency records 的关系 | 空库 migration、Supabase Schema Visualizer、RLS/ACL 查询、真实 RPC 集成测试          |
| API 与类型      | 起草 strict Zod 输入、RFC 7807 Problem Details、ETag/If-Match、Idempotency-Key 和 OpenAPI 3.1                                                                         | `pnpm typecheck`、HTTP boundary tests、API cURL、线上 `/api-docs` 与 `/openapi.yaml` |
| 健康计算        | 起草 BMI、Mifflin-St Jeor、活动系数、目标速率和 projection                                                                                                            | 独立手算 oracle、Decimal 舍入、边界/性质测试、结果持久化 smoke                       |
| Mock 与测试数据 | 生成正常值、min/max、min-ε/max+ε、目标方向冲突、非有限数字、并发写入和只读 fixture 场景                                                                               | 同时经过 Zod、数据库 CHECK、RPC 错误码和 API 响应断言；fixture 线上只读验证          |
| 前端体验        | 提供单题节奏、刷新恢复、summary 叙事、paywall、毛玻璃锁定态和 reduced-motion 建议                                                                                     | Playwright Chromium 全流程、移动断点、键盘焦点、线上页面人工复核                     |
| 独立审查        | 后端、Supabase、前端和 CI 分方向寻找 BOLA、字段泄露、并发覆盖、交付缺项                                                                                               | 主 agent 重新运行完整 gate；不能以 agent 的“已通过”文字替代命令结果                  |

## 生成测试数据的策略

- 数值边界按 `min-ε / min / max / max+ε` 成组生成，验证应用层和 PostgreSQL 约束不会出现分层不一致。
- 目标体重同时测试方向正确、方向冲突、超过 40% 变化、BMI 不安全和 maintain 容差。
- 并发测试使用两个相同 revision 的请求，而不是依赖延时，验证只有一个请求能推进 revision。
- entitlement 测试从同一个 assessment 读取 preview/full，并递归扫描整个 JSON，确保锁定字段不会从 `meta`、错误对象或嵌套数组泄露。
- 公开 paid fixture 单独使用 `demo_readonly` 数据库身份；create、step、submit、pay 四类写入都必须在事务入口返回 `DEMO_SESSION_READ_ONLY`。

## 明确否决的 AI 方案

1. **先查询完整结果，再在 TypeScript 删除会员字段。** 这会让新增嵌套字段、日志或缓存成为泄露面。最终采用 basic/details 物理拆表和 preview/full 两套 allowlist，preview 查询本身不读取 details。
2. **把所有答案放进一个 JSONB。** 这会让年龄、身高、体重失去数据库级范围约束，也难以稳定查询。最终只有扩展题使用 JSONB，核心健康输入使用强类型列与 CHECK。
3. **把 subscription status 放进 JWT 或 user metadata。** 支付后 token 可能陈旧，取消/过期也无法即时回收；可编辑 metadata 不能承担授权。最终每次结果读取实时查询 subscription entitlement。
4. **算法 golden case 的错误 expected value。** 初稿把女性、32 岁、165 cm、68 kg 算成 overweight 且 BMR 1380；实际 BMI raw 约 24.98，分类应为 healthy_weight，Mifflin BMR 为 1390.25。该样例被否决，替换为人工复算的 70 kg case（BMI 25.7、BMR 1410、TDEE 1939、target 1551），避免实现和测试一起复制错误。

## AI 没有替代的判断

产品文案、健康免责声明、哪些输入需要强类型、preview 应该展示多少价值、session 是否能放进 URL、何时停止安全强化转向交付，均由人工结合风险和用户体验决定。真实支付 provider、账号体系、跨设备恢复和医学验证没有被伪称为已完成，而是在交付矩阵中明确标为当前范围外。
