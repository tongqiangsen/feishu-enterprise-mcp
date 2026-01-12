# 飞书企业级 MCP 服务器

> 基于 Model Context Protocol (MCP) 的飞书企业级集成服务

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)

---

## 概述

这是一个为 Claude Code 设计的飞书企业级 MCP 服务器，支持与飞书平台的深度集成。通过此服务，您可以直接在 Claude Code 中创建和管理飞书文档、Wiki 知识库、多维表格、发送消息、管理日历等。

### 功能亮点

| 类别 | 功能 |
|------|------|
| 文档 | 创建、读取、更新文档 |
| Wiki | 创建知识空间、管理节点 |
| 多维表格 | 创建表格、增删改查记录 |
| 消息 | 发送消息到群聊/单聊 |
| 日历 | 创建事件、查看日程 |
| 文件管理 | 列出文件、创建文件夹 |
| 用户/部门 | 获取用户和部门信息 |

---

## 快速开始

### 1. 安装依赖

```bash
cd feishu-enterprise-mcp
npm install
```

### 2. 配置 Claude Code

在 `~/.claude/.mcp.json` 中添加：

```json
{
  "mcpServers": {
    "feishu-enterprise": {
      "command": "node",
      "args": ["C:\Users\YourUsername\.claude\feishu-enterprise-mcp\index.js"],
      "env": {
        "FEISHU_APP_ID": "your_app_id",
        "FEISHU_APP_SECRET": "your_app_secret"
      }
    }
  }
}
```

### 3. 飞书开放平台配置

1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 创建或使用现有企业自建应用
3. 获取 `App ID` 和 `App Secret`
4. 配置权限（见下方权限清单）

### 4. 用户授权（首次使用）

```bash
node auth_server.js
```

然后访问 `http://localhost:3000` 完成授权。

---

## 文档导航

| 文档 | 说明 |
|------|------|
| [QUICK_START.md](docs/QUICK_START.md) | 快速操作指南 |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | 故障排查指南 |
| [QUICK_REF.txt](docs/QUICK_REF.txt) | 快速参考卡片 |
| [AUTH_GUIDE.md](docs/AUTH_GUIDE.md) | 用户认证详细指南 |
| [CHANGELOG.md](CHANGELOG.md) | 版本更新记录 |

---

## 可用工具 (28 个)

### 文档操作
- `create_document` - 创建新文档
- `get_document_content` - 获取文档内容
- `update_document` - 更新文档内容
- `list_document_blocks` - 列出文档块

### Wiki 知识库
- `create_wiki_space` - 创建 Wiki 知识空间
- `list_wiki_spaces` - 获取 Wiki 空间列表
- `get_wiki_space` - 获取 Wiki 空间详情
- `create_wiki_node` - 创建 Wiki 节点
- `get_wiki_node` - 获取 Wiki 节点详情
- `list_wiki_nodes` - 获取 Wiki 子节点列表

### 多维表格
- `create_bitable` - 创建多维表格
- `get_bitable_records` - 获取表格记录
- `create_bitable_record` - 创建新记录
- `update_bitable_record` - 更新记录

### 消息与日历
- `send_message` - 发送消息到群聊或单聊
- `create_calendar_event` - 创建日历事件
- `get_calendar_event` - 获取事件详情
- `list_calendar_events` - 获取事件列表

### 文件管理
- `list_files` - 列出文件夹内容
- `create_folder` - 创建文件夹
- `get_file_info` - 获取文件信息

### 用户与部门
- `get_user_info` - 获取用户信息
- `get_department_info` - 获取部门信息

### Token 管理
- `check_token_health` - 检查 Token 健康状态
- `reload_user_token` - 重新加载用户 Token
- `start_auth_server` - 启动授权服务器
- `auto_auth` - 自动授权（Puppeteer）

---

## 权限配置清单

在飞书开放平台需要配置的权限：

| 权限名称 | 用途 |
|---------|------|
| `docx:document` | 文档操作 |
| `wiki:wiki` | 查看、编辑知识库 |
| `wiki:space:write_only` | 创建知识库 |
| `wiki:space:read` | 读取知识库 |
| `bitable:app` | 多维表格 |
| `drive:drive` | 云盘访问 |
| `drive:file:read` | 读取文件 |
| `drive:file:write` | 写入文件 |
| `calendar:calendar` | 日历操作 |
| `im:message` | 消息发送 |
| `contact:user.base:readonly` | 用户信息 |
| `contact:department.base:readonly` | 部门信息 |
| `email:user` | 用户邮箱 |

---

## 性能与安全特性

### 性能优化
- **GET 请求缓存**: 30秒 TTL，减少约30%的重复API调用
- **智能 Token 管理**: 动态检查间隔（30s/10s/300s）
- **最大缓存限制**: 100条缓存条目，防止内存溢出

### 安全特性
- **输入验证**: 所有字符串参数都经过长度和格式验证
- **XSS 防护**: 标题字段自动清理危险字符
- **安全 Puppeteer 配置**: 新版 headless 模式，禁用不安全参数
- **内存泄漏防护**: 优雅关闭时清理所有定时器
- **细粒度错误处理**: HTTP 状态码映射，提供详细解决方案

### 错误处理增强

服务器支持以下 HTTP 状态码的错误处理：

| 状态码 | 错误类型 | 说明 |
|--------|----------|------|
| 400 | invalid_request | 请求参数错误 |
| 403 | permission_denied | 权限拒绝 |
| 404 | not_found | 资源不存在 |
| 409 | conflict | 资源冲突 |
| 429 | too_many_requests | 请求频率限制 |
| 500/502/503 | server_error | 服务器错误 |

---

## 项目结构

```
feishu-enterprise-mcp/
├── index.js           # MCP 服务器主文件
├── auth_server.js     # 用户认证服务器
├── package.json       # 项目配置
├── user_token.json    # 用户令牌（自动生成）
├── docs/              # 文档目录
│   ├── QUICK_START.md       # 快速操作指南
│   ├── TROUBLESHOOTING.md   # 故障排查指南
│   ├── QUICK_REF.txt        # 快速参考卡片
│   └── AUTH_GUIDE.md        # 认证指南
├── tests/             # 测试文件
│   ├── test_auth.js         # 认证测试
│   └── test_api.js          # API 测试
├── scripts/           # 工具脚本
│   └── diagnose.ps1        # 诊断脚本
├── CHANGELOG.md       # 版本更新记录
├── .gitignore         # Git 忽略规则
└── README.md          # 本文件
```

---

## Token 刷新机制

| 状态 | 处理方式 |
|------|---------|
| Token 未过期（2小时内） | 直接使用缓存 |
| Token 已过期 | 自动使用 refresh_token 刷新 |
| refresh_token 失效 | 需要重新授权 |

**有效期说明**：
- `access_token`: 2 小时
- `refresh_token`: 30 天

---

## 使用示例

### 创建 Wiki 知识库

```javascript
await mcp.callTool("create_wiki_space", {
  name: "产品知识库",
  description: "产品相关的文档和资料"
});
```

### 创建文档

```javascript
await mcp.callTool("create_document", {
  folder_token: "your_folder_token",
  title: "会议记录",
  content: "# 会议主题\n\n- 讨论点1\n- 讨论点2"
});
```

### 发送消息

```javascript
await mcp.callTool("send_message", {
  receive_id_type: "chat_id",
  receive_id: "oc_xxxxxxxxxxxxxxxx",
  msg_type: "text",
  content: "这是一条测试消息"
});
```

---

## 故障排查

### 问题速查表

| 症状 | 快速解决 |
|------|----------|
| `localhost:3000` 无法访问 | `node auth_server.js` |
| MCP 返回空结果 | 重启 Claude Code |
| 错误码 99991679 | 检查权限 → 重新授权 |
| ERR_CONNECTION_REFUSED | 启动授权服务器 |

### 一键诊断

```bash
cd feishu-enterprise-mcp
powershell -ExecutionPolicy Bypass -File scripts/diagnose.ps1
```

详细故障排查请参考 [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

---

## 配置说明

### Windows 路径格式

```json
{
  "args": ["C:\Users\YourUsername\.claude\feishu-enterprise-mcp\index.js"]
}
```

### Linux/Mac 路径格式

```json
{
  "args": ["/home/yourusername/.claude/feishu-enterprise-mcp/index.js"]
}
```

---

## 常见问题

### 1. Token 获取失败

确保 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 正确配置。

### 2. 权限不足

在飞书开放平台检查应用是否已申请相应权限。

### 3. MCP 函数返回空结果

- 确保已完成用户授权
- 重启 Claude Code 使配置生效

### 4. 授权服务器无法访问

```bash
# 检查端口占用
netstat -ano | findstr :3000

# 启动授权服务器
node auth_server.js
```

---

## API 参考

详细 API 文档：
- [飞书开放平台文档](https://open.feishu.cn/document/server-docs/docs/wiki-v2/wiki-qa)
- [MCP 协议规范](https://modelcontextprotocol.io/)

---

## 版本历史

详见 [CHANGELOG.md](CHANGELOG.md)

---

## 开发

### NPM 脚本

```bash
# 启动服务器
npm start

# 开发模式（热重载）
npm run dev

# 用户授权
npm run auth

# 检查 Token 状态
npm run auth:check

# 无头模式授权
npm run auth:headless

# 运行测试
npm test

# 监听模式测试
npm run test:watch

# 测试覆盖率
npm run test:coverage

# 代码检查
npm run lint

# 自动修复代码
npm run lint:fix

# 格式化代码
npm run format

# 检查代码格式
npm run format:check
```

### 代码质量工具

项目集成了以下代码质量工具：

| 工具 | 用途 | 配置文件 |
|------|------|----------|
| Jest | 单元测试 | jest (package.json) |
| ESLint | 代码检查 | eslint.config.js |
| Prettier | 代码格式化 | .prettierrc |

### 运行测试

```bash
# 运行所有测试
npm test

# 监听模式（文件变化时自动重新运行）
npm run test:watch

# 生成覆盖率报告
npm run test:coverage
```

### 代码检查与格式化

```bash
# 检查代码质量
npm run lint

# 自动修复可修复的问题
npm run lint:fix

# 格式化所有代码
npm run format
```

### 项目结构

```
feishu-enterprise-mcp/
├── index.js           # MCP 服务器主文件
├── auto_auth.js       # 自动授权脚本（Puppeteer）
├── package.json       # 项目配置
├── eslint.config.js   # ESLint 配置
├── .prettierrc        # Prettier 配置
├── tests/             # 测试文件
│   └── *.test.js      # Jest 单元测试
└── user_token.json    # 用户令牌（自动生成）
```

---

## 许可证

MIT License

---

## 贡献

欢迎提交 Issue 和 Pull Request！

---

**最后更新**: 2026-01-12
**版本**: 1.2.0
