# 🎓 WELearn_Helper

> **一个独立的 WeLearn 学习辅助项目：Web 控制台 + Windows 桌面启动器。**
>
> 本项目已不再按原上游项目的方案维护。早期参考过一些开源实现，但当前的目录结构、服务端能力、任务引擎和版本线均为独立实现，后续不会与上游保持代码同步。

<p>
  <img alt="version" src="https://img.shields.io/badge/version-v2.4.3-0ea5e9" />
  <img alt="php" src="https://img.shields.io/badge/PHP-7.4%2B-777bb4" />
  <img alt="python" src="https://img.shields.io/badge/Desktop-Python%203.10%2B-3776ab" />
  <img alt="license" src="https://img.shields.io/badge/license-GPLv3-green" />
</p>

## ✨ 项目简介

WELearn_Helper 由两部分组成：

| 部分 | 说明 | 默认地址 |
| --- | --- | --- |
| 🖥️ Desktop | Windows 桌面启动器，Python + tkinter | `http://127.0.0.1:5566/` |
| 🌐 Web | PHP + 原生 JavaScript 控制台 | Web 默认端口 `80` / 线上 `80`、`443` |

桌面版不是另一套后端，它启动的就是 `Web/`，功能和数据完全一致。

## 🧩 功能

- 🔐 账号密码 / Cookie 登录
- 📚 课程 → 单元 → 小节三级选择
- ✅ 只刷考核小节，自动检测
- 🎯 正确率：固定值 / 区间，支持 100%
- ⏱️ 学习时长：真实等待，按小节提交
- 🔀 混合刷：每个小节先刷时长，再提交正确率
- ⚡ 一键完成：500–550 分钟，可中断续刷
- ⏭️ 已学够 / 已完成 / 已有答题记录跳过
- 🧠 真实答案：Unit Test 的 `et-blank` / `et-choice`
- 📝 无答案阅读 / 听力 / 录音支持旧方法提交
- 📋 完成弹窗 / 日志分类列出未完成考核
- 📊 顶部成绩看板、课程完成度
- 👤 单账号单会话，新登录踢掉旧浏览器
- 🛡️ 管理员 token 自动续期
- 🌗 深色 / 浅色主题跟随系统
- 📢 首页弹窗公告与顶部滚动公告分离

## 📁 目录结构

```text
WELearn_Helper/
├── Web/                    🌐 Web 控制台
│   ├── index.php
│   ├── api.php
│   ├── start.bat           Web 一键启动（默认端口 80）
│   ├── common.js
│   ├── styles.css
│   ├── js/
│   ├── lib/
│   ├── admin/
│   └── data/               运行数据，不提交到 Git
├── Desktop/                🖥️ Windows 桌面启动器
│   ├── wlearn_helper.py
│   ├── start.bat
│   ├── setup_php.ps1       可选：下载便携版 PHP
│   ├── php/                便携版 PHP 放置目录
│   └── README.md
├── 启动.bat                一键启动（优先桌面版）
├── README.md
└── LICENSE
```

## 🚀 快速开始

### 🖥️ 桌面版（推荐本地使用）

双击项目根目录：

```text
启动.bat
```

执行顺序：

1. 有 Python → 启动 `Desktop/wlearn_helper.py`；
2. 没有 PHP → 尝试下载便携版 PHP 到 `Desktop/php`；
3. 没有 Python → 回退 `Web/start.bat`。

桌面版默认地址：

```text
http://127.0.0.1:5566/
```

桌面启动器支持：

- 自动查找 Web 目录；
- 自动查找 / 手动选择 `php.exe`；
- 启动本地 PHP 服务；
- 自动打开浏览器；
- 停止 / 重新打开网页；
- 没有 PHP 时调用 `setup_php.ps1` 下载便携版。

### 🌐 Web 版

线上部署到 PHP 服务器后，直接走 Web 默认端口：

```text
http://your-domain/
https://your-domain/
```

本地想直接双击运行：

```text
Web/start.bat
```

默认使用 **80 端口**：

```text
http://127.0.0.1/
```

Web 环境要求：

- PHP 7.4+；
- `curl`、`openssl`、`mbstring`；
- `Web/data/` 可写；
- 删除旧 `index.html`，确保使用 `index.php`。

首次后台密码：

```text
admin12341
```

登录后请立即修改。

## ⚙️ 数据与部署

运行数据全部在：

```text
Web/data/
```

包括账号、会话、名额、公告、维护状态、成绩、任务进度等。

升级时只覆盖代码：

```text
❌ 不要覆盖 Web/data/
✅ 只更新 Web/ 与 Desktop/ 下的代码
```

## 🧠 与早期方案的区别

| 项目 | 早期上游 / 旧 Web 分支 | 当前仓库 |
| --- | --- | --- |
| 项目名 | Welearn Helper / WELearn_Helper-Web | **WELearn_Helper** |
| 首页 | `index.html` | `Web/index.php` |
| 脚本 | 根目录单文件 `app.js` | `Web/js/core.js`、`runner.js`、`ui.js`、`app.js` |
| 后端 | 简单代理 | `Web/lib/` 模块化 |
| 数据 | 浏览器本地为主 | `Web/data/` 服务端持久化 |
| 登录 | 单浏览器会话 | 单账号单会话 |
| 任务 | 正确率 / 时长 | 正确率、时长、混合刷、一键完成 |
| 桌面版 | 无 | `Desktop/` Python 启动器 |
| 版本 | 跟随上游 | 独立版本线 `v2.4.3` |

## 🙏 参考与致谢

早期思路和接口研究参考过以下开源项目，感谢原作者：

- [Avenshy](https://github.com/Avenshy)
- [YZBRH/Welearn_helper](https://github.com/YZBRH/Welearn_helper)
- [xavierbe278/WELearn_Helper-Web](https://github.com/xavierbe278/WELearn_Helper-Web)

> 以上项目仅作为历史参考。当前 `WELearn_Helper` 已独立维护，功能和代码不对上游做兼容承诺。

## 📄 License

GPLv3，完全免费，仅供编程技术交流与学习，禁止商业售卖。

请根据学校和老师要求谨慎使用，使用本工具产生的一切后果由使用者自行承担。
