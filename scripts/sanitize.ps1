# 去除个人信息的脚本
$oldPath = [Regex]::Escape("c:\Users\Administrator")
$oldPath2 = [Regex]::Escape("C:\Users\Administrator")
$oldUnixPath = "c:/Users/Administrator"
$oldAppId = "cli_a9e9d88712f89cc6"
$oldUser = "童强森"

$files = @(
    'README.md',
    'docs/QUICK_START.md',
    'docs/TROUBLESHOOTING.md',
    'docs/QUICK_REF.txt',
    'docs/AUTH_GUIDE.md'
)

foreach ($file in $files) {
    if (Test-Path $file) {
        $content = Get-Content $file -Raw
        $content = $content -replace $oldAppId, 'your_app_id'
        $content = $content -replace $oldPath, '$USER_HOME'
        $content = $content -replace $oldPath2, '$USER_HOME'
        $content = $content -replace $oldUnixPath, '$USER_HOME'
        $content = $content -replace $oldUser, 'your_username'
        Set-Content $file -Value $content -NoNewline
        Write-Host "Updated: $file"
    }
}
