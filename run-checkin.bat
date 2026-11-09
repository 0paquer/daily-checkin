@echo off
rem AI 每日自动签到启动器（供 Windows 计划任务调用）
rem 用法：run-checkin.bat [trae^|workbuddy^|all] [--status] [--json] [--check]
setlocal
where node >nul 2>nul
if %errorlevel%==0 (
  node "%~dp0checkin.js" %*
  goto :eof
)
for %%P in (
  "%ProgramFiles%\nodejs\node.exe"
  "%APPDATA%\nvm\*\node.exe"
) do (
  if exist %%P (
    %%P "%~dp0checkin.js" %*
    goto :eof
  )
)
echo [错误] 未找到 node，请安装 Node.js ^>= 16
exit /b 2
