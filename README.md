# API Gateway Reseller

一个 OpenAI 兼容的 API 转发计费网关 MVP，包含：

- API Key 管理
- 钱包余额与账本流水
- 模型价格表
- `/v1/chat/completions` 与 `/v1/embeddings` 转发
- `/v1/responses` 转发与 Responses API 查询/取消/删除相关路径
- 非流式/流式响应转发
- token 用量、上游成本、客户扣费记录
- 用户后台与管理员后台

## 快速启动

```bash
cp .env.example .env
npm install
docker compose up -d postgres
npm run db:generate
cd packages/db && npx dotenv -e ../../.env -- npx prisma migrate dev --name init && cd ../..
npm run db:seed
npm run dev:api
```

另开一个终端：

```bash
npm run dev:web
```

默认地址：

- API: `http://127.0.0.1:4100`
- Web: `http://127.0.0.1:4101`

默认管理员账号来自 `.env`：

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

## 客户调用示例

Responses API：

```bash
curl http://127.0.0.1:4100/v1/responses \
  -H "Authorization: Bearer sk_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "input": "hello"
  }'
```

Chat Completions：

```bash
curl http://127.0.0.1:4100/v1/chat/completions \
  -H "Authorization: Bearer sk_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

## 生产部署提醒

- 修改 `.env` 里的 `JWT_SECRET`、`ADMIN_PASSWORD`、数据库密码和上游 API Key。
- API Key 只保存 hash，明文 key 只在创建时显示一次。
- 钱包扣费使用账本流水，余额更新和流水写入在同一个数据库事务内。
- 金额字段用 `Decimal`/PostgreSQL `numeric`，不要改成浮点数。
- 本地开发默认使用 Docker Postgres `127.0.0.1:55432` 和机器已有 Redis `127.0.0.1:6379`。
- 如果要使用 compose 里的 Redis，运行 `docker compose up -d redis`，并把 `.env` 的 `REDIS_URL` 改为 `redis://127.0.0.1:56379`。
