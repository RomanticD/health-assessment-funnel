# 测试、质量门禁与 GitHub Actions

## 1. 测试策略

本项目没有把测试当作只覆盖 happy path 的最后一步，而是按可证明的不变量分层：

| 层级                  |  当前规模 | 为什么放在这一层                                                                          | 主要代码                                                                                                                                                                         |
| --------------------- | --------: | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit / domain         | 47 passed | 公式、日期、目标合理性、preview/full allowlist 可以快速、确定地验证                       | [`tests/unit/health-assessment-v1.test.ts`](../../tests/unit/health-assessment-v1.test.ts)、[`tests/unit/result-projection.test.ts`](../../tests/unit/result-projection.test.ts) |
| Integration / HTTP    | 21 passed | session owner、revision、幂等、RLS、数据库 trigger 和 API mapping 必须经过真实 PostgreSQL | [`tests/integration/`](../../tests/integration/)、[`tests/support/with-test-stack.mjs`](../../tests/support/with-test-stack.mjs)                                                 |
| Playwright / Chromium |  3 passed | 只有真实浏览器才能证明 15 题点击节奏、刷新恢复、dialog focus、paywall、移动布局和结果动画 | [`tests/e2e/funnel.spec.ts`](../../tests/e2e/funnel.spec.ts)                                                                                                                     |

当前本地与 CI 使用合成数据；API/数据库测试不 mock repository，浏览器测试连接刚从 migration reset 的本地 Supabase stack。

## 2. Unit 覆盖的算法边界

`health-assessment-v1.test.ts` 使用人工复算的 golden case、边界表和固定 property-test seed 覆盖：

- BMI 分类阈值 18.5、25、30，以及 Decimal 舍入；
- Mifflin BMR、activity factor、TDEE、calorie floor/ceiling 和目标 calorie range；
- 日期跨月/跨年、projection 每周连续日期、单调性和 target-bounded 终点；
- 18/80 岁、120/230 cm、35/300 kg、目标体重 min/max 与 `min-ε`/`max+ε`；
- `NaN`、Infinity、负数、字符串注入、缺失值和未知字段；
- 减重/增重方向冲突、超过 40%、目标 BMI 越界、maintain 容差和 prediction horizon；
- 不可给出数字时的 warning 与 `targetDate: null`；
- preview 递归扫描，确保 `bmrKcal`、`tdeeKcal`、`targetDate`、`weightProjection` 等保护字段不存在于响应树。

这层不声称证明临床有效性；它证明固定的 `health-v1` 实现是确定、有限、可人工复算的。

## 3. Integration / HTTP 场景

`with-test-stack.mjs` 的每次运行都：

1. 检查或启动最小本地 Supabase；
2. `supabase db reset`，从零应用 migration 和 seed；
3. 用独立环境变量启动 Next.js `127.0.0.1:3110`；
4. 运行 integration Vitest；
5. 退出时清理 Next.js 子进程。

关键场景包括：

- session 创建、cookie/Bearer 解析、过期、撤销、冲突 credential、Origin 和 body size/content-type 防护；
- assessment 创建复用、15 题逐步保存、刷新恢复、乱序拒绝、重复同值重放；
- 两个相同 revision 并发写只有一个成功，stale ETag 返回 412 和当前 revision meta；
- 非 owner assessment 的统一 404/BOLA 防护，客户端不能提交 user id；
- submit 原子生成结果、重复 submit 幂等、目标不合理 422、completed 锁定；
- 未支付 preview 与支付后 full 的结构差异，递归保护字段断言；
- `/pay` 激活订阅、重复 payment idempotency、payment event owner FK、pay 后结果完整返回；
- publishable/anon 数据库角色无法读业务表，`demo_readonly` fixture 的 create/step/submit/pay 四类拒写。

HTTP 测试同时断言 RFC 7807 content type、稳定 error code、trace id、`private, no-store`、`Vary` 和 ETag，避免只验证 status code 而漏掉客户端真正依赖的协议。

## 4. Playwright 浏览器链路

`funnel.spec.ts` 的三条 Chromium 场景覆盖：

### 真实 15 题 funnel

- 390px mobile landing → CTA 创建 session → 15 个问题逐题点击；
- 每一步服务端保存，不使用 localStorage/sessionStorage；
- 中途刷新后恢复 body step，review 可编辑此前答案；
- submit 后 preview → 打开 paywall dialog → 键盘 focus → 模拟支付 → full result；
- full result 刷新后仍保持 entitlement，390px 没有横向溢出；
- 页面文案不泄露 algorithm、server-calculated 或安全 envelope 内部术语。

### 固定结果/checkout 入口

`/demo/paywall` 使用固定合成 DTO，不调用 Supabase：

- 直接验证 preview 的毛玻璃锁定态和 desktop/mobile 页面；
- 打开 checkout dialog，点击 `Unlock full summary — no charge`；
- 检查 full result 出现完整 energy/timeline 内容；
- 检查 projection chart 在进入视口前为 `data-animation-state="waiting"`，滚动到指定位置后变为 `visible`，CSS 动画才开始。

### API reference

验证 `/openapi.yaml` 返回 versioned OpenAPI 3.1，以及 `/api-docs` Swagger UI 能加载这份合约。

## 5. 覆盖率和质量门禁

`pnpm test:coverage` 对 versioned algorithm 和 result projection 设定至少 90% statements/lines/functions、85% branches；最近结果为 97.24% statements、92.59% branches、94.11% functions。API/数据库不依赖虚高的全局 coverage，而由真实 stack 场景覆盖。

一键命令：

```bash
pnpm test              # unit + integration
pnpm test:unit         # 纯领域单元测试
pnpm test:integration  # fresh Supabase + Next.js HTTP
pnpm test:e2e          # fresh Supabase + Chromium
pnpm test:stack        # integration + Playwright
pnpm test:coverage     # unit coverage threshold
pnpm verify            # format/lint/types/coverage/build/stack
```

## 6. GitHub Actions 设计

工作流文件是 [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)，在 push 和 pull request 上运行，并按 branch/workflow concurrency 取消旧 run。

### `quality` job

- Ubuntu runner、Node 22、锁文件 immutable install；
- `pnpm format:check`、ESLint zero warnings、Next typegen + TypeScript、unit coverage；
- production build；
- 即使失败也上传 `unit-coverage` artifact。

### `integration-e2e` job

- 独立 fresh runner，安装 Chromium 及系统依赖；
- `pnpm test:stack` 重建本地 Supabase、启动 Next.js、运行真实 integration 与 Playwright；
- 即使失败也上传 `playwright-report`、`test-results`，保留 14 天；
- Playwright 在 CI 使用 `failOnFlakyTests`，trace/screenshot/video 只在失败时保留，retry 不能把 flaky 当成最终绿色。

最近功能 commit `3b5a5c5` 对应的 [CI run #35739988212](https://github.com/RomanticD/health-assessment-funnel/actions/runs/35739988212) 的两个 jobs 均 success；随后文档提交对应的 [CI run #35740625970](https://github.com/RomanticD/health-assessment-funnel/actions/runs/35740625970) 也全绿。

## 7. 有意未覆盖的范围

- 真实支付 provider signature、拒付、退款、chargeback：题目只要求模拟 `/pay`，生产接入需要独立 webhook contract test；
- 真实邮箱账号、账号迁移、跨设备恢复：当前产品明确使用短期匿名 session；
- load/soak、灾备、所有浏览器 engine、pixel-diff visual regression：当前优先证明事务、权限、移动布局和 Chromium 主链路；
- BMI/热量公式的临床有效性：测试保证实现语义和边界，不把软件测试冒充医学研究。

更细的场景映射见 [evidence/test-map.md](../evidence/test-map.md)，测试交付摘要见 [evidence/test-delivery.md](../evidence/test-delivery.md)。
