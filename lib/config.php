<?php
declare(strict_types=1);

require_once __DIR__ . '/announcement.php';

/* 配置与常量：所有入口共用 */
date_default_timezone_set('Asia/Shanghai');
@set_time_limit(75);

define('DATA_DIR', dirname(__DIR__) . '/data');
const ALLOWED_HOSTS = ['welearn.sflep.com', 'sso.sflep.com', 'centercourseware.sflep.com', 'courseappserver.sflep.com'];
const DEFAULT_ONE_CLICK = [
    'accuracy_min' => 96,
    'accuracy_max' => 100,
    'time_min_minutes' => 500,
    'time_max_minutes' => 550,
];

const DEFAULT_TICKER_MESSAGE = "🧪 当前仍在测试中，功能可能仍有 bug；请先用 1 个考核章节验证。\n" .
    "🧭 默认顺序模式、并发 1；并发 / 顺序 / 100% 正确率需管理员密码。\n" .
    "🎯 一键完成：总时长 500–550 分钟，可中断，下次续刷剩余；单章最多 900 秒。\n" .
    "⏳ 刷时长必须保持页面在前台，提前提交只记 0 秒。\n" .
    "🛑 关闭浏览器 / 断网会丢失当前章节未提交部分；已完成章节和服务端进度会保留。\n" .
    "✅ 已有答题记录、已学够的章节自动跳过；可先点“检测考核内容”。\n" .
    "🧠 Unit Test 真实答案已适配；首次建议只刷 1 个 Unit Test，确认平台确认后再批量。\n" .
    "📚 考核过滤默认只刷 Unit Test / Review / Test；普通章节请取消勾选。\n" .
    "🔐 保存账号密码为可选项，仅用于掉线自动重登；不要在公共电脑勾选。\n" .
    "🛠️ 维护期间仅管理员可用；维护开关在后台“系统维护”。\n" .
    "👥 服务器最多同时 8 人，满员排队；不要多开页面。\n" .
    "📣 网站更新与发现的问题以本滚动公告为准。";

const MAX_PROXY_BODY = 1048576;      // 1 MB
const MAX_USERS = 20000;
const MAX_TASKS_PER_USER = 20;
const MAX_ACTIVE_SLOTS = 8;
const SLOT_TTL = 45;
const QUEUE_TTL = 90;
const MAX_QUEUE = 300;
