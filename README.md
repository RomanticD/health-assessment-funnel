# Health Assessment Funnel

面向睿迄科技全栈挑战的健康测评系统。目标链路是：匿名会话 → 分步持久化/恢复 → 服务端健康估算 → 非会员 preview → 模拟支付 → 会员 full result，并用自动化测试、CI、线上 smoke 和数据库安全证据证明闭环。

> 当前状态：规划与工程基线已完成，后端功能正在实现。Private GitHub repository 已建立，基础 Next.js production build 已通过；数据库 migration、API、测试与线上完整链路尚未完成，因此不要把当前版本当成最终交付。

## 技术方向

- Next.js App Router + TypeScript strict，前后端同一仓库/同一 deployable。
- Supabase PostgreSQL：versioned migrations、least-privilege ACL、RLS public fail-closed、事务 RPC。
- 256-bit opaque anonymous session；结果 preview/full 物理与 DTO 双重隔离。
- Vitest/fast-check、真实 PostgreSQL integration、Playwright、GitHub Actions。
- Vercel + Supabase 公网部署。

## 规划入口

完整计划从 [plan/README.md](./plan/README.md) 开始，包括需求追踪、API、Schema/ERD、安全边界、算法 oracle、测试矩阵、部署、风险、两天排期与 agent review。

## 本地基线

前置条件：Node.js 22、pnpm 10.10+、Docker Desktop。

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
```

复制 `.env.example` 为 `.env.local` 只在取得自己的 Supabase server secret 后进行；不得提交 `.env.local`。

## 预期目录说明

实现后将提供：

- `src/app/README.md`：前端 funnel、路由与交互状态。
- `src/server/README.md`：后端模块、用例、认证与扩展方式。
- `supabase/README.md`：连接、migration、ACL/RLS、seed/provision/rollback。
- `tests/README.md`：一键测试、R-ID 覆盖和已知未覆盖项。

API cURL、线上 URL、CI badge、paid demo session、ERD 与最终交付信息将在实现/验证后补入；在证据产生前不放占位“通过”状态。
