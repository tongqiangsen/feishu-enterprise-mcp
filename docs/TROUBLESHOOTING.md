# 飞书 MCP 故障排查指南

## 一键诊断（推荐首选）

遇到问题时，首先运行诊断脚本：

```bash
cd c:\Users\Administrator\.claude\feishu-enterprise-mcp
c:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -ExecutionPolicy Bypass -File diagnose.ps1
```

---

## 问题分类速查表

| 症状 | 可能原因 | 快速解决 |
|------|----------|----------|
| `localhost:3000` 无法访问 | 授权服务器未运行 | `node auth_server.js` |
| MCP 返回空结果 | 未使用 user token | 重启 Claude Code |
| 错误码 99991679 | 权限未配置或 token 过期 | 检查权限 → 重新授权 |
| ERR_CONNECTION_REFUSED | 服务器未启动 | 启动授权服务器 |
| 错误码 20014 | Token 交换失败 | 检查代码版本 |
| 端口 3000 被占用 | 其他程序使用端口 | 杀死进程或更换端口 |

---

## 一、授权服务器问题

### 症状 A: `localhost:3000` 无法访问

**可能原因**：
1. 授权服务器未运行
2. 端口被其他程序占用
3. TUN 模式拦截

**诊断命令**：
```bash
# 检查端口 3000 是否被占用
netstat -ano | findstr :3000
```

**解决方案**：

1. **启动授权服务器**：
   ```bash
   cd c:\Users\Administrator\.claude\feishu-enterprise-mcp
   node auth_server.js
   ```

2. **如果端口被占用**：
   ```bash
   # 查找占用端口的进程 PID
   netstat -ano | findstr :3000

   # 强制结束进程
   taskkill //F //PID <进程ID>

   # 重新启动服务器
   node auth_server.js
   ```

3. **如果 TUN 模式干扰**：
   在 VPN/代理软件中添加绕过规则：
   ```
   localhost
   127.0.0.1
   ```

---

### 症状 B: 授权服务器启动失败

**错误信息**：`Error: listen EADDRINUSE: address already in use :::3000`

**原因**：端口 3000 已被占用

**解决方案**：
```bash
# 方法 1: 结束占用进程
netstat -ano | findstr :3000
taskkill //F //PID <进程ID>

# 方法 2: 修改 auth_server.js 中的端口号
# 将 const PORT = 3000; 改为其他端口如 3001
```

---

## 二、MCP 函数问题

### 症状: Wiki 操作返回空结果

**错误示例**：
```json
{"has_more": false, "items": [], "page_token": "0||0"}
```

**原因**：MCP 服务器使用旧代码，未使用 user token

**解决方案**：**重启 Claude Code**

MCP 服务器的代码已修复（添加了 `useUserToken = true`），但需要重启才能生效。

---

## 三、Token 权限问题

### 症状 A: 错误码 99991679

**错误信息**：
```
应用未获取所需的用户授权：[wiki:wiki, wiki:space:write_only]
```

**可能原因**：
1. Token 是在权限配置之前创建的
2. 飞书平台未配置相应权限
3. Token 已过期且无法刷新

**解决方案**：

1. **检查飞书平台权限**：
   - 访问 https://open.feishu.cn/app
   - 进入应用 → 权限管理 → 权限集
   - 确认以下权限已开启：
     - `wiki:wiki` - 查看、编辑知识库
     - `wiki:space:write_only` - 创建知识库
     - `wiki:space:read` - 读取知识库

2. **删除旧 Token 并重新授权**：
   ```bash
   cd c:\Users\Administrator\.claude\feishu-enterprise-mcp
   rm user_token.json
   node auth_server.js
   # 然后访问 http://localhost:3000 完成授权
   ```

---

### 症状 B: Token 过期

**诊断**：
```bash
# 查看 Token 信息
cat user_token.json
```

**检查 `expires_at` 字段**：
- 如果当前时间戳 > `expires_at`，Token 已过期
- MCP 服务器会自动使用 `refresh_token` 刷新
- 如果 `refresh_token` 也失效（超过 30 天），需要重新授权

**解决方案**：
```bash
# 重新授权
rm user_token.json
node auth_server.js
# 访问 http://localhost:3000
```

---

## 四、Token 交换问题

### 症状: 错误码 20014

**错误信息**：
```
The app access token passed is invalid
```

**原因**：`auth_server.js` 代码版本不正确

**检查**：确保使用的是最新版本的 `auth_server.js`，包含两步 token 交换逻辑：

```javascript
// 步骤 1: 获取 app_access_token
const appTokenResponse = await axios.post(
  `${BASE_URL}/auth/v3/app_access_token/internal`,
  { app_id: APP_ID, app_secret: APP_SECRET }
);

// 步骤 2: 使用 app_access_token 交换用户 token
const response = await axios.post(
  `${BASE_URL}/authen/v1/oidc/access_token`,
  {
    app_access_token: appAccessToken,
    grant_type: "authorization_code",
    code: code,
  }
);
```

---

## 五、重定向 URI 问题

### 症状: 错误码 20029

**错误信息**：
```
redirect_uri 不合法
```

**原因**：飞书平台未配置回调地址

**解决方案**：

1. 访问 https://open.feishu.cn/app
2. 找到应用：`cli_a9e9d88712f89cc6`
3. 进入「权限管理」→「安全设置」
4. 添加重定向 URL：`http://localhost:3000/callback`
5. 保存后刷新页面重试

---

## 六、常见问题解答

### Q1: 为什么有时候 `localhost:3000` 可以访问，有时候不行？

**A**: 授权服务器是一个独立的 Node.js 进程，需要手动启动：
- 电脑重启后服务器会停止
- 使用 `taskkill` 关闭 node 进程后服务器会停止
- 只能在启动服务器后访问

### Q2: Token 过期后是否需要每次重新授权？

**A**: 不需要。MCP 服务器会自动使用 `refresh_token` 刷新 `access_token`：
- `access_token`: 2 小时有效期（自动刷新）
- `refresh_token`: 30 天有效期（超过后需重新授权）

### Q3: 为什么 MCP 函数返回空结果？

**A**: 可能是以下原因：
1. MCP 服务器未使用 user token（已修复，需重启 Claude Code）
2. 权限未配置或 Token 无效
3. 用户确实没有对应的 Wiki/文件

### Q4: 如何确认系统是否正常？

**A**: 运行诊断脚本：
```bash
c:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -ExecutionPolicy Bypass -File diagnose.ps1
```

---

## 快速修复清单

遇到问题时，按此顺序尝试：

1. ☐ 运行诊断脚本确认问题
2. ☐ 启动授权服务器：`node auth_server.js`
3. ☐ 检查 Token 是否存在且未过期
4. ☐ 确认飞书平台权限已配置
5. ☐ 如权限已配置，删除 Token 重新授权
6. ☐ 重启 Claude Code（使 MCP 代码修复生效）

---

**最后更新**: 2026-01-11
