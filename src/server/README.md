# Backend

`src/server` 是被 Next.js Route Handlers 调用的 framework-light 后端核心。HTTP 与数据库都是适配层，业务规则不依赖 Next.js request 对象或 Supabase SDK。

依赖方向：

```text
http adapters → application use cases → domain
                    ↓
              infrastructure
```

- `domain`：纯健康算法、结果投影和业务值对象。
- `application`：create/recover/save/submit/result/pay 用例及存储端口。
- `infrastructure`：Supabase RPC adapter、server-only client、clock 与脱敏日志。
- `http`：session 解析、Origin、Problem Details、precondition、幂等与响应 header。

## 请求不变量

- 浏览器使用 `__Host-health_session` HttpOnly Cookie，CLI 使用 bearer；二者冲突时拒绝，不静默选取。
- Cookie 参与的 unsafe method 必须携带与 `APP_ORIGIN` 完全一致的 `Origin`。
- JSON body 最大 16 KiB；Zod strict schema 拒绝未知字段、NaN、Infinity 和越界值。
- 分步保存和 submit 要求 `If-Match: "rev-N"`；数据库事务内再次检查 revision。
- create/save/submit/pay 要求 16–128 字符 `Idempotency-Key`；相同 key + 同请求重放，相同 key + 不同请求返回 409。
- owner 由 session digest 在 RPC 内派生，客户端从不提交 `userId`。

## 结果权限

`GET .../result` 每次实时读取 subscription：

- `preview`：BMI、分类、模糊热量区间、锁定字段列表；响应对象不存在 BMR、TDEE、精确热量、日期或曲线。
- `full`：付费后返回完整 allowlist DTO。

Supabase secret 仅在 server runtime。RLS/ACL 让公开 Data API fail closed；BOLA 由同一事务中解析 session digest、验证 owner 的 RPC 保证。错误通过稳定应用 code 映射为 RFC 7807，不把 SQL、stack、session 或健康 payload 写回客户端/日志。

## 扩展方式

- 新问卷：新增 `quizVersion` 与对应 contract/RPC，不改变已提交结果语义。
- 新算法：新增算法版本并保存 input snapshot；不要原地重算历史结果。
- 真支付：用 provider webhook adapter 替换 `/pay` 的 mock event，同时保持 application entitlement 接口。
- 新存储：实现 `AssessmentStore` 端口；domain/application 测试无需改变。
