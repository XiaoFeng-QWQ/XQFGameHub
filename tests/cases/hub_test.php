<?php

/**
 * XQFGameHub 游戏中心转型 —— 冒烟测试
 *
 * 覆盖转型后的信息架构不变量，防止后续改动把玩法页/首页骨架改坏：
 *   1. 路由契约：/ 是游戏中心、/turing 是 1v1、/player 与 /collection 仍渲染 SPA
 *   2. 页面契约：1v1 SPA 的关键元素 id 一个都不能少（否则 script.js 直接报错）
 *   3. 导航契约：7 个玩法页都注入了 hub-nav 容器与两个资源
 *   4. 资源契约：每个 ?v= 占位都在控制器的注入列表里（否则版本号留空）
 *   5. 品牌契约：用户可见文案已是 XQFGameHub，且不残留旧站名
 *   6. 兼容契约：库名/WS 路由/type 前缀/localStorage 键未被改名
 */

$root = dirname(__DIR__, 2);
define('HUB_ROOT', $root);

function hub_read(string $rel): string
{
    $path = HUB_ROOT . '/' . $rel;
    if (!is_file($path)) {
        throw new AssertionError("文件不存在: {$rel}");
    }
    return (string)file_get_contents($path);
}

/** 递归找出 Public 下所有 index.html（glob 的 ** 在 Windows 上不可用） */
function hub_all_pages(): array
{
    $out = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(HUB_ROOT . '/Public'));
    foreach ($it as $f) {
        if ($f->isFile() && $f->getFilename() === 'index.html') {
            $out[] = $f->getPathname();
        }
    }
    sort($out);
    return $out;
}

// ============================================================
//  1. 路由契约
// ============================================================

function test_hub_routes_contract(): void
{
    $router = hub_read('App/Core/Router.php');

    assert_contains("'/' => [GameController::class, 'index']", $router, '首页应指向游戏中心 index');
    assert_contains("'/turing' => [GameController::class, 'turingIndex']", $router, '/turing 应指向 turingIndex');

    // 档案/收藏是 1v1 SPA 内的视图，必须由 turingIndex 渲染（否则 P1 后白屏）
    assert_contains("'/player/{nickname}' => [GameController::class, 'turingIndex']", $router, '玩家档案必须复用 turingIndex');
    assert_contains("'/collection/{token}'", $router, '公开收藏路由应保留');

    // 玩法页路由不得丢失（/bot-panel 已整体移除，功能并入 /lobby 弹窗）
    foreach (['/lobby', '/temp-chat', '/gomoku', '/soup', '/weekly-report', '/account'] as $p) {
        assert_contains("'{$p}' =>", $router, "路由丢失: {$p}");
    }

    // 已下线的页面不得再出现在路由里
    assert_not_contains("'/bot-panel'", $router, '/bot-panel 路由应已移除');
}

function test_hub_controller_renders_new_homepage(): void
{
    $ctrl = hub_read('App/Controllers/GameController.php');

    // 首页渲染的是新游戏中心页，且只注入 hub 资源（不再注入 script.js）
    assert_contains("self::PUBLIC_DIR . 'index.html'", $ctrl, 'index() 应渲染根 index.html');
    assert_contains("\$files = ['/style.css', '/hub.css', '/shared.js', '/hub.js'];", $ctrl, '首页注入列表应为 hub 资源');

    // 1v1 页由 turing/index.html 渲染
    assert_contains("self::PUBLIC_DIR . 'turing/index.html'", $ctrl, 'turingIndex 应渲染 turing/index.html');

    // 静态资源白名单必须登记新增资源
    foreach (['/hub.css', '/hub.js', '/hub-nav.js', '/turing/index.html'] as $res) {
        assert_contains("'{$res}'", $ctrl, "STATIC_RESOURCES 未登记: {$res}");
    }
}

// ============================================================
//  2. 页面契约（1v1 SPA 元素完整性）
// ============================================================

function test_turing_page_keeps_all_spa_ids(): void
{
    $html = hub_read('Public/turing/index.html');

    // 这些 id 被 script.js 直接 getElementById，缺一个就会在运行时抛错
    // 注意：btn-settings 已从 /turing 顶部旧组件移除，其绑定已加 null 守卫，故不在此列。
    $critical = [
        'landing-page', 'matching-page', 'chat-page', 'profile-page', 'result-area',
        'btn-start', 'btn-back', 'nickname-input', 'password-input', 'btn-save-register',
        'recover-input-main', 'btn-recover-main', 'id-card-display', 'id-card-nickname',
        'login-toggle', 'login-panel', 'btn-judge-human', 'btn-judge-ai',
        'chat-input', 'btn-send', 'timer-display', 'settings-overlay',
        'fate-test-overlay', 'fate-history-overlay', 'online-num', 'duration-select',
        'reconnect-overlay',
    ];

    $missing = [];
    foreach ($critical as $id) {
        if (!str_contains($html, 'id="' . $id . '"')) {
            $missing[] = $id;
        }
    }
    assert_true($missing === [], '1v1 页缺失关键元素 id: ' . implode(', ', $missing));

    // SPA 依赖的三个脚本必须仍在
    foreach (['/script.js', '/shared.js', '/temp-invite.js'] as $js) {
        assert_contains($js . '?v=', $html, "turing 页缺少脚本: {$js}");
    }
}

function test_homepage_is_game_center(): void
{
    $html = hub_read('Public/index.html');

    // 首页不再承载 1v1 SPA
    assert_not_contains('/script.js', $html, '游戏中心首页不应引入 script.js（会带上匹配状态机与对局定时器）');
    assert_not_contains('id="landing-page"', $html, '首页不应再包含 1v1 匹配页');
    assert_not_contains('btn-start', $html, '首页不应再包含「马上开始匹配」原按钮 id');

    // 必须存在的游戏中心结构
    assert_contains('id="hub-page"', $html, '缺少游戏中心容器');
    assert_contains('id="hub-online-num"', $html, '缺少在线人数占位');
    assert_contains('XQFGameHub', $html, '缺少品牌名');

    // 全部玩法入口都要在首页出现（/bot-panel 已移除，功能并入 /lobby 弹窗）
    foreach (['/turing', '/soup', '/gomoku', '/lobby', '/temp-chat', '/weekly-report'] as $href) {
        assert_contains('href="' . $href . '"', $html, "首页缺少入口: {$href}");
    }

    // 已下线入口不得再出现在首页
    assert_not_contains('href="/bot-panel"', $html, '首页仍残留 /bot-panel 入口');
    assert_not_contains('/account', $html, '首页不应有账号页入口（账号走顶部导航）');

    // 首页只应引入两个脚本
    assert_contains('/shared.js?v=', $html, '首页应引入 shared.js');
    assert_contains('/hub.js?v=', $html, '首页应引入 hub.js');
}

// ============================================================
//  3. 导航契约
// ============================================================

function test_all_game_pages_have_global_nav(): void
{
    // 聊天室主动退出「玩法」按钮（data-hub-nav="off"），故不在此列
    $pages = [
        'Public/turing/index.html', 'Public/gomoku/index.html', 'Public/soup/index.html',
        'Public/temp-chat/index.html',
        'Public/weekly-report/index.html', 'Public/account/index.html',
    ];

    foreach ($pages as $page) {
        $html = hub_read($page);
        assert_contains('id="hub-nav"', $html, "{$page} 缺少「玩法」按钮挂载点");
        assert_contains('/hub.css?v=', $html, "{$page} 缺少 hub.css");
        assert_contains('/hub-nav.js?v=', $html, "{$page} 缺少 hub-nav.js");

        // 挂载点必须在 header 的 .header-actions 内（与主题等按钮同排）
        $hdrStart = strpos($html, '<header');
        $hdrEnd = strpos($html, '</header>');
        $header = substr($html, $hdrStart, $hdrEnd - $hdrStart);
        $navPos = strpos($header, 'id="hub-nav"');
        $actPos = strpos($header, '<div class="header-actions"');
        assert_true($navPos !== false && $navPos > 0, "{$page} 的 hub-nav 不在 header 内");
        assert_true($actPos !== false && $navPos > $actPos, "{$page} 的 hub-nav 不在 header-actions 内");
        assert_eq(1, substr_count($header, 'class="header-actions"'), "{$page} 出现多个 header-actions");
    }

    // 聊天室：不得有挂载点，且必须声明退出开关
    $lobby = hub_read('Public/lobby/index.html');
    assert_not_contains('id="hub-nav"', $lobby, '聊天室仍残留「玩法」按钮挂载点');
    assert_contains('data-hub-nav="off"', $lobby, '聊天室未声明 data-hub-nav="off"');
}

/** /turing 的居中组布局：[返回] [居中组: logo + header-actions] [右侧占位] */
function test_turing_header_centered_layout(): void
{
    $html = hub_read('Public/turing/index.html');

    assert_contains('class="hub-nav-center"', $html, '/turing 缺居中组');
    assert_eq(1, substr_count($html, 'hub-nav-spacer'), '返回按钮左侧不应有占位（只保留右侧 1 个）');

    $hdrStart = strpos($html, '<header');
    $hdrEnd = strpos($html, '</header>');
    $header = substr($html, $hdrStart, $hdrEnd - $hdrStart);

    $cen = strpos($header, 'hub-nav-center');
    $logo = strpos($header, 'logo-text');
    $nav = strpos($header, 'id="hub-nav"');
    $back = strpos($header, 'id="btn-back"');
    $spacer = strpos($header, 'hub-nav-spacer');

    assert_true($cen !== false && $logo > $cen && $nav > $cen, 'logo 与 hub-nav 未包在居中组内');
    assert_true($back !== false && $back < $cen, '返回按钮未排在居中组之前（应最左）');
    assert_true($spacer !== false && $spacer > $cen, '占位应在居中组之后');

    // hub-nav.js 必须跳过居中组内的按钮搬移，否则会把按钮移出居中组
    assert_contains(".closest('.hub-nav-center')", hub_read('Public/hub-nav.js'), 'hub-nav.js 未跳过居中组内的搬移');
}

function test_hub_nav_covers_all_games(): void
{
    $js = hub_read('Public/hub-nav.js');

    // HUB_GAMES 必须覆盖全部 5 个玩法入口
    foreach (['/turing', '/soup', '/gomoku', '/lobby', '/temp-chat'] as $href) {
        assert_contains("href: '{$href}'", $js, "HUB_GAMES 缺少入口: {$href}");
    }

    // 当前页高亮 / 移动端弹窗 / 首页自身不注入
    assert_contains('is-active', $js, '缺少当前页高亮');
    assert_contains('hub-nav-burger', $js, '缺少「玩法」按钮');

    // 弹窗必须复用通用 .hub-modal 组件与站点既有动画，不得自造一套
    assert_contains("className = 'hub-modal'", $js, '玩法弹窗未复用通用弹窗组件');
    $bot = hub_read('Public/lobby/lobby-bot.js');
    assert_contains("className = 'hub-modal'", $bot, 'BOT 弹窗未复用通用弹窗组件');

    $css = hub_read('Public/hub.css');
    assert_contains('animation: popIn', $css, '弹窗未复用站点 popIn 入场动画');
    assert_contains('animation: fadeScaleOut', $css, '弹窗未复用站点 fadeScaleOut 退场动画');
    assert_true(!preg_match('/hubPopIn|hubFadeIn|hubPopOut|hubFadeOut/', $css), 'hub.css 仍存在自造 keyframes');
    assert_contains('border-radius: 20px 6px 20px 6px / 6px 20px 6px 20px', $css, '弹窗圆角未对齐站点配方');
    assert_contains('box-shadow: 6px 8px 0 var(--shadow-md)', $css, '弹窗阴影未对齐站点配方');
    assert_contains('background: var(--note-pink)', $css, '弹窗底色未对齐站点配方');
}

// ============================================================
//  4. 资源契约（版本号注入）
// ============================================================

function test_every_version_placeholder_is_injected(): void
{
    $ctrl = hub_read('App/Controllers/GameController.php');

    // 收集控制器所有 $files 注入列表
    preg_match_all('/\$files = \[([^\]]*)\];/', $ctrl, $m);
    $injected = [];
    foreach ($m[1] as $list) {
        preg_match_all("/'([^']+)'/", $list, $mm);
        $injected = array_merge($injected, $mm[1]);
    }
    $injected = array_unique($injected);

    $pages = hub_all_pages();

    foreach ($pages as $abs) {
        $html = (string)file_get_contents($abs);
        preg_match_all('#(?:href|src)="(/[^"?]+)\?v="#', $html, $ph);
        $pageName = str_replace(HUB_ROOT . '/Public/', '', $abs);
        foreach (array_unique($ph[1]) as $res) {
            assert_true(
                in_array($res, $injected, true),
                $pageName . ' 的资源 ' . $res . ' 未纳入注入列表（版本号会留空）'
            );
        }
    }
}

// ============================================================
//  5. 品牌契约
// ============================================================

function test_brand_is_xqfgamehub(): void
{
    $scanned = [];
    foreach (['Public', 'App', 'Config'] as $dir) {
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(HUB_ROOT . '/' . $dir));
        foreach ($it as $f) {
            if ($f->isFile() && preg_match('/\.(php|js|html|css)$/', $f->getFilename())) {
                $scanned[] = $f->getPathname();
            }
        }
    }
    assert_true($scanned !== [], '未扫描到任何文件');

    $old = ['更好的图灵测试', '图灵测试小游戏', 'TuringTalk_'];
    $hits = [];
    foreach ($scanned as $file) {
        $src = (string)file_get_contents($file);
        foreach ($old as $needle) {
            if (str_contains($src, $needle)) {
                $hits[] = str_replace(HUB_ROOT . '/', '', $file) . " → {$needle}";
            }
        }
    }
    assert_true($hits === [], '仍有旧品牌文案残留: ' . implode(' | ', array_slice($hits, 0, 5)));

    // 分享战绩卡片页脚已是新品牌
    assert_contains("'footer'  => 'XQFGameHub'", hub_read('App/Core/WebSocket/Game/ActionHandler.php'), '战绩卡片页脚未更新');
    assert_contains("'footer' => 'XQFGameHub'", hub_read('App/Core/WebSocket/Lobby/ChatHandler.php'), '聊天室战绩卡片页脚未更新');

    // 首页标题
    assert_contains('<title>XQFGameHub 游戏中心</title>', hub_read('Public/index.html'), '首页标题未更新');
}

// ============================================================
//  6. 兼容契约（不得改名）
// ============================================================

function test_data_and_protocol_names_unchanged(): void
{
    // MySQL 库名
    $db = hub_read('App/Services/Infrastructure/Database.php');
    assert_contains("'turing_game'", $db, 'MySQL 库名被改动，会导致数据丢失风险');

    // WS 路由与 type 前缀
    $routes = [
        'App/Core/WebSocket/WebSocketHandler.php' => [],
        'App/Core/WebSocket/GameWebSocketHandler.php' => ["'/ws'"],
        'App/Core/WebSocket/GomokuWebSocketHandler.php' => ["'/ws/gomoku'", "'gomoku_'"],
        'App/Core/WebSocket/LobbyChatWebSocketHandler.php' => ["'/ws/lobby'", "'lobby_'"],
        'App/Core/WebSocket/TempChatWebSocketHandler.php' => ["'/ws/tempchat'", "'temp_'"],
        'App/Core/WebSocket/Soup/SoupWebSocketHandler.php' => ["'/ws/soup'", "'soup_'"],
        'App/Core/WebSocket/Fate/FateWebSocketHandler.php' => ["'/ws/fate'"],
    ];
    foreach ($routes as $file => $keys) {
        $src = hub_read($file);
        foreach ($keys as $k) {
            assert_contains($k, $src, "{$file} 的协议标识被改动: {$k}");
        }
    }

    // localStorage 键（改名会让老用户身份丢失）
    $shared = hub_read('Public/shared.js');
    assert_contains('userdata', $shared, 'localStorage 用户数据键被改动风险');
}

function test_no_leftover_whoisai(): void
{
    // WhoisAI 模式已整体移除，不得有残留
    $targets = [
        'App/Core/WebSocket/WhoisAIWebSocketHandler.php',
        'App/Services/Game/WhoisAIService.php',
    ];
    foreach ($targets as $t) {
        assert_true(!is_file(HUB_ROOT . '/' . $t), "WhoisAI 文件仍存在: {$t}");
    }

    // 配置段也不应残留
    foreach (['Config/App.php', 'Config/App.example.php'] as $cfg) {
        assert_not_contains("'WhoisAI' =>", hub_read($cfg), "{$cfg} 仍残留 WhoisAI 配置段");
    }
}
