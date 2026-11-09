# AI 桌面工具每日自动签到

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A516-green)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)]()
[![Config](https://img.shields.io/badge/config-0-blue)]()
[![Platforms](https://img.shields.io/badge/平台-Trae%20%2B%20WorkBuddy-blueviolet)]()
[![License](https://img.shields.io/badge/license-MIT-orange)]()

一套脚本，两个平台：自动完成 **Trae CN / TRAE SOLO CN** 与 **WorkBuddy** 的每日签到领积分，全部利用本机客户端登录态直签。

> **一句话总结：不用抓包、不用填 token、不用装依赖、不用打开客户端 —— 克隆下来一条命令全签完。**

---

## ✨ 为什么选这个

常见的签到脚本方案：抓包提 token 手动填配置、token 频繁过期要重新抓、Python 还得装依赖、GUI 工具要常驻后台…… 每个平台一套维护成本。

**本项目从原理上绕开了这些问题，且一次整合多个平台：**

| | 🔥 本项目 | 😮‍💨 常见同类方案 |
|---|---|---|
| **Token** | ❌ 不用填。自动从本机客户端读取/解密登录态 | 抓包提取，手动填入配置 |
| **Token 过期** | 每次运行实时读取当前登录态，客户端重新登录后自动跟随 | 缓存的 token/refreshToken 会失效，需重新提取 |
| **Token 安全** | 零暴露：token 全程不出本机，日志强制脱敏 | Token 明文写在配置里，有泄露风险 |
| **依赖** | 零依赖，仅 Node.js 内置模块 | Python 需 pycryptodome，GUI 需 .NET + WebView2 |
| **配置** | 零配置，自动扫描客户端目录 + 自动提取设备号 | 手动配置 token、设备号、账号列表 |
| **平台覆盖** | Trae CN / TRAE SOLO CN / WorkBuddy 一条命令全签 | 一个项目只管一个平台 |
| **常驻运行** | 一次运行即退出，配合任意定时任务 | GUI 工具需常驻后台 |
| **风控自愈** | Trae 命中 9074 自动切换派生设备号重签 | 多数直接失败 |

### 核心优势详解

- 🔐 **零 Token、零抓包**
  - **Trae**：按客户端同款算法解密本机 `storage.json` 中的加密登录态（AES-128-CBC + SHA512 派生密钥）
  - **WorkBuddy**：复用本机登录态票据，通过 wbipc 命名管道完成带认证会话，由客户端代理注入登录态
  - 你的凭据从头到尾不离开本机，日志里只显示脱敏片段

- 📦 **零依赖**
  只用 Node.js 内置模块（`crypto` / `fs` / `os` / `path` / `https` / `net`）。没有 `node_modules`，没有 `pip install`，克隆即用。

- ⚙️ **零配置**
  自动扫描各平台客户端数据目录（Windows / macOS / Linux），设备号自动从客户端配置/日志提取。

- 🧩 **模块化多平台**
  每个平台独立模块（`src/trae.js`、`src/workbuddy.js`），想加新平台照着一个写就行；统一 CLI、统一退出码、统一日志。

- 👥 **多账号自动全签**
  本机同时装了 Trae CN 和 TRAE SOLO CN？两个都会签，按 token 自动去重。

- 🔁 **幂等安全**
  已签到视为成功（exit 0），定时任务里放心跑。

- 📈 **成长中心 · 连续签到统计**
  按平台分别记录 累计 / 当前连续 / 最长连续 签到天数，不依赖接口字段；
  自动兼容迁移旧版单平台项目（trae-daily-checkin / workbuddy-daily-checkin）的历史数据，签到记录不丢。

- 🤖 **自动化友好**
  统一退出码（0/1/2）+ `--json` 机器可读输出 + 每个模块都是可 require 的库。

---

## 🚀 如何使用

### 1. 准备

- 安装 [Node.js](https://nodejs.org) ≥ 16（仅用内置模块，无需 `npm install`）
- 本机登录过对应客户端（至少一次）：
  - Trae：安装并登录 **Trae CN** 或 **TRAE SOLO CN**
  - WorkBuddy：安装并运行 **WorkBuddy 桌面客户端**

### 2. 自检（可选，推荐先跑一次）

```bash
node checkin.js --check        # 全部平台自检，不联网
node checkin.js trae --check   # 只自检 Trae
```

输出各平台发现的账号（token 脱敏）、设备号，确认登录态读取正常。

### 3. 运行

```bash
node checkin.js                # 全部平台签到（默认）
node checkin.js trae           # 只签 Trae CN / TRAE SOLO CN
node checkin.js workbuddy      # 只签 WorkBuddy
node checkin.js --status       # 签到并查询状态/积分
node checkin.js --json         # 机器可读输出，供自动化解析
node checkin.js --no-stats     # 关闭连续天数统计
```

> 在 Git Bash / WSL 里可用仓库里的 `run-checkin.sh` / `run-checkin.bat` 自动定位 node。

### 4. 接入每日定时任务

**WorkBuddy 自动化**：对话里说「每天早上 9 点运行签到脚本」并指定本脚本路径。

**TRAE 内置自动化**：

```
帮我设置每天早上 9 点自动运行签到脚本：
node "C:\path\to\daily-checkin\checkin.js"
```

**Windows 计划任务**：

```powershell
schtasks /create /tn "DailyCheckin" /tr "node C:\path\to\daily-checkin\checkin.js" /sc daily /st 09:00
```

### 5. 数据与日志

默认集中存放在 `~/.daily-checkin/`（可用环境变量覆盖）：

| 文件 | 说明 |
|---|---|
| `checkin.log` | 统一运行日志（token 自动脱敏） |
| `checkin-history.json` | 各平台连续签到历史（按平台分开记录） |

### 6. 进阶（可选）

默认零配置即可运行。特殊需求时可用环境变量覆盖：

**通用**：

| 环境变量 | 说明 |
|---|---|
| `CHECKIN_DIR` | 日志与历史文件目录（默认 `~/.daily-checkin`） |
| `CHECKIN_LOG` | 统一日志文件路径 |
| `CHECKIN_HISTORY` | 统一历史文件路径 |

**Trae**：

| 环境变量 | 说明 |
|---|---|
| `TRAE_API_BASE` | API 地址（默认 `https://api.trae.cn`） |
| `TRAE_APP_HOME` | 客户端数据目录根路径 |
| `TRAE_EXTRA_PATHS` | 附加扫描路径，分号分隔 |
| `TRAE_REQ_SOURCE` | 签到来源（默认 1 = IDE） |

**WorkBuddy**：

| 环境变量 | 说明 |
|---|---|
| `WBIP_ENDPOINT_FILE` | 显式指定 endpoint.json 路径（缺失即报错，不静默回退） |
| `WORKBUDDY_HOME` | WorkBuddy 主目录（其下应有 `wbipc/endpoint.json`） |
| `WBIP_ENDPOINT` + `WBIP_TICKET` | 高级部署：直连模式，跳过读取 endpoint.json |

---

## 🔍 工作原理

```
                    ┌────────────────────────────┐
                    │   checkin.js（统一入口）     │
                    │   trae / workbuddy / all    │
                    └──────────┬─────────────────┘
              ┌────────────────┴────────────────┐
              ▼                                 ▼
┌───────────────────────────┐     ┌───────────────────────────┐
│ Trae 模块                  │     │ WorkBuddy 模块             │
│ 1. 扫描客户端目录           │     │ 1. 读取 wbipc/endpoint.json│
│    storage.json 登录态      │     │ 2. wbipc 命名管道会话       │
│ 2. 解密 iCubeAuthInfo      │     │    （HMAC 挑战-响应握手）    │
│    (AES-128-CBC)          │     │ 3. 受控 HTTP 代理直签       │
│ 3. 提取真实设备号           │     │    token 由客户端注入        │
│ 4. 直调 api.trae.cn        │     │    （凭据不出客户端进程）    │
│    9074 → 换派生设备号重签  │     │                           │
└─────────────┬─────────────┘     └─────────────┬─────────────┘
              └────────────────┬────────────────┘
                               ▼
              ┌────────────────────────────┐
              │ common.js（共享）           │
              │ 统一日志（脱敏）             │
              │ 按平台连续签到统计           │
              │ → ~/.daily-checkin/        │
              └────────────────────────────┘
```

**只读原则**：只读取登录态与设备号文件，不修改客户端任何文件；不触碰密码；不打印完整 token。

### 退出码

| 退出码 | 含义 |
|---|---|
| 0 | 全部平台签到成功 / 已签 |
| 1 | 部分或全部平台失败 |
| 2 | 无任何平台登录态（先去登录客户端） |

---

## 📁 项目结构

```
daily-checkin/
├── checkin.js        # 统一 CLI 入口（平台选择 / 参数 / 汇总 / 退出码）
├── src/
│   ├── common.js     # 共享：日志、日期工具、按平台连续签到统计
│   ├── trae.js       # Trae CN / TRAE SOLO CN 签到模块
│   ├── workbuddy.js  # WorkBuddy 签到模块
│   └── wbipc.js      # WorkBuddy 本地 IPC（命名管道）客户端库
├── run-checkin.bat   # Windows 启动器（自动定位 node）
├── run-checkin.sh    # Git Bash / WSL / crontab 启动器
└── package.json
```

---

## ⚠️ 注意事项

- **电脑需开机**：定时任务执行时段设备不能关机/休眠。
- **登录态会过期**：长期不打开客户端，本地登录态可能失效 —— 重新登录一次即可（实测约一个月一次）。
- **仅供个人学习**：请勿用于商业用途或大规模部署，签到行为请遵守各平台用户协议。

---

## 📄 许可证

[MIT](./LICENSE)
