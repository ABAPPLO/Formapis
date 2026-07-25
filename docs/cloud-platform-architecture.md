# Formapis 云平台架构设计

> 状态：设计确认阶段，待实现
> 创建时间：2026-07-25
> 关联项目：Formapis（本地）+ formapis-cloud（待建）

## 一、目标

搭建一个 Formapis 云平台（`formapis.cloud`），提供两种服务模式：

1. **云上同步模式**：用户在 Web 上构建/管理 agent + workflow，数据双向同步到本地，云端编排 + 本地执行
2. **仅中继模式**：纯网络穿透，外部设备经中继访问用户本地 Formapis，不碰数据

### 核心约束

- **agent CLI（claude/codex/hermes）永远在本地执行**：需要本地文件系统、API key、终端
- **云端角色**：编排大脑 + 数据中心 + 网络中继，不是 agent 执行环境
- **Web 看本地执行**：模式 A 看 task 状态/结果；模式 B 经中继透传看全部（含实时终端）

---

## 二、两种模式

### 模式 A：云上同步（数据同步 + 共享编排）

```
用户在 Web 上操作 → 云端 Formapis 实例（共享，user_id 隔离）
                    ├── agent YAML（从本地同步）
                    ├── skill / plugin / MCP（从本地同步）
                    ├── workflow / scenario（从本地同步）
                    └── 编排引擎（创建 task DAG）

数据双向同步：
本地 Formapis ◄────同步────► 云端
(改了 agent → 推到云)        (云上改了 → 拉回本地)

编排执行流程：
云端编排引擎创建 task → 中继下发到本地 → 本地 agent CLI 执行 → 结果回传云端
```

### 模式 B：仅中继（穿透，不同步）

```
用户手机/浏览器 → 中继服务器 → 用户本地 Formapis
                   (只转发，不碰数据)
                   (agent 在本地跑)
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
│  │  (构建/编排)  │   │  (注册/登录)  │   │  (共享 agent)     │   │
│  └──────┬───────┘   └──────┬───────┘   └───────────────────┘   │
│         │                  │                                     │
│  ┌──────┴──────────────────┴──────────────────────────────┐    │
│  │                    API 网关                              │    │
│  │  /api/sync    /api/relay    /api/agents    /api/run     │    │
│  └──────┬─────────────┬──────────────────────────────┬─────┘    │
│         │             │                              │          │
│  ┌──────▼──────┐ ┌────▼─────────┐ ┌─────────────────▼───────┐  │
│  │ 同步服务     │ │ 中继服务      │ │ 编排引擎(共享)           │  │
│  │ (per-user   │ │ (WebSocket   │ │ + user_id 隔离           │  │
│  │  存储)      │ │  proxy)      │ │ (task DAG 创建/调度)     │  │
│  └──────┬──────┘ └────┬─────────┘ └─────────────────┬───────┘  │
│         │             │                              │          │
└─────────┼─────────────┼──────────────────────────────┼──────────┘
          │             │                              │
    ┌─────▼─────┐ ┌─────▼──────┐              ┌───────▼───────┐
    │ 用户数据   │ │ WebSocket  │              │ 共享 Formapis │
    │ PostgreSQL│ │ 转发       │              │ runtime      │
    │ 或 SQLite │ │            │              │ (orchestration│
    └───────────┘ └─────┬──────┘              │  engine)     │
                         │                     └───────────────┘
                         │
              ┌──────────┴──────────┐
              │                     │
     ┌────────▼──────┐    ┌────────▼──────┐
     │ 用户 A 本地    │    │ 用户 B 本地    │
     │ Formapis      │    │ Formapis      │
     │ agent CLI 跑这 │    │ agent CLI 跑这 │
     └───────────────┘    └───────────────┘
```

---

## 四、三个关键设计决策

### 4.1 云端 agent 谁来执行？

**云端直接执行**。agent CLI（claude/codex/hermes）直接安装在云端 VPS 上，
用户的 API key 安全同步到云端，agent 在云端运行。

- agent CLI 安装在云端 VPS（claude/codex/gemini 等都是 Linux CLI）
- 用户 API key 同步到云端（加密传输 + 加密存储，见 4.5 节）
- 云端编排引擎创建 task DAG → 云端 agent CLI 直接执行 → 结果存云端 DB
- 用户在 Web 上看到完整的执行过程和结果
- 不需要下发到本地（本地 Formapis 只负责数据同步，不参与执行）

模式 B（仅中继）仍为本地执行：中继只做网络穿透，agent 在本地跑。

### 4.2 多租户隔离

**MVP：DB 层隔离（user_id 列）**

```
共享 Formapis runtime 进程（一个实例）
├── orchestration.db
│   ├── tasks 表加 user_id 列
│   ├── coordinator_runs 加 user_id 列
│   └── 查询都带 WHERE user_id = ?
├── per-user 存储
│   ├── user-A/agents/*.yaml
│   ├── user-B/agents/*.yaml
│   └── user-C/agents/*.yaml
└── coordinator 调度时按 user_id 过滤 task
```

**长期升级路径**：Docker per user（进程级隔离）/ Kubernetes namespace（集群级隔离）

### 4.3 Web 是否能看到本地 agent 执行？

| 模式 | Web 能看到 | 实时性 |
|------|-----------|--------|
| 模式 A（云上同步） | task 状态、执行结果、日志（回传） | task 级别（非实时终端） |
| 模式 B（仅中继） | 全部（含实时终端 PTY 流） | 实时（中继透传） |

### 4.4 四端架构：一套 UI 代码，多个入口

桌面端、Web 端、云端 Web、移动端 App 四端的布局、代码、启动命令关系：

#### 四端对比

| 维度 | 桌面端 | Web 端 | 云端 Web | 移动端 App |
|------|--------|--------|---------|-----------|
| 代码 | `src/renderer/src/App.tsx` | 同一个 App | 同一个 App | `mobile/`（独立） |
| 页面布局 | 与 Web/云端一样 | 与桌面一样 | 与桌面一样 | 不同（React Native） |
| 启动命令 | `pnpm dev` / `pnpm start` | `pnpm dev:web` | 访问域名 | `npx expo start` |
| agent 执行 | 本地 | 经中继连本地 | 云端或经中继连本地 | 经中继连本地 |
| 数据来源 | 本地文件 | 经中继连本地 runtime | 云端 DB（同步来的） | 经中继连本地 |

#### 核心原则：不分项目，复用一套代码

```
Formapis（现有项目）
├── src/main/              ← Electron 主进程（桌面端）
├── src/renderer/src/      ← 共享 React UI（桌面 + Web + 云端 Web）
│   ├── App.tsx            ← 四端共享的页面布局（桌面/Web/云端）
│   ├── web/main.tsx       ← Web 入口（配对连接本地）
│   ├── cloud/main.tsx     ← 云端 Web 入口（连云端 API）← 新增
│   ├── components/        ← 共享组件（Resources/Agents/Workflow 等）
│   └── store/             ← 共享状态管理
├── mobile/                ← 移动端（独立，React Native）
└── src/shared/            ← 四端共享类型/schema（agent-yaml/scenario-yaml 等）
```

#### 数据层抽象：callRuntimeRpc 统一三端

现有架构已有 `callRuntimeRpc` 抽象，桌面端走 IPC、Web 端走 WebSocket。
云端只需加第三种 target，所有 UI 组件零改动：

```ts
type RuntimeClientTarget =
  | { kind: 'local' }           // 桌面端（Electron IPC）
  | { kind: 'environment' }     // Web 端（WebSocket 中继连本地）
  | { kind: 'cloud' }           // 云端（HTTP API）← 新增
```

加 `{ kind: 'cloud' }` 后，现有 Resources/Agents/Workflow 页面零改动就能在云端跑。

#### 移动端为什么不复用

桌面端/Web端/云端使用 React (DOM)，移动端使用 React Native (Native 组件)：
- `<View>` ≠ `<div>`，`<Text>` ≠ `<span>`，`<ScrollView>` ≠ `<div className="overflow-auto">`
- 移动端必须独立项目（`mobile/`），但可以共享：
  - 类型定义（`src/shared/`）
  - API 客户端（`callRuntimeRpc` 的 RN 版本）
  - YAML schema（`agent-yaml.ts` 等）

#### 代码复用关系图

```
                    src/renderer/src/App.tsx（共享 UI）
                       /        |          \
            桌面端入口    云端 Web入口     Web端入口
            (Electron)   (cloud/main.tsx)  (web/main.tsx)
                |             |               |
            本地 IPC      云端 HTTP API    WebSocket 中继
                |             |               |
              数据层抽象 callRuntimeRpc（同一个函数，三种 target）
```

#### 云端 Web 入口新增（最小改动）

```
src/renderer/src/cloud/         ← 新增
├── main.tsx                    ← 云端入口（类似 web/main.tsx）
├── CloudAuth.tsx               ← 登录/注册界面
└── cloud-preload-api.ts        ← 数据层适配（window.api → fetch /api/*）
```

云端 `cloud-preload-api.ts` 把所有 `window.api.*` 调用替换为 `fetch('/api/*')`，
UI 组件完全复用，用户在云端 Web 看到的界面和本地桌面端一样。

### 4.5 API key 安全同步方案

agent CLI 直接装在云端，核心挑战是：用户的 API key 怎么安全地同步到云端？

#### 各 agent CLI 的认证方式

| agent CLI | 认证方式 | 存在哪 | 格式 |
|-----------|---------|--------|------|
| claude | API key / OAuth token | `~/.claude/config.json` + OS keychain | `primaryApiKey` 字段 |
| codex | API key / OAuth | `~/.codex/config.toml` | TOML 配置 |
| hermes | API key | `~/.hermes/config.yaml` | YAML 配置 |
| gemini | API key | `~/.gemini/settings.json` | JSON |
| grok | API key | `~/.grok/` | 文件 |

#### 三层安全设计

**第一层：传输安全（本地 → 云端）**

```
本地 Formapis                     云端 API
│                                 │
│  1. 用户登录云端 → JWT + 会话密钥 │
│                                 │
│  2. 收集本地 agent key:          │
│     ~/.claude/config.json       │
│     ~/.codex/config.toml        │
│                                 │
│  3. 用会话密钥加密 ──────────────►  POST /api/agent-keys/upload
│     (AES-256-GCM)               │  (密文传输，TLS + 应用层加密)
│                                 │
│                                 │  4. 云端解密 → 加密存储
```

**第二层：存储安全（云端怎么存）**

```
云端 PostgreSQL:

  agent_keys 表:
  ├── user_id:     user-A
  ├── agent_type:  claude
  ├── key_cipher:  AES-256-GCM(用户主密钥, "sk-ant-...")
  ├── key_hash:    sha256(key)  ← 用于比对，不存明文
  ├── created_at:  ...
  └── last_used:   ...

  用户主密钥:
  ├── 从用户密码派生 (PBKDF2/Argon2)
  ├── 数据库里只存密文，没有主密钥解不开
  └── 云端管理员有 DB 权限但没有用户密码
```

**第三层：使用安全（云端 agent CLI 怎么用 key）**

```
云端 Formapis 实例（每用户隔离 HOME 目录）:

  用户 A 发起 task → 云端 coordinator 调度
      │
      ▼
  从 agent_keys 表解密用户 A 的 claude key
      │
      ▼
  写入用户 A 的隔离环境:
  /home/formapis/users/user-A/.claude/config.json
      │
      ▼
  用 user-A 的 HOME 启动 claude CLI
  HOME=/home/formapis/users/user-A claude --print "..."
      │
      ▼
  执行完成 → 清理临时 key 文件（或用 tmpfs）
```

#### 安全保障

| 风险 | 措施 |
|------|------|
| 传输被截获 | TLS (HTTPS) + 应用层 AES-256-GCM 双重加密 |
| 云端数据库泄露 | key 只存密文，主密钥从用户密码派生，没有密码解不开 |
| 云端管理员偷看 | 管理员有 DB 权限但没有用户密码（PBKDF2 派生主密钥） |
| key 过期/泄露 | 用户可随时 "Revoke All Keys" → 云端立即删除 |
| key 残留 | agent CLI 执行完后清理临时 key 文件（tmpfs / 内存文件系统） |
| 多用户串用 | 每用户独立 HOME 目录 + 独立 agent_keys 行（user_id 隔离） |

#### 用户操作流程

```
本地 Formapis → Settings → Cloud → Agent Key Sync:

  ☑ Claude    ✓ synced (sk-ant-***)
  ☑ Codex     ✓ synced
  ☑ Gemini    ✓ synced
  ☐ Hermes    not configured

  [Sync Keys Now]  [Revoke All Keys]

  ⚠️ Keys are encrypted (AES-256) and stored on the cloud server.
     You can revoke at any time.
```

#### 设计决策

- **不验证 key 有效性**：用户上传就存，agent CLI 用的时候自然知道好不好使（claude 报错 = key 无效）。避免云端滥用 key 做验证调用。
- **不复用 orca 的 keychain**：orca 的 `claude-accounts/keychain.ts`（OS keychain）和 `speech/openai-api-key-store.ts`（safeStorage）依赖本地 OS，云端没有用户的 OS keychain，改用数据库加密存储。
- **key 可以随时撤销**：用户点 "Revoke All Keys" → 云端立即删除该用户所有 agent_keys 行。

#### 同步 API 设计

```
POST /api/agent-keys/upload       ← 本地加密上传 agent key
  body: { agent: "claude", keyCipher: "..." }
  → { ok: true }

GET  /api/agent-keys/list          ← 查询已同步的 agent key（只返回 hash，不返回明文）
  → { keys: [{ agent: "claude", hash: "ab12...", syncedAt: "..." }] }

DELETE /api/agent-keys/:agent      ← 撤销单个 agent key
DELETE /api/agent-keys             ← 撤销所有 key（Revoke All）
```

---

## 五、数据同步设计

### 同步范围

```
本地 ~/.formapis/              云端 PostgreSQL (per-user namespace)
├── agents/*.yaml     ◄──同步──►  agents 表
├── scenarios/*.yaml  ◄──同步──►  scenarios 表
├── resources/        ◄──同步──►  resources 表
├── workflow-history/ ◄──同步──►  history 表
└── (加密同步)                  (加密存储)
    └── agent API keys          └── agent_keys 表（AES-256，见 4.5 节）

不同步:
    ├── agent CLI 二进制（云端 VPS 预装）
    └── 本地 git worktree（用户可选上传 repo）
```

### 同步策略

- **首次连接**：本地 → 云端全量推送
- **后续**：增量同步（基于文件 mtime / 版本号）
- **冲突处理**：Last-Write-Wins，冲突时提示用户选择
- **触发点**：创建/修改 agent/scenario/resource 时自动推送

---

## 六、技术架构

### 6.1 云平台后端（新建独立项目）

```
formapis-cloud/
├── server/                      ← Node.js + TypeScript 后端
│   ├── auth/                    ← 用户认证（JWT / OAuth）
│   ├── sync/                    ← 数据同步 API
│   │   ├── sync-manager.ts      ← 同步逻辑（增量/全量/冲突）
│   │   └── sync-routes.ts       ← REST API
│   ├── relay/                   ← 中继服务
│   │   ├── relay-server.ts      ← WebSocket 代理
│   │   ├── room-manager.ts      ← 设备配对/房间
│   │   └── device-auth.ts       ← 设备 token
│   ├── runtime/                 ← 共享编排实例
│   │   ├── namespaced-db.ts     ← orchestration DB + user_id
│   │   └── coordinator-pool.ts  ← 按用户调度
│   └── market/                  ← Agent 市场（可选）
│       └── share-routes.ts
│
├── web/                         ← Web 前端（复用 Formapis Web 端）
│   └── (复用 src/renderer/src/ 大部分代码)
│
├── docker-compose.yml           ← 一键部署
└── Dockerfile
```

### 6.2 本地 Formapis 的改动

```
本地 Formapis 新增：
src/main/cloud/
├── cloud-sync.ts                ← 同步引擎（推/拉 agent/skill/workflow）
├── cloud-relay-client.ts        ← 中继客户端（出站连云端）
├── cloud-auth.ts                ← 云端认证（token 存储）
└── cloud-settings.ts            ← 云端设置 UI 数据

Settings 新增 "Cloud" 面板：
├── 连接云端（登录）
├── 模式选择：[云上同步] / [仅中继] / [断开]
├── 同步状态（最后同步时间/冲突）
└── 手动同步按钮
```

### 6.3 同步 API 设计

```
POST /api/auth/login            → { token }
POST /api/sync/push             ← 本地推数据到云端
  body: { agents: [...], scenarios: [...], resources: [...] }
GET  /api/sync/pull?since=      → 云端拉增量数据
POST /api/sync/conflict/resolve ← 解决冲突

POST /api/relay/register        ← 本地注册中继
  → { relayUrl, deviceToken }
WS   /relay/<roomId>            ← 中继 WebSocket（双向透传）

POST /api/run/scenario          ← 云端运行 scenario（编排下发到本地）
GET  /api/run/status            ← 查询运行状态
```

### 6.4 编排执行流程（模式 A 的 task 下发）

```
Web 上点 "Run workflow"
    │
    ▼
云端编排引擎：创建 task DAG（namespaced by user_id）
    │
    ├── 通过中继找到用户的本地 Formapis 连接
    │
    ▼
中继下发 task spec → 本地 Formapis
    │
    ▼
本地 Formapis 调 coordinator.dispatchReadyTasks
    ├── 创建/复用 agent 终端（claude/codex/...）
    ├── 注入 preamble + task spec
    └── agent CLI 执行
    │
    ▼
本地执行完成 → worker_done → 本地 DB 记录结果
    │
    ▼
结果通过中继回传云端 → 云端 DB 更新 task 状态
    │
    ▼
Web 端轮询看到 task 完成 + 结果
```

---

## 七、中继服务设计（模式 B）

```
中继服务器（Node.js）：
┌──────────────────────────────────────────┐
│  WebSocket Proxy                          │
│                                          │
│  连接池：                                  │
│  ├── user-A-local ──┐                    │
│  │                  ├─── 配对 ──── 转发   │
│  ├── user-A-phone ──┘                    │
│                                          │
│  ├── user-B-local ──┐                    │
│  │                  ├─── 配对 ──── 转发   │
│  ├── user-B-phone ──┘                    │
│                                          │
│  功能：                                   │
│  ├── 设备配对（token + 可选 E2EE）         │
│  ├── WebSocket 透传（不解密）              │
│  ├── 心跳检测（清理断连）                  │
│  └── 不存储任何用户数据                    │
└──────────────────────────────────────────┘

比官方 Orca Cloud relay 简单：
── 不需要复杂的 cell assignment + E2EE key exchange
── 用更轻量的方案（设备 token + WebSocket room）
── 后续可加 E2EE（tweetnacl，复用 orca 的 e2ee-crypto.ts）
```

---

## 八、技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 云平台语言 | Node.js (TypeScript) | 和 Formapis 同栈，复用代码 |
| 数据库 | PostgreSQL (生产) / SQLite (开发) | orchestration DB 已用 SQLite，可平滑迁移 |
| 用户认证 | JWT + 可选 OAuth | 简单起步，后续可接 GitHub/Google |
| 中继协议 | WebSocket room（非 E2EE MVP） | 比官方 relay 简单，后续可加 E2EE |
| 编排隔离 | orchestration DB 加 user_id 列 | MVP 最轻量，后续可升级到容器 |
| 部署 | Docker Compose | 一键部署，含 DB + 中继 + runtime |
| Web 前端 | 复用 Formapis Web 端 | 大部分代码可直接复用 |

---

## 九、实现路线图

| 阶段 | 内容 | 周期 | 依赖 |
|------|------|------|------|
| **Phase C1** | 中继服务（模式 B）—— WebSocket 代理 + 设备配对 | 1-2 周 | 无 |
| **Phase C2** | 数据同步（模式 A 核心）—— 同步 API + 本地推拉 | 2-3 周 | C1 |
| **Phase C3** | 云端编排实例 —— 共享 runtime + user_id 隔离 + task 下发 | 2-3 周 | C2 |
| **Phase C4** | Web 前端适配 —— 复用 Formapis Web 端 + 认证 | 1-2 周 | C3 |
| **Phase C5** | Agent 市场（可选）—— 共享/发现/安装 | 1-2 周 | C4 |

---

## 十、和现有 Formapis 的关系

```
现有 Formapis（本地）          云平台（新建）
─────────────────              ──────────────
桌面端 + Web 端                Web 端（复用）+ 后端（新建）
~/.formapis/ 存储              PostgreSQL 存储
orchestration DB               namespaced orchestration DB
agent CLI 本地跑               编排在云端，执行在本地（经中继下发）
A2A 对外                       对内（Web 用户）+ 对外（A2A）
```

### 本地 Formapis 需要新增的

- Settings → "Cloud" 面板（连接/模式选择/同步）
- `src/main/cloud/` 同步引擎 + 中继客户端
- 同步触发点（创建 agent/scenario/resource 时自动推送）

---

## 十一、和 orca 原有"服务器发布"功能的关系

| orca 原有能力 | 在云平台中的角色 |
|-------------|----------------|
| `orca serve`（无头模式） | 云平台后端的基础（云端实例用 serve 模式跑） |
| Runtime Server（HTTP + WS） | 云端实例复用，加 user_id 隔离 |
| Pairing（配对） | 中继服务复用配对概念，简化为 WebSocket room |
| Orca Cloud Relay | 被自建中继替代 |
| E2EE（tweetnacl） | 可复用加到自建中继（后续增强） |
| A2A | 云平台也暴露 A2A，外部系统可调 |
