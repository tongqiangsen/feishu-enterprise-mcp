$ErrorActionPreference = "Stop"

# 定义要替换的内容（按优先级排序，长的先匹配）
$patterns = @(
    @{ From = "c:\Users\Administrator\.claude\feishu-enterprise-mcp"; To = "`$USER_HOME\.claude\feishu-enterprise-mcp" },
    @{ From = "C:\Users\Administrator\.claude\feishu-enterprise-mcp"; To = "`$USER_HOME\.claude\feishu-enterprise-mcp" },
    @{ From = "c:/Users/Administrator/.claude/feishu-enterprise-mcp"; To = "`$USER_HOME/.claude\feishu-enterprise-mcp" },
    @{ From = "cli_a9e9d88712f89cc6"; To = "your_app_id" },
    @{ From = "童强森"; To = "your_username" }
)

# 要处理的文件
$files = @(
    "README.md",
    "docs/QUICK_START.md", 
    "docs/TROUBLESHOOTING.md",
    "docs/QUICK_REF.txt",
    "docs/AUTH_GUIDE.md"
)

foreach ($file in $files) {
    if (Test-Path $file) {
        $content = Get-Content $file -Raw -Encoding UTF8
        foreach ($pattern in $patterns) {
            $escaped = [Regex]::Escape($pattern.From)
            $content = $content -replace $escaped, $pattern.To
        }
        [System.IO.File]::WriteAllText((Resolve-Path $file), $content, [System.Text.Encoding]::UTF8)
        Write-Host "Updated: $file" -ForegroundColor Green
    }
}

Write-Host "`nSanitization complete!" -ForegroundColor Cyan
