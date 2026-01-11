# 飞书用户认证指南

本指南说明如何为飞书企业 MCP 服务器配置用户认证，以支持需要 `user_access_token` 的功能。

---

## 为什么需要用户认证？

飞书 API 有两种认证方式：

| 认证方式 | Token 类型 | 支持功能 |
|---------|-----------|---------|
| **应用认证** | tenant_access_token | 基础文档操作、多维表格 |
| **用户认证** | user_access_token | Wiki创建、文件搜索、日历事件等 |

需要用户认证的功能：
- 创建 Wiki 知识空间
- 搜索文件
- 查看日历事件
- 获取用户个人文件夹

---

## 快速开始

### 1. 启动认证服务器

```bash
cd feishu-enterprise-mcp
node auth_server.js
```

服务器会在 `http://localhost:3000` 启动。

### 2. 在浏览器中完成授权

1. 控制台会显示授权 URL
2. 浏览器会自动打开（或手动访问）
3. 在飞书页面点击"同意授权"
4. 授权成功后页面会关闭

### 3. 验证认证状态

访问 `http://localhost:3000/token` 查看 token 状态：

```json
{
  "exists": true,
  "valid": true,
  "expires_in": 6900,
  "user": "张三"
}
```

### 4. 重启 Claude Code

使配置生效后即可使用所有功能。

---

## 权限说明

认证请求以下权限：

| 权限 | 说明 |
|------|------|
| `docx:document` | 创建、编辑文档 |
| `wiki:wiki` | 管理 Wiki 知识库 |
| `bitable:app` | 操作多维表格 |
| `drive:drive` | 访问云盘文件 |
| `calendar:calendar` | 管理日历事件 |
| `im:message` | 发送消息 |

---

## Token 管理

### Token 文件位置

```
feishu-enterprise-mcp/user_token.json
```

文件内容示例：
```json
{
  "access_token": "cli_xxxx",
  "refresh_token": "ur_xxxx",
  "expires_at": 1736638400,
  "user_info": {
    "name": "张三",
    "user_id": "ou_xxx",
    "union_id": "on_xxx"
  }
}
```

### 自动刷新

- Token 有效期：约 2 小时
- 过期前自动刷新（使用 refresh_token）
- 刷新失败时需要重新授权

### 重新授权

如果 token 失效：
1. 运行 `node auth_server.js`
2. 访问授权 URL
3. 完成授权

---

## 故障排查

### 问题：未找到有效的用户 Token

**解决方案**：
```bash
node auth_server.js
# 然后在浏览器中完成授权
```

### 问题：授权失败 (99991663)

**原因**：应用缺少权限配置

**解决方案**：
1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 进入应用管理
3. 在「权限管理」中申请所需权限
4. 重新进行授权

### 问题：Token 过期

**解决方案**：
- Token 会自动刷新（如果 refresh_token 有效）
- 如果刷新失败，重新运行授权流程

---

## 安全建议

1. **保护 Token 文件**
   - 不要将 `user_token.json` 提交到版本控制
   - 添加到 `.gitignore`

2. **定期重新授权**
   - Token 最长有效期约 2 年
   - 建议每季度重新授权一次

3. **使用最小权限**
   - 只申请必要的权限
   - 定期审查权限使用情况

---

## API 参考

### 认证相关 API

| 端点 | 说明 |
|------|------|
| `GET /` | 授权页面 |
| `GET /callback` | OAuth 回调 |
| `GET /token` | Token 状态 |

### 使用用户 Token 的 MCP 工具

| 工具 | 需要 | 说明 |
|------|------|------|
| `create_wiki_space` | ✓ | 创建 Wiki 知识空间 |
| `list_files` | 部分 | 搜索功能需要 |
| `list_calendar_events` | ✓ | 获取日历事件 |
| `send_message` | 部分 | 发送消息需要 |

---

## 示例代码

### 检查 Token 状态

```javascript
import fs from "fs";
import path from "path";

const TOKEN_FILE = path.join(process.cwd(), "user_token.json");

function checkToken() {
  if (!fs.existsSync(TOKEN_FILE)) {
    console.log("❌ 未找到 Token 文件");
    return false;
  }

  const tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
  const now = Date.now() / 1000;
  const remaining = tokenData.expires_at - now;

  if (remaining > 0) {
    console.log(`✓ Token 有效，剩余 ${Math.floor(remaining / 60)} 分钟`);
    console.log(`  用户: ${tokenData.user_info?.name}`);
    return true;
  } else {
    console.log("❌ Token 已过期");
    return false;
  }
}

checkToken();
```

---

## 常见问题

**Q: 授权后 Token 存在哪里？**

A: Token 保存在 `feishu-enterprise-mcp/user_token.json`

**Q: Token 有效期多久？**

A: access_token 约 2 小时，refresh_token 有效期更长（可自动刷新）

**Q: 可以在多台设备使用同一个 Token 吗？**

A: 可以，Token 文件可以复制到其他设备

**Q: 如何撤销授权？**

A: 在飞书应用的「权限管理」中移除授权

---

需要帮助？请查看：
- [飞书开放平台文档](https://open.feishu.cn/document/server-docs/docs/authentication/token-verify)
- [MCP 协议规范](https://modelcontextprotocol.io/)
