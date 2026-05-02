[![Stars](https://img.shields.io/github/stars/yo-ke5/lanzou-tool?style=flat-square&logo=github)](https://github.com/yo-ke5/lanzou-tool/stargazers)
[![Forks](https://img.shields.io/github/forks/yo-ke5/lanzou-tool?style=flat-square&logo=github)](https://github.com/yo-ke5/lanzou-tool/network/members)
[![License](https://img.shields.io/github/license/yo-ke5/lanzou-tool?style=flat-square)](https://github.com/yo-ke5/lanzou-tool/blob/main/LICENSE)

## ⭐ 项目热度

[![Stargazers over time](https://starchart.cc/yo-ke5/lanzou-tool.svg?variant=adaptive)](https://starchart.cc/yo-ke5/lanzou-tool)

---

***

## 📖 项目简介

**蓝奏云 Worker 工具** 是一个基于 Cloudflare Workers 平台的蓝奏云网盘解析与上传工具。能够解析蓝奏云分享链接，获取文件真实下载地址，支持文件夹解析、文件上传、分享链接生成等完整功能。

### ✨ 核心特性

- 🛡️ **边缘计算**：基于 Cloudflare Workers 平台，避免 IP 封禁
- ⚡ **高速稳定**：利用 Cloudflare 全球网络，解析速度快、可用性高
- 🌍 **全球访问**：自动选择最优节点，无视地域限制

#### 🔗 链接解析
- 支持蓝奏云（lanzou\*.com）分享链接解析
- 支持蓝奏云优享版（ilanzou.com）分享链接解析
- JSON 输出：标准化 API 响应，方便二次开发集成
- 302 重定向：支持直接重定向到下载地址，实现无缝下载体验
- 自动识别加密分享，支持带密码的链接解析
- 支持文件夹分享解析，列出所有文件

#### 🔐 账号管理
- **密码登录**：直接用蓝奏云账号密码登录，自动获取 Cookie
- **Cookie 登录**：支持手动填写 PHPSESSID、ylogin、phpdisk_info

#### ☁️ 文件管理
- **上传文件**：支持拖拽/选择文件上传（最大 100MB）
- **文件夹管理**：列出目录结构，支持选择上传目标文件夹
- **文件列表**：查看文件夹内所有文件及详细信息
- **生成分享**：上传后自动生成分享链接和提取码
- **删除文件**：支持删除文件和文件夹

#### 📊 统计与缓存
- **解析统计**：记录解析次数、成功/失败次数、缓存命中率
- **缓存机制**：解析结果缓存 1200 秒，减少重复请求
- **解析记录**：保存所有解析历史，支持按成功/失败筛选

#### 🖥️ 后台管理
- **管理员登录**：需要预设账号密码
- **统计查看**：查看总解析、成功/失败数、缓存率
- **记录管理**：查看所有解析记录，支持删除
- **重置统计**：清空统计数据

---

## 🚀 快速部署

### 1. 创建 Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)，进入 **Workers & Pages**
2. 点击 "创建服务"，输入服务名称（如 `lanzou-tool`）

### 2. 上传代码

1. 进入 Worker 编辑页面，点击 "编辑代码"
2. 将 `worker.js` 的完整代码粘贴到编辑器中
3. 点击 "保存并部署"

### 3. 配置 D1 数据库（必需）

1. 进入 **"储存和数据库" → "D1 SQL 数据库"**
2. 点击 **"创建数据库"**，输入名称 `wyjx`
3. 进入 **"Workers & Pages" → 你的 Worker → 设置 → 绑定"**
4. 点击 **"添加绑定"** → 选择 **"D1 数据库"**
5. 变量名称填写 `wyjx`，选择刚创建的数据库

### 4. 配置环境变量（可选，用于后台管理）

| 变量名 | 说明 |
|--------|------|
| `admin` | 后台管理面板用户名 |
| `pass` | 后台管理面板密码 |

### 5. 绑定自定义域（推荐）

在 **"触发器"** 选项卡点击 **"添加自定义域"**

### 6. 访问测试

- `https://域名/` - 使用界面
- `https://域名/admin` - 后台管理（需配置 admin/pass）

---

## 📚 API 文档

### 基础接口

#### 解析接口
```
GET /?url={分享链接}&pwd={密码}&type=json
```
```
GET /?url={分享链接}&type=json
```
**返回示例：**

```json
{
  "success": true,
  "msg": "解析成功",
  "type": "lanzou",
  "file_id": "123456",
  "file_name": "example.zip",
  "file_size": "10.00 MB",
  "download_url": "https://..."
}
```
#### 302 跳转下载
```
GET /?url={分享链接}&pwd={密码}
```
```
GET /?url={分享链接}
```
#### 管理员后台
```
GET /admin
```
#### 获取解析统计
```
GET /api/stats
```
#### 获取解析记录
```
GET /api/records
```

## 🔧 技术架构
```
                   ┌───────────────────┐
                   │      浏览器        │
                   │ (前端页面/API调用) │
                   └────────┬──────────┘
                            │ ① 发起请求
                            ▼
┌─────────────────────────────────────────────────────────┐
│                 Cloudflare Workers                      │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │              路由分发 (fetch)                    │    │
│  └─────────────┬───────────────┬───────────────────┘    │
│                │               │                        │
│         ┌──────▼──────┐  ┌──────▼──────┐                │
│         │  解析模块    │  │  上传/登录  │                │
│         │ LanzouParser│  │    模块     │                │
│         └──────┬──────┘  └──────┬──────┘                │
│                │               │                        │
│                └───────┬───────┘                        │
│                        ▼                                │
│         ┌─────────────────────────────┐                 │
│         │       D1 数据库 (wyjx)       │                 │
│         │     (缓存/统计/解析记录)     │                 │
│         └─────────────────────────────┘                 │
│                        │                                │
│         ┌──────────────┼──────────────┐                 │
│         ▼              ▼              ▼                 │
│    ┌────────┐    ┌──────────┐   ┌──────────┐            │
│    │  蓝奏云 │    │  蓝奏云  │   │  蓝奏云  │            │
│    │ 解析API │    │ 登录API  │   │ 上传API  │            │
│    └────────┘    └──────────┘   └──────────┘            │
│                        │                                │
│  ┌─────────────────────┴─────────────────────────────┐  │
│  │            返回结果 (HTML / JSON)                  │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                         │ ④ 返回响应
                         ▼
               ┌───────────────────┐
               │     浏览器        │
               │ (前端页面/API调用) │
               └───────────────────┘
```
### 数据库表结构
```
sql
-- 解析缓存表
CREATE TABLE parse_cache (
    cache_key TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    pwd TEXT DEFAULT '',
    result TEXT NOT NULL,
    expires_at INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
);

-- 统计表
CREATE TABLE parse_stats (
    id INTEGER PRIMARY KEY DEFAULT 1,
    total INTEGER DEFAULT 0,
    success INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    cached INTEGER DEFAULT 0
);

-- 解析记录表
CREATE TABLE parse_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    pwd TEXT DEFAULT '',
    type TEXT DEFAULT '',
    success INTEGER DEFAULT 0,
    file_name TEXT DEFAULT '',
    download_url TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now'))
);
```
## ⚠️ 免责声明
本项目仅供学习研究使用。严禁用于大规模爬取、破解付费功能、传播侵权内容等行为。作者不对因使用本项目导致的任何损失承担责任。

## 📄 许可证
MIT License

## 📞 联系方式

如有问题或建议，欢迎通过以下方式联系：

- GitHub Issues: [提交问题](https://github.com/yo-ke5/lanzou-tool/issues)

***

<p align="center"> Made with ❤️ by <a href="https://github.com/yo-ke5">yo-ke5</a> </p> 


