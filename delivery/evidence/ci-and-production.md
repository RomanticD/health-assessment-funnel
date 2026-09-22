# CI 与线上证据

## CI

- Workflow：`.github/workflows/ci.yml`
- 本次发布 run：[#35700327086](https://github.com/RomanticD/health-assessment-funnel/actions/runs/35700327086)（commit `563a3c575f3f5ce29e4a3aed6bb7fa3d0cd8fa50`）
- Quality job：format、lint、typecheck、unit coverage、production build
- Integration/E2E job：Supabase stack、migration、HTTP 集成和 Chromium 全流程
- GitHub Actions 页面：https://github.com/RomanticD/health-assessment-funnel/actions

每次关键代码变更都先本地运行对应门禁，再 commit/push；最终以 GitHub Actions 的绿色 run 为远端证据。

## Vercel / Supabase

- URL：https://health-assessment-funnel.vercel.app
- `/api/health` 返回 `status: "ok"`、`service: "health-assessment-funnel"`、当前 release commit
- 当前线上 release：`563a3c575f3f5ce29e4a3aed6bb7fa3d0cd8fa50`（由 `/api/health` 只读确认）
- Supabase project ref：`kfyqgzuatywmsuruwsei`
- 远端 migration：`20260922002212_initial_health_assessment_schema`
- 远端业务表启用 RLS；浏览器只通过 Next server routes 访问 RPC

## 发布后 smoke

1. `GET /api/health`
2. 新 session → assessment → 15 题保存 → submit
3. 结果读取为 preview，递归确认不存在受保护字段
4. `/pay` 同 key replay，再读取为 full
5. paid fixture 只读 full；写入请求被 `demo_readonly` RPC 拒绝

若轮换 paid fixture，只更新 README/本目录的合成 session、assessment、expiry，并重新执行上述 smoke；不修改任何 secret。
