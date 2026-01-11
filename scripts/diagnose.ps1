# 飞书 MCP 快速诊断脚本
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host "  飞书 MCP 快速诊断" -ForegroundColor Cyan
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host ""

# [1] 检查 Node.js
Write-Host "[1] 检查 Node.js 安装..." -ForegroundColor Yellow
try {
    $version = node --version
    Write-Host "   ✓ Node.js 已安装: $version" -ForegroundColor Green
} catch {
    Write-Host "   ✗ Node.js 未安装" -ForegroundColor Red
}

# [2] 检查端口 3000
Write-Host ""
Write-Host "[2] 检查端口 3000 状态..." -ForegroundColor Yellow
$port = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($port) {
    Write-Host "   ✓ 端口 3000 正在使用" -ForegroundColor Green
    Write-Host "   PID: $($port.OwningProcess)" -ForegroundColor Gray
} else {
    Write-Host "   ✗ 端口 3000 未被占用（授权服务器未运行）" -ForegroundColor Red
}

# [3] 检查 Token 文件
Write-Host ""
Write-Host "[3] 检查 user_token.json..." -ForegroundColor Yellow
$tokenPath = "user_token.json"
if (Test-Path $tokenPath) {
    Write-Host "   ✓ Token 文件存在" -ForegroundColor Green
    $token = Get-Content $tokenPath -Raw | ConvertFrom-Json
    if ($token.access_token) { Write-Host "   ✓ 有 access_token" -ForegroundColor Green }
    if ($token.refresh_token) { Write-Host "   ✓ 有 refresh_token" -ForegroundColor Green }

    # 检查是否过期
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ($token.expires_at -lt $now) {
        Write-Host "   ⚠ Token 已过期（需要刷新或重新授权）" -ForegroundColor Yellow
    } else {
        $remaining = [math]::Floor(($token.expires_at - $now) / 60)
        Write-Host "   ✓ Token 有效，剩余约 $remaining 分钟" -ForegroundColor Green
    }

    # 检查用户信息
    if ($token.user) {
        Write-Host "   当前用户: $($token.user.name)" -ForegroundColor Cyan
    }
} else {
    Write-Host "   ✗ Token 文件不存在，需要授权" -ForegroundColor Red
}

# [4] 检查 index.js
Write-Host ""
Write-Host "[4] 检查 index.js..." -ForegroundColor Yellow
if (Test-Path "index.js") {
    Write-Host "   ✓ index.js 存在" -ForegroundColor Green

    # 检查是否配置了 user token
    $content = Get-Content "index.js" -Raw
    if ($content -match 'case\s+"list_wiki_spaces".*?true.*?//\s*使用\s*user\s*token') {
        Write-Host "   ✓ 已配置使用 user token" -ForegroundColor Green
    } else {
        Write-Host "   ⚠ 可能未正确配置 user token（需要重启 Claude Code）" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ✗ index.js 不存在" -ForegroundColor Red
}

# [5] 建议操作
Write-Host ""
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host "  建议操作" -ForegroundColor Cyan
Write-Host "========================================"  -ForegroundColor Cyan

if (!(Test-Path $tokenPath)) {
    Write-Host ""
    Write-Host "需要首次授权:" -ForegroundColor Yellow
    Write-Host "  1. 启动授权服务器: node auth_server.js" -ForegroundColor White
    Write-Host "  2. 访问: http://localhost:3000" -ForegroundColor White
    Write-Host "  3. 点击「打开授权页面」并完成授权" -ForegroundColor White
} elseif ($port) {
    Write-Host ""
    Write-Host "✓ 系统状态正常，可以直接使用 MCP 功能" -ForegroundColor Green
    Write-Host ""
    Write-Host "如 MCP 函数返回空结果，请:" -ForegroundColor Yellow
    Write-Host "  → 重启 Claude Code" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "Token 已存在，如需操作:" -ForegroundColor Yellow
    Write-Host "  → 启动授权服务器: node auth_server.js" -ForegroundColor White
    Write-Host "  → 重启 Claude Code（使代码修复生效）" -ForegroundColor White
}

Write-Host ""
