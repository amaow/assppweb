# 部署指南（电视盒子 / 任意 Linux 主机）

## 1. 构建镜像

```bash
docker compose build
```

构建时会自动下载对应架构的 `ipatool`（amd64 / arm64），并把 Apple 签名资源 bake 进镜像，
运行时不需要再访问 `swcdn.apple.com`。

## 2. 准备数据目录

```bash
# 示例：U 盘挂载到 /mnt/usb
mkdir -p /mnt/usb/asspp-data
```

把 `compose.yml` 里的 volume 改成：

```yaml
volumes:
  - /mnt/usb/asspp-data:/data
```

## 3. 启动

```bash
docker compose up -d
```

访问 `http://盒子IP:8080`。

## 4. HTTPS（用户自理）

`itms-services://` 一键安装要求 plist 和 IPA 都走**有效公网 HTTPS**。
在盒子前端加一层反代（Nginx / Caddy），把 8080 暴露为 HTTPS 域名即可。
注意：`PUBLIC_BASE_URL` 环境变量可指定安装页生成链接时用的公网地址：

```yaml
environment:
  - PUBLIC_BASE_URL=https://apps.example.com
```

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `DATA_DIR` | 数据目录 | `/data` |
| `PORT` | 监听端口 | `8080` |
| `PUBLIC_BASE_URL` | 安装链接的公网基地址 | 空（自动推导） |
| `ACCESS_PASSWORD` | 访问密码（空=不设） | 空 |
| `MAX_DOWNLOAD_MB` | 单个 IPA 大小上限（0=不限） | `0` |
| `AUTO_CLEANUP_DAYS` | 自动删除 N 天前的包（0=关闭） | `0` |
| `AUTO_CLEANUP_MAX_MB` | 包总大小超限时删最旧的（0=关闭） | `0` |
| `IPATOOL_BIN` | ipatool 二进制路径 | `ipatool` |

## 数据目录结构

```
/data
├── accounts.json          # Apple 账号（密码 AES-256-GCM 加密）
├── .master.key            # 密码加密密钥（0600）
├── .ipatool-passphrase    # ipatool keychain 口令（0600）
├── ipatool-state/<hash>/  # 每个账号的 ipatool 会话（keychain/cookies）
├── packages/              # 下载好的 IPA
├── tmp/                   # 下载中转
├── tasks.json             # 已完成任务记录
└── version-cache.json     # 版本列表缓存（24h）
```

备份 `/data` 即备份全部数据。

## 说明

- Apple ID 密码只在登录瞬间经内存传给 ipatool，落盘的是加密后的版本。
- 登录会话过期后服务端自动用存的密码重登；只有苹果再次要求 2FA 时才需要手动处理
  （删除账号重新添加即可）。
- 同一 Apple ID 的下载任务串行执行，不同账号可并行。
- v1 不支持下载暂停/续传，失败重下即可。
