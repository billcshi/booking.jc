# booking.jc

[English](README.md) | 简体中文

## TL;DR

Docker 一键部署（需要 Git、Docker Compose 和 OpenSSL）：

```bash
git clone YOUR_REPOSITORY_URL booking.jc && cd booking.jc && ./scripts/deploy-docker.sh
```

裸服务器一键部署（需要 Git、Node.js 22、npm 和 OpenSSL）：

```bash
git clone YOUR_REPOSITORY_URL booking.jc && cd booking.jc && ./scripts/deploy-server.sh
```

请把 `YOUR_REPOSITORY_URL` 替换为 GitHub **Code** 菜单中的 HTTPS 或 SSH 地址。
首次运行会自动创建私有 `.env`、显示随机生成的 Admin 密码、初始化 SQLite，
并显示随机全群 Key；这些值只在创建时输出，请立即保存。Docker 会在后台运行；
裸服务器脚本以前台方式运行，方便交给 systemd、Supervisor 或托管平台管理。
已有 `.env` 和数据库不会被覆盖。

booking.jc 是一个适合私人群组自行部署的住宿日历。朋友无需注册账号即可查看空余时间并提交住宿申请，管理员则负责审批、安排睡位、维护不可住日期和旅行住宿。

公开 Host 名称默认为 `Host`，可在 Admin 的固定住所设置中改成房主昵称。Git 仓库不包含真实身份、住客记录、生产凭据、私人网络信息或精确住址。

## 功能

- 适配手机的月历、空余容量和入住热度展示
- 住客端与 Admin 均支持中英文切换并记住语言偏好
- 全群共享 Key，以及可绑定住客昵称的个人邀请 Key
- 住宿申请的审批、拒绝、取消、编辑和历史补录
- 住客通过私密管理链接查看状态或取消申请
- 按完整日期范围检查容量并自动分配睡位
- Admin 可保留、手动调整或自动重算每条已确认记录的睡位
- 可配置普通睡位、需要住客接受的 sofa、管理员专用备用位
- 独占住宿，可阻止同一地点的重叠预订
- 可编辑的旅行住宿、日期、地点、房间和床位
- 管理员维护不可住时段，旅行期间可同步关闭固定住所
- 首次初始化时配置固定住所和睡位
- Admin 后台随时调整 Host 名称、地点、容量、可见性和分配顺序
- SQLite 持久化与 Docker Compose 部署

公共日历不会显示待审批住客姓名、内部备注、凭据、精确地址或申请管理 token。

## 技术栈

- Next.js 16 App Router、React 19
- TypeScript
- `better-sqlite3`
- Docker 与 Docker Compose

## 本地快速开始

需要 Node.js 22、npm，以及当前平台上 `better-sqlite3` 所需的构建支持。

```bash
cp .env.example .env
# 替换 .env 中的所有占位值
npm install
npm run db:init -- --interactive
npm run dev
```

打开 `http://localhost:3000` 查看日历，管理员入口位于
`http://localhost:3000/admin`。

交互初始化会询问：

1. 固定住所的显示名称
2. 地点标签
3. 睡位名称、容量和类型

睡位格式为 `名称 | 容量 | 标记`，多项使用分号分隔：

```text
Guest bed | 2 | normal; Sofa | 1 | sofa; Air mattress | 1 | hidden
```

标记含义：

- `normal`：普通公开容量
- `sofa`：只有住客明确接受 sofa 时才参与分配
- `hidden`：不计入公开容量；仅在住客主动接受并由管理员审批后使用

可以组合 `sofa,hidden`。交互中填写的私人地点和房间信息只会写入 Git 已忽略的 SQLite 数据库。

`db:init` 是幂等的：全新数据库会随机生成全群 Key，并在初始化输出中显示一次，请及时保存。重复运行会创建缺失的 schema，但不会覆盖已有 Key、住宿设置或预订。数据库已有固定住所时，请在 Admin 后台修改；初始化脚本会跳过交互覆盖。

## 环境变量

| 变量 | 用途 | 要求 |
| --- | --- | --- |
| `DATABASE_PATH` | SQLite 数据库路径 | 放在持久化且被 Git 忽略的目录中 |
| `ADMIN_USERNAME` | 管理员用户名 | 至少 2 位，不能使用 `admin` |
| `ADMIN_PASSWORD` | 管理员密码 | 至少 16 位 |
| `SESSION_SECRET` | Session HMAC 密钥 | 至少 32 位随机字符 |
| `APP_TIME_ZONE` | Admin 日历计算“今天”时使用的时区 | IANA 时区，例如 `UTC` |
| `HOST_PORT` | Docker Compose 对外端口 | 默认 `3000` |
| `INITIAL_HOME_NAME` | 首次初始化的住所名称 | 只能填写不敏感的通用标签 |
| `INITIAL_HOME_LOCATION` | 首次初始化的地点标签 | 只能填写不敏感的通用标签；默认 `Seattle` |
| `INITIAL_HOME_RESOURCES` | 首次初始化的睡位列表 | 仅放不敏感的默认值，格式为 `名称 \| 容量 \| 标记` |

可以生成随机 Session 密钥：

```bash
openssl rand -hex 32
```

不要提交 `.env`、SQLite 数据库、备份、住客导出或私人部署备注。仓库已整体忽略 `data/` 和 `backups/`。
不要把真实或私人的住所名称、精确地点、私人房间信息写进 `.env`；请通过交互初始化输入，使其只保存在被忽略的 SQLite 数据库中。

## 常用命令

```bash
npm run dev                         # 开发服务器
npm run db:init                     # 无交互地创建或升级数据库
npm run db:init -- --interactive   # 交互配置全新数据库
npm run deploy:docker               # Docker 构建、初始化并启动
npm run deploy:server               # 裸机安装、初始化、构建并启动
npm run lint                        # ESLint
npm run build                       # 生产构建
npm start                           # 校验生产配置并启动
```

项目目前没有自动化测试套件。提交代码前应运行 lint 和 build，并使用一次性数据手动验证受影响的公共及管理员流程。

## Docker 部署

一键脚本会在缺少 `.env` 时生成安全凭据，然后构建镜像、初始化数据库、启动
Compose，并等待容器进入 healthy：

```bash
./scripts/deploy-docker.sh
```

首次部署时可指定端口，例如：

```bash
HOST_PORT=8080 ./scripts/deploy-docker.sh
```

如需手动准备配置，可使用下面的完整流程：

```bash
cp .env.example .env
# 修改所有占位值
docker compose build
docker compose run --rm booking-jc npm run db:init -- --interactive
docker compose up -d
docker compose ps
```

容器内服务监听 `3000`，宿主机端口由 `HOST_PORT` 决定。SQLite 保存在宿主机 `./data`，挂载到容器 `/app/data`。

详细健康检查、备份、恢复、升级和回滚方法见 [docs/OPERATIONS.md](docs/OPERATIONS.md)。

## 裸服务器部署

不使用 Docker 时运行：

```bash
./scripts/deploy-server.sh
```

脚本会创建缺失的 `.env`、执行 `npm ci`、初始化 SQLite、构建应用，然后以前台
方式在 `${PORT:-3000}` 启动。生产环境请用 systemd、Supervisor 或托管平台保持
进程运行，并通过反向代理提供 HTTPS。私人住所信息可在首次初始化时交互填写，
或启动后在 Admin 中修改。

## Admin 中的固定住所设置

管理员可以在 `/admin` 的“固定住所设置”中：

- 修改公共页面使用的 Host 显示名，例如房主昵称
- 修改公开显示名称和地点标签
- 新增、删除、重命名睡位
- 修改每个睡位容量
- 调整自动分配优先顺序
- 设置公开容量或管理员专用备用容量
- 设置是否需要住客接受 sofa

系统通过资源 ID 保持睡位身份，不会因为重排或改名误认床位。已有分配记录的睡位不能删除，容量不能降到历史分配峰值以下，并且至少要保留一个公开睡位。

## 日期和分配规则

日期采用酒店语义：入住日占用当晚，退房日不占用。例如 7 月 10 日入住、7 月 12 日退房，占用 7 月 10 日和 11 日两晚。

审批时会在整个日期范围内按优先级分配睡位。标记为 sofa 的资源只会分配给明确接受 sofa 的住客；隐藏备用位只会在管理员明确允许时使用。独占申请即使人数少于总容量，也会锁定整个住宿地点。

编辑已确认的住宿记录时，管理员可以保留当前睡位、逐个睡位手动分配人数，或要求系统自动重新分配。手动分配的总人数必须等于住宿人数，并继续检查住客同意状态、完整日期范围容量和独占冲突。

公共申请最长 90 晚；管理员历史补录单条最长 10 年。默认日历隐藏过去日期，可通过“查看历史”显示。

## 主要流程

1. 群成员输入全群 Key 或个人邀请 Key。
2. 选择入住和退房日期，填写昵称、人数及睡位偏好。
3. Host 在 `/admin` 审批、拒绝或编辑申请。
4. 审批时系统在事务中重新检查容量、不可住时段、独占冲突和睡位分配。
5. 住客保存私密管理链接，用于查看状态或取消申请。

创建旅行住宿时，每行填写一个 `名称 | 容量` 的睡位，行顺序即分配优先级。管理员还可以在旅行期间同步把固定住所标记为不可住。

## 隐私与安全

- 只有通过群组 Key 后，日历才显示已批准住客的昵称。
- 申请管理链接包含 bearer token，应按密码处理。
- 管理员和群组 Session 使用签名、HTTP-only、same-site Cookie。
- 登录和 Key 尝试有进程内速率限制。
- 私密申请页面禁止缓存、referrer 和搜索引擎索引。
- 这是面向小规模自行部署的应用，并非加固后的多租户平台。生产环境应启用 HTTPS、限制管理员入口、及时更新依赖并加密备份。

安全问题请私下联系仓库所有者，不要在公开 Issue 中提交凭据、住客信息或部署细节。

## 贡献

修改前请阅读 [AGENTS.md](AGENTS.md)。不要把私人身份或部署信息写入 tracked 文件；修改 Next.js 代码前阅读依赖中随附的文档；提交前运行 `npm run lint` 和 `npm run build`。

## License

本项目使用 MIT License，详见 [LICENSE](LICENSE)。
