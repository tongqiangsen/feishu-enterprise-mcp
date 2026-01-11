# 飞书 MCP 服务器 - 快速操作指南

## 📋 配置概览

| 项目 | 值 |
|------|-----|
| 应用 ID | `your_app_id` |
| MCP 目录 | `$USER_HOME\.claude\feishu-enterprise-mcp\` |
| Token 文件 | `user_token.json` |
| 认证服务器 | `auth_server.js` |
| 故障排查指南 | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

---

## 🚀 正常使用（已授权完成）

直接在 Claude Code 中使用飞书功能：

```
# 创建 Wiki 知识库
"创建一个名为 '我的项目笔记' 的 Wiki 知识库"

# 创建文档
"在飞书创建一个文档，标题是 '会议记录'，内容是 '今天讨论了...'"

# 搜索文件
"在飞书搜索包含 '合同' 的文件"

# 创建日历事件
"创建明天下午2点的日历事件"
```

---

## 🔄 Token 刷新机制

| 状态 | 处理方式 |
|------|---------|
| Token 未过期（2小时内）| 直接使用缓存 |
| Token 已过期 | 自动使用 refresh_token 刷新 |
| refresh_token 失效 | 需要重新授权 |

**有效期说明**：
- `access_token`: 2 小时
- `refresh_token`: 30 天

---

## ⚠️ 故障排查

> 📌 **详细故障排查指南**: 查看 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

### 一键诊断（推荐首选）

遇到问题时，首先运行诊断脚本：

```bash
cd $USER_HOME\.claude\feishu-enterprise-mcp
c:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -ExecutionPolicy Bypass -File scripts/diagnose.ps1
```

### 问题速查表

| 症状 | 快速解决 |
|------|----------|
| `localhost:3000` 无法访问 | `node auth_server.js` |
| MCP 返回空结果 | 重启 Claude Code |
| 错误码 99991679 | 检查权限 → 重新授权 |
| ERR_CONNECTION_REFUSED | 启动授权服务器 |

### 问题 1: "错误码 99991679 - 应用未获取所需的用户授权"

**原因**: Token 缺少必要的权限范围

**解决方案**:
```bash
# 1. 删除旧 token
cd $USER_HOME\.claude\feishu-enterprise-mcp
rm user_token.json

# 2. 重新授权
node auth_server.js

# 3. 浏览器访问 http://localhost:3000 完成授权
```

### 问题 2: "授权链接错误 (ERR_CONNECTION_REFUSED)"

**原因**: 认证服务器未运行

**解决方案**:
```bash
cd $USER_HOME\.claude\feishu-enterprise-mcp
node auth_server.js
```

### 问题 3: MCP 函数返回空结果

**原因**: MCP 服务器未使用 user token（代码已修复，需重启）

**解决方案**: 重启 Claude Code

### 问题 4: TUN 模式导致授权失败

**解决方案**: 在代理软件中添加绕过规则
```
localhost
127.0.0.1
```

### 问题 5: Wiki 创建失败

**检查清单**:
- [ ] 已在飞书开放平台配置 Wiki 权限
  - `wiki:wiki`
  - `wiki:space:write_only`
  - `wiki:space:read`
- [ ] 已重新授权（scope 包含 Wiki 权限）
- [ ] Token 未过期

---

## 📝 重新授权步骤（完整版）

当需要重新授权时：

```bash
# 1. 进入目录
cd $USER_HOME\.claude\feishu-enterprise-mcp

# 2. 删除旧 token（可选）
rm user_token.json

# 3. 启动认证服务器
node auth_server.js

# 4. 浏览器访问
http://localhost:3000

# 5. 点击「打开授权页面」

# 6. 在飞书页面勾选所有权限并同意

# 7. 完成后可关闭服务器（Ctrl+C）
```

---

## 🛠️ 手动测试命令

### 运行诊断脚本
```bash
cd $USER_HOME\.claude\feishu-enterprise-mcp
c:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -ExecutionPolicy Bypass -File scripts/diagnose.ps1
```

### 查看 Token 信息
```bash
cd $USER_HOME\.claude\feishu-enterprise-mcp
cat user_token.json
```

### 检查 Token 是否过期
```bash
# 在 Node.js 中运行
node -e "const t=JSON.parse(fs.readFileSync('user_token.json')); console.log('剩余秒数:', Math.floor(t.expires_at-Date.now()/1000))"
```

---

## 📌 权限配置清单

在飞书开放平台需要配置的权限：

| 权限 | 用途 |
|------|------|
| `wiki:wiki` | 查看、编辑知识库 |
| `wiki:space:write_only` | 创建知识库 |
| `wiki:space:read` | 读取知识库 |
| `drive:drive` | 云盘访问 |
| `drive:file:read` | 读取文件 |
| `drive:file:write` | 写入文件 |
| `docx:document` | 文档操作 |
| `bitable:app` | 多维表格 |
| `calendar:calendar` | 日历操作 |
| `email:user` | 用户信息 |

**配置路径**:
[飞书开放平台](https://open.feishu.cn/app) → 应用 → 权限管理 → 权限集

---

## 🎯 常用功能示例

### Wiki 操作
```
创建 Wiki 知识库
"创建一个名为 '项目文档' 的 Wiki"
```

### 文档操作
```
创建文档
"创建文档 '周报'，内容是 '本周完成了...'"
```

### 多维表格
```
创建多维表格
"创建一个名为 '任务跟踪' 的多维表格"
```

### 日历
```
创建日程
"创建明天上午10点的会议提醒"
```

---

## 💡 最佳实践

1. **定期检查 Token 有效期** - Token 每 2 小时过期，但会自动刷新
2. **保存 refresh_token** - 30 天有效，用于自动刷新
3. **权限配置完整** - 一次性配置所有需要的权限
4. **授权后可关闭认证服务器** - 不需要持续运行

---

## 📞 需要帮助？

如果遇到问题：

1. **首先运行诊断脚本**: `scripts/diagnose.ps1`
2. 查看详细故障排查指南: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
3. 检查飞书开放平台权限是否已配置
4. 确认 `user_token.json` 文件是否存在

---

**最后更新**: 2026-01-11
**版本**: 1.1
