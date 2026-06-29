@echo off
chcp 65001 >nul
REM TorrentSearch Web 一键启动脚本（Windows）
REM 用法：双击或命令行执行 start.cmd [dev|prod|build]
REM   无参数 = dev 开发模式
REM   prod   = 生产模式（先 build 再 start）
REM   build  = 仅构建

setlocal
cd /d "%~dp0webapp"
if errorlevel 1 (
  echo [错误] 未找到 webapp 目录
  pause
  exit /b 1
)

REM 检查 Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请安装 Node.js 20+ 后重试。
  echo        下载：https://nodejs.org/
  pause
  exit /b 1
)

REM 检查依赖
if not exist "node_modules" (
  echo [信息] 首次运行，正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
  )
)

REM 分发参数
set "MODE=%1"
if "%MODE%"=="" set "MODE=dev"

if /i "%MODE%"=="dev" (
  echo [启动] 开发模式（前端 :5173 / 后端 :3001）
  call npm run dev
  goto :end
)

if /i "%MODE%"=="build" (
  echo [构建] 生产构建...
  call npm run build
  goto :end
)

if /i "%MODE%"=="prod" (
  echo [构建] 生产构建...
  call npm run build
  if errorlevel 1 (
    echo [错误] 构建失败
    pause
    exit /b 1
  )
  echo [启动] 生产模式（单端口 :3000）
  call npm start
  goto :end
)

echo [错误] 未知参数：%MODE%
echo 用法：start.cmd [dev^|prod^|build]
pause
exit /b 1

:end
endlocal
