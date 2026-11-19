# Welearn Helper | Web（独立 PHP 版）

> **重要说明：本仓库已不再按原上游项目的方案维护。**
>
> 当前代码是在早期 Web 版本基础上重写的独立 PHP 实现，目录结构、运行方式、服务端能力和更新节奏都已与上游分离。上游的 `index.html + 根目录 app.js` 方案不能直接套用到本仓库，后续上游更新也不能直接合并。

- 当前版本：**v2.4.1**
- 构建：`2026.11.19-57`
- 运行形态：`PHP + 原生 JavaScript`
- 仓库：`xavierbe278/WELearn_Helper-Web`

## 与上游的区别

| 项目 | 早期上游 / 旧 Web 分支 | 当前仓库 |
| --- | --- | --- |
| 首页 | `index.html` | `index.php` |
| 脚本 | 根目录单文件 `app.js` | `js/core.js`、`runner.js`、`ui.js`、`app.js` |
| 后端 | 仅简单代理 | `lib/` 模块化：账号、会话、名额、公告、维护、调试 |
| 运行数据 | 浏览器本地为主 | `data/` 服务端持久化 |
| 登录 | 单浏览器会话 | 单账号单会话，新浏览器登录会踢掉旧浏览器 |
| 任务 | 正确率 / 时长 | 正确率、时长、混合刷、一键完成断点续刷 |
| 维护 | 无 | 维护模式 + 管理员 token 自动续期 |
| 版本 | 跟随上游 | 独立版本线，从 `v2.4.1` 继续 |

## 功能概览

- 账号密码 / Cookie 两种登录方式；
- 课程、单元、小节三级选择；
- 只刷考核小节，自动检测；
- 正确率：固定值或区间，支持 100%；
- 学习时长：真实等待，按小节提交；
- 混合刷：每个小节先刷时长，再提交正确率；
- 一键完成：500–550 分钟总时长，可中断续刷；
- 已学够 / 已完成 / 已有答题记录跳过；
- 真实答案：Unit Test 的 `et-blank` / `et-choice`；
- 无答案阅读 / 听力 / 录音支持旧方法提交；
- 完成弹窗和日志分类列出未完成考核；
- 顶部成绩看板、课程完成度；
- 单账号单会话、管理员 token 自动续期；
- 首页弹窗公告与顶部滚动公告分离；
- 深色 / 浅色主题跟随系统。

## 目录结构

```text
.
├── index.php            控制台入口（PHP）
├── api.php              接口入口
├── common.js            登录密码加密
├── styles.css
├── js/
│   ├── core.js          常量、工具、SCO 模板
│   ├── runner.js        任务执行引擎
│   ├── ui.js            DOM / 渲染 / 模式
│   └── app.js           业务流程 / 服务端能力 / 启动
├── lib/
│   ├── config.php
│   ├── http.php
│   ├── accounts.php
│   ├── sessions.php
│   ├── slots.php
│   ├── announcement.php
│   ├── debug.php
│   ├── maintenance.php
│   └── proxy.php
├── admin/
│   └── index.php        管理后台
└── data/                运行数据（不要提交到 Git）
```

## 环境要求

- PHP 7.4+；
- `curl`、`openssl`、`mbstring` 扩展；
- `data/` 目录可写；
- Web 服务器执行 PHP（Nginx + PHP-FPM / Apache + PHP）。

## 部署

1. 上传全部代码文件；
2. **删除服务器上的旧 `index.html`**，否则部分服务器会优先返回旧首页；
3. 确保 `data/` 可写，但不要将 `data/` 上传到 Git；
4. 访问首页，进入 `/admin/`；
5. 首次后台密码为 `admin12341`，登录后立即修改；
6. 在后台配置公告、一键完成参数和维护状态。

## 数据与备份

运行数据全部在 `data/`：

- `users.json`、`stats.json`；
- `sessions.json`；
- `slots.json`；
- `announcement.json`、`ticker.json`；
- `oneclick.json`；
- `maintenance.json`；
- 账号记录与 `.secret`。

升级时只覆盖代码，不要覆盖 `data/`。

## 上游参考

以下项目仅作为历史参考，不代表当前代码与其保持同步：

- 原项目：`github.com/Avenshy`
- 早期 Web 分支：`github.com/xavierbe278/WELearn_Helper-Web`

当前仓库是独立实现，问题、功能和版本都以本仓库为准。

## 开源协议

GPLv3，完全免费，仅供编程技术交流与学习，禁止商业售卖。

请根据学校和老师要求谨慎使用，使用本工具产生的一切后果由使用者自行承担。
