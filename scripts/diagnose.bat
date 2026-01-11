@echo off
chcp 65001 >nul
echo ========================================
echo   飞书 MCP 快速诊断
echo ========================================
echo.

echo [1] 检查 Node.js 安装...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ✗ Node.js 未安装
    goto :end
) else (
    echo ✓ Node.js 已安装
)

echo.
echo [2] 检查 3000 端口状态...
netstat -ano | findstr :3000 >nul 2>&1
if %errorlevel% neq 0 (
    echo ✗ 端口 3000 未被占用（授权服务器未运行）
) else (
    echo ✓ 端口 3000 正在使用中
    netstat -ano | findstr :3000
)

echo.
echo [3] 检查 user_token.json...
if exist "user_token.json" (
    echo ✓ Token 文件存在
    findstr "access_token" user_token.json >nul && echo ✓ 有 access_token
    findstr "refresh_token" user_token.json >nul && echo ✓ 有 refresh_token
) else (
    echo ✗ Token 文件不存在，需要授权
)

echo.
echo [4] 检查 index.js 配置...
findstr /C:"case \"list_wiki_spaces\"" index.js >nul
if %errorlevel% neq 0 (
    echo ✗ index.js 可能未正确配置
) else (
    echo ✓ index.js 存在
)

echo.
echo ========================================
echo   建议操作
echo ========================================
if not exist "user_token.json" (
    echo 1. 启动授权服务器: node auth_server.js
    echo 2. 访问: http://localhost:3000
    echo 3. 完成授权
) else (
    echo Token 已存在，如 MCP 函数返回空结果：
    echo → 重启 Claude Code 使修复生效
)

:end
echo.
pause
