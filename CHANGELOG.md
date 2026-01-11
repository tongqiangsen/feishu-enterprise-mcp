# 变更日志

所有值得注意的项目变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [1.1.0] - 2026-01-11

### 新增
- 用户认证服务器 (`auth_server.js`) 支持 OAuth 2.0 授权流程
- Token 自动刷新机制（使用 refresh_token）
- 一键诊断脚本 (`scripts/diagnose.ps1`)
- 完整的文档体系：
  - 快速操作指南 (`docs/QUICK_START.md`)
  - 故障排查指南 (`docs/TROUBLESHOOTING.md`)
  - 快速参考卡片 (`docs/QUICK_REF.txt`)
  - 用户认证指南 (`docs/AUTH_GUIDE.md`)

### 修复
- 修复 Wiki 相关函数未使用 user_token 的问题
- 修复授权 URL 生成时的语法错误
- 修复 Token 交换流程（实现两步认证）

### 变更
- 重构项目结构，新增 `docs/`、`tests/`、`scripts/` 目录
- 更新 README.md，增加完整的使用说明
- 添加 .gitignore 文件

### 安全
- user_token.json 添加到 .gitignore，防止敏感信息泄露

---

## [1.0.0] - 2026-01-11

### 新增
- 初始版本发布
- 支持 26 个飞书 MCP 工具：
  - 文档操作（创建、读取、更新）
  - Wiki 知识库（创建空间、节点管理）
  - 多维表格（创建、增删改查）
  - 消息发送
  - 日历事件管理
  - 文件管理
  - 用户与部门信息查询

---

## 未来计划

### v1.2.0 (计划中)
- [ ] 支持批量操作
- [ ] 添加更多错误处理和重试机制
- [ ] 支持多用户切换
- [ ] 添加 Webhook 支持

### v1.3.0 (计划中)
- [ ] 支持飞书小程序集成
- [ ] 添加更多飞书 API 功能
- [ ] 性能优化和缓存机制
