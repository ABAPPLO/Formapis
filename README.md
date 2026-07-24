<div align="center">

# Formapis

**ADE runtime + unified resource layer + YAML agent workbench + multi-agent cluster orchestration.**

桌面 + Web 双端。

</div>

---

## 这是什么

**Formapis** 是 [Orca](https://github.com/stablyai/orca) 的进化分支。Orca 是一个成熟的 ADE(AI Development Environment),用于在隔离的 git worktree 中并行运行多个本地 AI 编码 agent(Codex / Claude Code / ZCode / OpenCode 等)。Formapis 在保留 Orca 强大的 ADE 运行时基础上,新增四个能力层:

| 层 | 能力 |
|---|---|
| **ADE 运行时** *(继承自 Orca)* | 管理本地 34+ AI 编码 agent,并行 worktree,终端编排 |
| **统一资源层** | MCP / Skill / Plugin 一处定义,分发到各 agent 目录共享 |
| **YAML Agent 工作台** | 用 YAML 声明 agent(名字/角色/工具/harness),支持生成、下载、加载、试运行、对话式构建 |
| **Agent 集群 + 任务看板** | 把多个 agent 组织成集群执行场景任务(有序工作台编排 / 无序工作台主 agent 调度),配可视化看板,支持 A2A 对外 |

## 功能规划

| # | 功能 | 状态 |
|---|---|---|
| 1 | **统一资源管理**:MCP / Skill / Plugin 在各 ADE 之间共享 | 规划中 |
| 2 | **Agent Harness 接入**:除 ADE 外,接入 OpenClaw / Hermes 等 harness | 已继承(Orca 已支持) |
| 3 | **YAML 定义 Agent**:用 YAML 声明 agent 身份、角色、工具;支持生成/下载/加载/构建 | 规划中 |
| 4 | **Agent 集群**:有序工作台(工作流编排)+ 无序工作台(主 agent 调度),支持 A2A 标准 | 规划中 |
| 5 | **对话式构建**:在对话中生成 YAML agent 并试运行 | 规划中 |
| 6 | **任务看板**:执行场景任务时的可视化看板 | 规划中 |

## 部署形态

- **桌面应用**(macOS / Windows / Linux):管理本地 ADE 进程,基于 Electron。
- **Web 端**:通过端到端加密 WebSocket 连接到桌面 runtime server 的浏览器客户端,提供远程看板、YAML 构建等能力。UI 与桌面端共享。

## 当前进度

本项目刚从 Orca 基线初始化(`v0.1.0`),正在按分阶段路线图推进:

- **Phase 0** ✅ 项目初始化(重命名、基线提交、文档)
- **Phase 1** ⏳ 统一资源层(MCP / Skill / Plugin)
- **Phase 2** ⏳ YAML Agent 定义体系
- **Phase 3** ⏳ Agent 集群 + 任务看板
- **Phase 4** ⏳ 对话式构建 Agent
- **Phase 5** ⏳ A2A 标准对外接口

## 开发

```bash
# 安装依赖(需要 pnpm)
pnpm install

# 桌面端开发
pnpm dev

# Web 端开发
pnpm dev:web

# 构建
pnpm build
```

> **注意**:CLI 命令名仍为 `orca`(内部代码依赖,后续阶段渐进式迁移)。环境变量 `ORCA_*` 同理保留兼容。

## 致谢与许可

Formapis 基于 [Orca](https://github.com/stablyai/orca) 衍生,感谢 Orca 团队([stablyai](https://github.com/stablyai) / Lovecast Inc.)的杰出工作。

本项目沿用 Orca 的 **MIT License**。原始版权声明见 [LICENSE](./LICENSE)。
