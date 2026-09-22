# 自动化测试交付证据

本项目把算法、数据库/API、浏览器链路和 CI 门禁分别放在可以独立复现的层级；所有测试数据均为合成数据，CI 不连接线上 Supabase。

## 一键命令

```bash
pnpm test              # unit + integration
pnpm test:unit         # 领域算法和结果投影
pnpm test:integration  # fresh local Supabase + HTTP/API 集成
pnpm test:e2e          # fresh local Supabase + Chromium
pnpm test:stack        # integration + Playwright on one fresh stack
pnpm test:coverage     # unit coverage thresholds
pnpm verify            # format/lint/typecheck/coverage/build + stack
```

## 测试链路与代码位置

| 层级                  |    当前结果 | 关键代码                                                                                                                                                                         | 覆盖内容                                                                                                                   |
| --------------------- | ----------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Unit / domain         |   47 passed | [`tests/unit/health-assessment-v1.test.ts`](../../tests/unit/health-assessment-v1.test.ts)、[`tests/unit/result-projection.test.ts`](../../tests/unit/result-projection.test.ts) | BMI/BMR/TDEE、日期、目标方向、边界与 preview 字段白名单                                                                    |
| Integration / HTTP    |   21 passed | [`tests/integration/`](../../tests/integration/)                                                                                                                                 | Supabase migration、分步保存/恢复、乱序/并发/幂等、BOLA、RLS fail-closed、preview/full、`/pay` 与 `demo_readonly` 四类拒写 |
| Playwright / Chromium |    3 passed | [`tests/e2e/funnel.spec.ts`](../../tests/e2e/funnel.spec.ts)、[`playwright.config.ts`](../../playwright.config.ts)                                                               | 15 题真实浏览器流程、刷新恢复、preview → checkout → full、固定结果入口、API reference 页面                                 |
| Stack runner          | fresh reset | [`tests/support/with-test-stack.mjs`](../../tests/support/with-test-stack.mjs)                                                                                                   | 从迁移重建本地 Supabase，启动 Next.js `127.0.0.1:3110`，串联 integration 与 E2E，并清理子进程                              |

Playwright 的三条场景分别验证完整 15 题漏斗、无需填写问卷的结果/checkout 入口，以及公网 API reference 的 OpenAPI 文件与 Swagger 页面。测试使用移动和桌面 viewport、dialog focus、无横向溢出、无 Web Storage 健康数据和支付后刷新保持 entitlement 等断言；完整结果页还会确认趋势图在进入视口前保持 `waiting`，滚动到图表后才切换为 `visible` 并播放动画。

## GitHub Actions 门禁

工作流文件：[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)。工作流包含两个 job：

1. `quality`：Node 22、锁文件安装、Prettier、ESLint、Next typecheck、unit coverage 和 production build。
2. `integration-e2e`：安装 Chromium，执行 `pnpm test:stack`，真实运行本地 Supabase integration 与 Playwright；无论成功或失败都会上传 `playwright-report`、`test-results`，并保留 14 天。

Playwright 配置开启 `failOnFlakyTests`（CI 环境）、CI retry 仅用于诊断冷启动问题、trace/screenshot/video retain-on-failure；因此 retry 后的 flaky 不会被当作绿色通过。

最终已通过的 CI：[run #35734343090](https://github.com/RomanticD/health-assessment-funnel/actions/runs/35734343090)。该 run 的 quality 与 integration-e2e 均为 success；本地同样复跑 47 unit、21 integration、3 Chromium E2E。

## 覆盖率与边界

最近本地 `pnpm test:coverage`：97.24% statements、92.59% branches、94.11% functions。真实支付 provider、退款/拒付、账号迁移、跨设备分享、临床有效性和全浏览器矩阵属于当前产品范围之外；原因与替代验证见 [`tests/README.md`](../../tests/README.md) 和 [`test-map.md`](./test-map.md)。
