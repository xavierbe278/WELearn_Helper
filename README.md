# WELearn_Helper

> **本仓库已不再按原上游项目的方案维护。**
>
> 当前是独立的 **PHP Web 控制台 + Windows 桌面启动器**，目录结构、服务端能力、版本线均已与上游分离。上游的 `index.html + 根目录 app.js` 方案不能直接套用，后续上游更新也不能直接合并。

- 当前版本：**v2.4.1**
- 构建：`2026.11.19-57`
- 运行形态：`PHP + 原生 JavaScript + Python 桌面启动器`
- 仓库：`xavierbe278/WELearn_Helper`

## 目录

```text
WELearn_Helper/
├── Web/                  Web 控制台（PHP + 原生 JS）
│   ├── index.php
│   ├── api.php
│   ├── common.js
│   ├── styles.css
│   ├── js/
│   ├── lib/
│   ├── admin/
│   └── data/            运行数据，不提交到 Git
├── Desktop/              Windows 桌面启动器
│   ├── wlearn_helper.py
│   ├── start.bat
│   └── README.md
├── README.md
└── LICENSE
```

## 电脑版

桌面启动器使用 **Python 3.10+ + tkinter**，负责：

- 查找 Web 目录；
- 查找本机 PHP；
- 在 `127.0.0.1` 启动 PHP 内置服务器；
- 自动打开默认浏览器；
- 停止 / 重新打开本地服务；
- 没有 PHP 时允许手动选择 `php.exe`。

启动：

```text
Desktop/start.bat
```

或：

```powershell
python Desktop/wlearn_helper.py
```

详细说明见 [`Desktop/README.md`](Desktop/README.md)。

> 桌面版是启动器，不重复实现一份后端；它启动的就是 `Web/`，因此与在线 Web 版功能、数据和接口保持一致。

## Web 版

Web 目录可以单独部署到 PHP 服务器：

- PHP 7.4+；
- `curl`、`openssl`、`mbstring`；
- `Web/data/` 可写；
- 删除服务器上的旧 `index.html`，确保使用 `index.php`。

首次后台密码：`admin12341`，登录后请立即修改。

## 功能

- 账号密码 / Cookie 登录；
- 课程、单元、小节三级选择；
- 只刷考核小节，自动检测；
- 正确率固定值 / 区间，支持 100%；
- 学习时长真实等待；
- 混合刷：每个小节先刷时长，再提交正确率；
- 一键完成：500–550 分钟，可中断续刷；
- 已学够 / 已完成 / 已有答题记录跳过；
- 真实答案：Unit Test 的 `et-blank` / `et-choice`；
- 无答案阅读 / 听力 / 录音支持旧方法提交；
- 完成弹窗和日志分类列出未完成考核；
- 顶部成绩看板、课程完成度；
- 单账号单会话、管理员 token 自动续期；
- 首页弹窗公告与顶部滚动公告分离；
- 深色 / 浅色主题跟随系统。

## 与上游的区别

| 项目 | 早期上游 / 旧 Web 分支 | 当前仓库 |
| --- | --- | --- |
| 项目名 | Welearn Helper / WELearn_Helper-Web | WELearn_Helper |
| 首页 | `index.html` | `Web/index.php` |
| 脚本 | 根目录单文件 `app.js` | `Web/js/core.js`、`runner.js`、`ui.js`、`app.js` |
| 后端 | 简单代理 | `Web/lib/` 模块化：账号、会话、名额、公告、维护、调试 |
| 运行数据 | 浏览器本地为主 | `Web/data/` 服务端持久化 |
| 登录 | 单浏览器会话 | 单账号单会话，新浏览器登录会踢掉旧浏览器 |
| 任务 | 正确率 / 时长 | 正确率、时长、混合刷、一键完成断点续刷 |
| 维护 | 无 | 维护模式 + 管理员 token 自动续期 |
| 桌面版 | 无 | `Desktop/` Python 启动器 |
| 版本 | 跟随上游 | 独立版本线，从 `v2.4.1` 继续 |

## 上游参考

以下项目仅作为历史参考，不代表当前代码与其保持同步：

- 原项目：`github.com/Avenshy`
- 早期 Web 分支：`github.com/xavierbe278/WELearn_Helper-Web`

当前仓库是独立实现，问题、功能和版本都以本仓库为准。

## 开源协议

GPLv3，完全免费，仅供编程技术交流与学习，禁止商业售卖。

请根据学校和老师要求谨慎使用，使用本工具产生的一切后果由使用者自行承担。
