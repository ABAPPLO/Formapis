# Formapis 云平台架构设计

> 状态：设计确认阶段，待实现
> 创建时间：2026-07-25
> 最后更新：2026-07-25
> 关联项目：Formapis（本地）+ formapis-cloud（待建）

---

## 一、目标

搭建 Formapis 云平台（`formapis.cloud`），让用户可以在云端构建、管理和执行 agent，无需本地环境。

### 核心约束

- **agent CLI 直接装在云端 VPS**：claude/codex/hermes 等在云端运行，不需要下发到本地
- **用户 API key 加密同步到云端**：三重加密（传输 + 存储 + 使用隔离），用户可随时撤销
- **四端一套 UI**：桌面端、Web 端、云端 Web 共享同一套 React 代码，移动端独立
- **云端是完整执行环境**：编排 + agent CLI + API key 都在云端，本地 Formapis 只负责数据同步

---

## 二、两种模式

用户可选择两种云端模式（可随时切换）：

### 模式 A：云上同步（完整云端环境）

```
用户在 Web 上操作 → 云端 Formapis（per-user 隔离）
                    ├── agent YAML（从本地同步）
                    ├── skill / plugin / MCP（从本地同步）
                    ├── workflow / scenario（从本地同步）
                    ├── API key（加密同步）
                    └── agent CLI（云端 VPS 预装）

执行流程：
云端编排引擎创建 task → 云端 agent CLI 直接执行 → 结果存云端 DB
（全部在云端完成，不涉及本地）
```

### 模式 B：仅中继（网络穿透，不同步）

```
用户手机/浏览器 → 中继服务器 → 用户本地 Formapis
                   (WebSocket 透传，不碰数据)
                   (agent CLI 在本地跑)
                   (和官方 Orca Cloud relay 功能相同)
```

---

## 三、整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│  formapis.cloud（云平台）                                         │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────────┐   │
│  │  Web 前端     │   │  用户认证     │   │  Agent 市场(可选)  │   │
│  │  (共享 UI)   │   │  (JWT/OAuth) │   │  (共享 agent)     │   │
│  └──────┬───────┘   └──────┬───────┘   └───────────────────┘   │
│         │                  │                                     │
│  ┌──────┴──────────────────┴──────────────────────────────┐    │
│  │                    API 网关                              │    │
│  │  /api/sync  /api/relay  /api/agent-keys  /api/run       │    │
│  └──────┬─────────────┬──────────────┬────────────────┬────┘    │
│         │             │              │                │          │
│  ┌──────▼──────┐ ┌────▼─────────┐ ┌──▼──────────┐ ┌──▼───────┐ │
│  │ 同步服务     │ │ 中继服务      │ │ Key 管理     │ │ 编排引擎  │ │
│  │ (per-user)  │ │ (WS proxy)   │ │ (AES-256)   │ │ (+agent  │ │
│  │             │ │              │ │             │ │  CLI 执行)│ │
│  └──────┬──────┘ └────┬─────────┘ └──┬──────────┘ └──┬───────┘ │
│         │             │              │                │          │
│    ┌────▼────┐  ┌─────▼─────┐  ┌────▼────┐    ┌──────▼──────┐  │
│    │PostgreSQL│  │WebSocket │  │Key 存储  │    │Per-user HOME│  │
│    │per-user │  │转发       │  │(加密)   │    │+ agent CLI  │  │
│    └─────────┘  └─────┬────┘  └─────────┘    └─────────────┘  │
└────────────────────────┼─────────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              │  模式 B 用户的本地    │
              │  Formapis（仅中继）  │
              │  agent 在本地跑      │
              └─────────────────────┘
```

---

## 四、关键设计决策

### 4.1 云端 agent 谁来执行？

**云端直接执行。** agent CLI 安装在云端 VPS，用户 API key 加密同步到云端。

- 云端编排引擎创建 task DAG → 云端 agent CLI 直接执行 → 结果存云端 DB
- 用户在 Web 上看到完整的执行过程和结果
- 不需要下发到本地（本地 Formapis 只负责数据同步，不参与执行）
- 模式 B（仅中继）仍为本地执行

### 4.2 多租户隔离

**MVP：DB 层隔离（user_id 列）+ per-user HOME 目录**

```
共享 Formapis runtime 进程
├── orchestration.db
│   ├── tasks / coordinator_runs 加 user_id 列
│   └── 查询带 WHERE user_id = ?
├── per-user 文件隔离
│   ├── /home/formapis/users/user-A/.claude/config.json
│   ├── /home/formapis/users/user-B/.claude/config.json
│   └── agent CLI 用 HOME=<user-dir> 启动
└── coordinator 按 user_id 调度
```

长期升级路径：Docker per user（进程级隔离）

### 4.3 Web 能看到什么？

| 模式 | Web 能看到 | 实时性 |
|------|-----------|--------|
| 模式 A（云上同步） | 全部（agent 执行在云端，Web 直连云端 runtime） | 实时（含终端 PTY 流） |
| 模式 B（仅中继） | 全部（经中继连本地，和桌面端一样） | 实时 |

> 模式 A 改为云端执行后，Web 可以看到实时终端（因为 agent 在云端跑，PTY 流直接在云端 runtime 里）。

### 4.4 四端架构：一套 UI 代码，多个入口

| 维度 | 桌面端 | Web 端 | 云端 Web | 移动端 App |
|------|--------|--------|---------|-----------|
| 代码 | `App.tsx` | 同一个 | 同一个 | `mobile/`（独立） |
| 布局 | 一样 | 一样 | 一样 | 不同（React Native） |
| 启动 | `pnpm dev` | `pnpm dev:web` | 访问域名 | `npx expo start` |
| agent 执行 | 本地 | 经中继连本地 | **云端执行** | 经中继连本地 |
| 数据来源 | 本地文件 | 中继连本地 | 云端 DB | 中继连本地 |

数据层抽象（现有 `callRuntimeRpc` 加第三种 target）：

```ts
type RuntimeClientTarget =
  | { kind: 'local' }        // 桌面端（Electron IPC）
  | { kind: 'environment' }  // Web 端（WebSocket 中继）
  | { kind: 'cloud' }        // 云端（HTTP API）← 新增
```

所有现有 UI 组件零改动适配云端。

云端新增入口：

```
src/renderer/src/cloud/
├── main.tsx                ← 云端入口
├── CloudAuth.tsx           ← 登录界面
└── cloud-preload-api.ts    ← window.api → fetch /api/*
```

### 4.5 API key 安全同步方案

agent CLI 装在云端，用户的 API key 需要安全同步上去。

**三层安全：**

| 层 | 措施 |
|----|------|
| 传输 | TLS (HTTPS) + 应用层 AES-256-GCM 双重加密 |
| 存储 | PostgreSQL 只存密文，主密钥从用户密码派生 (PBKDF2)，无密码解不开 |
| 使用 | per-user HOME 隔离，agent 执行后清理 key 文件 (tmpfs) |

**存储结构：**

```
agent_keys 表:
├── user_id / agent_type / key_cipher (AES-256) / key_hash (sha256)
├── created_at / last_used
└── 用户可随时 Revoke All → 立即删除
```

**设计决策：**
- 不验证 key 有效性（上传就存，agent 用的时候自然知道好不好使）
- 不复用 orca 的 OS keychain（云端没有用户的 OS keychain）
- key 可随时撤销

**API：**

```
POST   /api/agent-keys/upload     ← 加密上传
GET    /api/agent-keys/list        ← 查询（只返回 hash）
DELETE /api/agent-keys/:agent      ← 撤销单个
DELETE /api/agent-keys             ← 撤销全部
```

---

## 五、数据同步设计

### 同步范围

```
本地 ~/.formapis/              云端 PostgreSQL (per-user)
├── agents/*.yaml     ◄─同步─►  agents 表
├── scenarios/*.yaml  ◄─同步─►  scenarios 表
├── resources/        ◄─同步─►  resources 表
├── workflow-history/ ◄─同步─►  history 表
└── agent API keys    ◄加密同步►  agent_keys 表（见 4.5）

不同步:
├── agent CLI 二进制（云端 VPS 预装）
└── 本地 git worktree（用户可选上传 repo）
```

### 同步策略

- **首次连接**：本地 → 云端全量推送
- **后续**：增量同步（基于 mtime / 版本号）
- **冲突处理**：Last-Write-Wins，冲突时提示用户选择
- **触发点**：创建/修改 agent/scenario/resource 时自动推送

---

## 六、技术架构

### 6.1 云平台后端（新建项目 `formapis-cloud`）

```
formapis-cloud/
├── server/
│   ├── auth/                 ← JWT / OAuth 认证
│   ├── sync/                 ← 数据同步 API
│   ├── relay/                ← WebSocket 中继服务
│   ├── runtime/              ← 共享编排引擎 + agent CLI 执行
│   │   ├── namespaced-db.ts  ← orchestration DB + user_id
│   │   ├── agent-executor.ts ← per-user HOME 启动 agent CLI
│   │   └── coordinator-pool.ts
│   ├── keys/                 ← API key 加密存储
│   └── market/               ← Agent 市场（可选）
├── web/                      ← 复用 Formapis renderer
├── docker-compose.yml        ← 一键部署
└── Dockerfile
```

### 6.2 本地 Formapis 新增

```
src/main/cloud/
├── cloud-sync.ts             ← 同步引擎
├── cloud-relay-client.ts     ← 中继客户端
├── cloud-auth.ts             ← 云端认证
└── cloud-key-sync.ts         ← API key 加密上传

Settings 新增 "Cloud" 面板:
├── 连接云端（登录）
├── 模式选择：[云上同步] / [仅中继] / [断开]
├── Agent Key 同步（per-agent 开关 + Revoke All）
├── 同步状态（最后同步时间 / 冲突）
└── 手动同步按钮
```

### 6.3 API 设计

```
# 认证
POST /api/auth/register        → { token }
POST /api/auth/login           → { token }

# 数据同步
POST /api/sync/push            ← 推数据
GET  /api/sync/pull?since=     → 拉增量
POST /api/sync/conflict/resolve

# Agent key
POST   /api/agent-keys/upload
GET    /api/agent-keys/list
DELETE /api/agent-keys/:agent
DELETE /api/agent-keys

# 中继
POST /api/relay/register       → { relayUrl, deviceToken }
WS   /relay/<roomId>           ← 双向透传

# 编排执行
POST /api/run/scenario         ← 云端运行（agent CLI 在云端跑）
GET  /api/run/status
GET  /api/run/history          ← 执行历史
```

### 6.4 编排执行流程（模式 A，全云端）

```
Web 上点 "Run workflow"
    │
    ▼
云端编排引擎：创建 task DAG（namespaced by user_id）
    │
    ▼
云端 coordinator 调度 task
    │
    ├── 从 agent_keys 表解密该用户的 API key
    ├── 写入 /home/formapis/users/<user>/.claude/config.json
    │
    ▼
启动 agent CLI（HOME=per-user-dir claude --print "..."）
    │
    ├── agent 在云端执行（访问云端 repo clone 或纯对话任务）
    ├── worker_done → 结果存云端 DB
    │
    ▼
清理临时 key 文件
    │
    ▼
Web 端实时看到执行过程（PTY 流在云端 runtime）
```

### 6.5 中继服务设计（模式 B）

```
中继服务器（Node.js WebSocket Proxy）:
├── 连接池：per-user room（local + phone/browser 配对）
├── 设备配对：token 认证
├── WebSocket 透传（不解密）
├── 心跳检测（清理断连）
└── 不存储任何用户数据
```

比官方 Orca Cloud relay 简单：不需要 cell assignment + E2EE key exchange，用设备 token + WebSocket room。后续可加 E2EE（复用 orca 的 e2ee-crypto.ts）。

---

## 七、技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 后端语言 | Node.js (TypeScript) | 和 Formapis 同栈，复用代码 |
| 数据库 | PostgreSQL（生产）/ SQLite（开发） | orchestration DB 已用 SQLite，可平滑迁移 |
| 用户认证 | JWT + 可选 OAuth | 简单起步，后续接 GitHub/Google |
| 中继协议 | WebSocket room | 比官方 relay 简单，后续加 E2EE |
| Key 加密 | AES-256-GCM + PBKDF2 | 工业标准，不依赖 OS keychain |
| 编排隔离 | DB user_id 列 + per-user HOME | MVP 最轻量 |
| 部署 | Docker Compose | 一键部署（DB + 中继 + runtime + agent CLI） |

---

## 八、实现计划

### Phase C1：中继服务（模式 B 基础）

**目标**：外部设备经中继访问本地 Formapis

```
交付物:
├── formapis-cloud/server/relay/
│   ├── relay-server.ts       ← WebSocket 代理
│   ├── room-manager.ts       ← 设备配对/房间
│   └── device-auth.ts        ← 设备 token
├── 本地 Formapis: src/main/cloud/cloud-relay-client.ts
│   ← 出站连中继，注册设备
├── Settings "Cloud" 面板（模式选择 + 中继开关）
└── docker-compose.yml（中继服务一键部署）

验证: 手机/浏览器经中继连本地 Formapis，看到完整界面
```

### Phase C2：用户认证 + 数据同步

**目标**：用户注册/登录，agent/scenario/resource 双向同步

```
交付物:
├── formapis-cloud/server/auth/       ← JWT 认证
├── formapis-cloud/server/sync/       ← 同步 API
├── 本地: src/main/cloud/cloud-sync.ts ← 推/拉引擎
├── 本地: src/main/cloud/cloud-auth.ts ← 登录/token 存储
└── 同步触发点（创建 agent/scenario 时自动推送）

验证: 本地建 agent → 自动同步到云端 → Web 端看到
```

### Phase C3：API key 同步 + 云端 agent 执行

**目标**：用户 API key 加密上传，云端 agent CLI 执行 task

```
交付物:
├── formapis-cloud/server/keys/       ← Key 加密存储
├── formapis-cloud/server/runtime/
│   ├── agent-executor.ts             ← per-user HOME 启动 agent
│   └── namespaced-db.ts              ← orchestration DB + user_id
├── 本地: src/main/cloud/cloud-key-sync.ts ← 加密上传 key
├── 云端 VPS 安装 agent CLI（claude/codex/gemini）
└── Settings: Agent Key 同步 UI

验证: Web 上 Run workflow → 云端 agent 执行 → 结果回显
```

### Phase C4：云端 Web 入口

**目标**：完整的云端 Web 体验（复用 Formapis UI）

```
交付物:
├── src/renderer/src/cloud/
│   ├── main.tsx                      ← 云端入口
│   ├── CloudAuth.tsx                 ← 登录/注册
│   └── cloud-preload-api.ts          ← window.api → fetch /api/*
├── callRuntimeRpc 加 { kind: 'cloud' } target
└── Nginx/Caddy 反代 + HTTPS

验证: 访问 formapis.cloud → 登录 → 看到 Resources/Agents/Workflow
```

### Phase C5：Agent 市场（可选）

**目标**：用户之间共享/发现/安装 agent

```
交付物:
├── formapis-cloud/server/market/     ← 分享/搜索 API
├── Web: Agent 市场页面
└── 一键安装到自己的 namespace

验证: 用户 A 发布 agent → 用户 B 搜索 → 一键安装
```

### 计划总览

| 阶段 | 内容 | 周期 | 前置 |
|------|------|------|------|
| C1 | 中继服务 | 1-2 周 | 无 |
| C2 | 认证 + 数据同步 | 2-3 周 | C1 |
| C3 | API key + 云端 agent 执行 | 2-3 周 | C2 |
| C4 | 云端 Web 入口 | 1-2 周 | C3 |
| C5 | Agent 市场（可选） | 1-2 周 | C4 |

---

## 九、和现有 Formapis 的关系

```
现有 Formapis（本地）              云平台（新建）
─────────────────                  ──────────────
桌面端 + Web 端                    Web 端（复用 renderer）+ 后端（新建）
~/.formapis/ 存储                  PostgreSQL 存储
orchestration DB                   namespaced orchestration DB
agent CLI 本地跑                   agent CLI 云端跑（模式 A）/ 本地跑（模式 B）
A2A 对外                           对内（Web 用户）+ 对外（A2A）
```

本地 Formapis 新增：
- Settings → "Cloud" 面板
- `src/main/cloud/` 同步引擎 + 中继客户端 + key 上传
- 同步触发点

---

## 十、和 orca 原有功能的关系

| orca 原有能力 | 在云平台中的角色 |
|-------------|----------------|
| `orca serve`（无头模式） | 云端实例用 serve 模式跑 |
| Runtime Server（HTTP + WS） | 云端实例复用，加 user_id 隔离 |
| Pairing（配对） | 中继服务复用配对概念，简化为 WebSocket room |
| Orca Cloud Relay | 被自建中继替代 |
| E2EE（tweetnacl） | 可复用加到自建中继（后续增强） |
| A2A | 云平台也暴露 A2A |
| claude-accounts/keychain | 不复用（依赖 OS keychain），改用数据库加密 |
| speech/openai-api-key-store | 不复用（依赖 safeStorage），改用数据库加密 |
