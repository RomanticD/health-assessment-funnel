# 自动化测试证据

## 一键命令

```bash
pnpm test:unit       # 领域算法、投影、边界表
pnpm test:integration # Supabase migration + RPC + HTTP 集成
pnpm test:e2e        # 15 题浏览器流程、刷新、paywall、full reload
pnpm test             # unit + integration
pnpm verify           # format/lint/typecheck/coverage/build + stack
```

## 场景映射

| 场景                                                          | 测试位置                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| BMI、极端/缺失/非法身高体重年龄、目标方向                     | `tests/unit/health-assessment-v1.test.ts`                                           |
| 预测日期边界、维护目标、超长 horizon                          | `tests/unit/result-projection.test.ts`、`tests/unit/health-assessment-v1.test.ts`   |
| 分步保存、恢复、乱序、重复、并发 revision                     | `tests/integration/persistence-api.test.ts`、`tests/integration/funnel-api.test.ts` |
| 非会员脱敏、会员完整、受保护字段递归扫描                      | `tests/integration/access-payment-api.test.ts`                                      |
| `demo_readonly` fixture 可读、create/save/submit/pay 全部拒写 | `tests/integration/access-payment-api.test.ts`                                      |
| `/pay` 状态变化、幂等 replay、支付后 full                     | `tests/integration/access-payment-api.test.ts`                                      |
| session/cookie/Bearer/origin/BOLA/no-store                    | `tests/integration/http-boundaries.test.ts`                                         |
| 真实 15 题、刷新恢复、无 Web Storage、paywall、full reload    | `tests/e2e/funnel.spec.ts`                                                          |
| 在线 OpenAPI 文档与规范文件可访问                             | `tests/e2e/funnel.spec.ts`                                                          |

## 有意未覆盖

真实支付网关、邮箱账号迁移、跨设备分享和医学验证不属于当前产品范围。图表动画用 CSS + SVG 实现，视觉验收补充了 reduced-motion 分支和人工截图核对，不依赖脆弱的像素快照。
