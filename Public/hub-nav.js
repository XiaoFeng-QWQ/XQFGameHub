/**
 * XQFGameHub —— 全局玩法导航
 * ---------------------------------------------------------------
 * 用法：各玩法页 header 内放 <div id="hub-nav"></div>，本脚本自动注入内容。
 *
 * 设计要点：
 * 1. HUB_GAMES 是全站玩法入口的「单一数据源」，新增玩法只改这里一处。
 * 2. 只做「进入 / 切换」，不下探任何玩法的内部状态，与各页逻辑零耦合。
 * 3. 各页 header 里原有的操作按钮（点歌/通知/设置等）全部保留，本脚本不碰。
 * 4. 桌面端渲染横向 chips；窄屏折叠为「玩法」按钮 + 底部抽屉。
 */
(function () {
    'use strict';

    /** 玩法入口配置（顺序 = 导航展示顺序） */
    var HUB_GAMES = [
        {
            key: 'turing',
            label: '图灵测试',
            href: '/turing',
            color: 'note-yellow',
            badge: '主推',
            icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>'
        },
        {
            key: 'soup',
            label: '海龟汤',
            href: '/soup',
            color: 'note-blue',
            badge: '',
            icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 12h18a9 9 0 0 1-9 9 9 9 0 0 1-9-9z"/><path d="M8 8c0-1.5 1-2 1-3.5"/><path d="M12 8c0-1.5 1-2 1-3.5"/><path d="M16 8c0-1.5 1-2 1-3.5"/></svg>'
        },
        {
            key: 'gomoku',
            label: '五子棋',
            href: '/gomoku',
            color: 'note-green',
            badge: '',
            icon: '<svg class="icon" viewBox="0 0 24 24"><circle cx="7" cy="7" r="5" fill="currentColor"/><circle cx="17" cy="7" r="5"/><circle cx="12" cy="17" r="5"/><line x1="2" y1="22" x2="9" y2="15"/></svg>'
        },
        {
            key: 'lobby',
            label: '公共聊天室',
            href: '/lobby',
            color: 'note-yellow',
            badge: 'HOT',
            icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
        },
        {
            key: 'tempchat',
            label: '临时聊天',
            href: '/temp-chat',
            color: 'note-pink',
            badge: '',
            icon: '<svg class="icon" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>'
        }
    ];

    /** 哪些路径也算作某个玩法处于「当前」（路径前缀匹配） */
    var ACTIVE_ALIASES = {
        turing: ['/player/', '/collection/']
    };

    /** 判断当前处于哪个玩法 */
    function detectActiveKey(pathname) {
        for (var i = 0; i < HUB_GAMES.length; i++) {
            var g = HUB_GAMES[i];
            if (pathname === g.href || pathname.indexOf(g.href + '/') === 0) return g.key;
        }
        var aliasKeys = Object.keys(ACTIVE_ALIASES);
        for (var j = 0; j < aliasKeys.length; j++) {
            var key = aliasKeys[j];
            var prefixes = ACTIVE_ALIASES[key];
            for (var k = 0; k < prefixes.length; k++) {
                if (pathname.indexOf(prefixes[k]) === 0) return key;
            }
        }
        return '';
    }

    /** 账号中心入口（所有页面共用同一份标记，首页与子页面渲染一致） */
    function accountChip(extraStyle) {
        var active = window.location.pathname.indexOf('/account') === 0;
        return '<a class="hub-nav-account' + (active ? ' is-active' : '') + '" href="/account"' +
            (active ? ' aria-current="page"' : '') +
            (extraStyle ? ' style="' + extraStyle + '"' : '') + ' title="我的账号">' +
            '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/>' +
            '<path d="M5 20v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/></svg>' +
            '<span>我的账号</span></a>';
    }

    function buildChips(activeKey, forModal) {
        var html = '';
        HUB_GAMES.forEach(function (g) {
            var active = g.key === activeKey;
            var cls = forModal
                ? ('hub-nav-modal-item' + (active ? ' is-active' : ''))
                : ('hub-nav-chip' + (active ? ' is-active' : ''));
            var badge = (!forModal && g.badge)
                ? '<span class="hub-nav-chip-badge">' + g.badge + '</span>'
                : '';
            html += '<a class="' + cls + '" href="' + g.href + '"' +
                (active ? ' aria-current="page"' : '') + '>' +
                g.icon +
                '<span class="hub-nav-modal-label">' + g.label + '</span>' +
                badge +
                '</a>';
        });
        return html;
    }

    function injectNav(container) {
        if (container.getAttribute('data-hub-nav-ready') === '1') return;

        // 页面可用 data-hub-nav="off" 声明不需要「玩法」按钮（如聊天室），
        // 此时连弹窗都不创建，避免留下 空容器 + 无用弹层
        var actions = document.querySelector('header .header-actions');
        var optedOut = actions && actions.getAttribute('data-hub-nav') === 'off';

        container.setAttribute('data-hub-nav-ready', '1');

        if (optedOut) {
            container.parentNode && container.parentNode.removeChild(container);
            return;
        }

        var activeKey = detectActiveKey(window.location.pathname);

        // 该容器只承载「玩法」按钮，按钮被插到 header-actions 里（与主题/设置等按钮同排）
        container.className = 'hub-nav';
        container.innerHTML =
            '<button type="button" class="hub-nav-burger" aria-label="切换玩法" aria-expanded="false">' +
            '<svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px;">' +
            '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>' +
            '</svg>玩法</button>';

        // 放进 header-actions 的第一位（找不到则退回原位置）
        // 若页面已用 .hub-nav-center 把 logo 与按钮包成居中组，则保持原位不动
        if (!container.closest('.hub-nav-center') && actions && actions !== container) {
            actions.insertBefore(container, actions.firstChild);
        }

        // 玩法切换弹窗（点「玩法」打开；基于通用 .hub-modal，带进出场动画）
        var modal = document.createElement('div');
        modal.className = 'hub-modal';
        modal.innerHTML =
            '<div class="hub-modal-card" role="dialog" aria-label="切换玩法">' +
            '<div class="hub-modal-head">' +
            '<span class="hub-modal-title">切换玩法</span>' +
            '<button type="button" class="doodle-btn hub-nav-modal-close" style="padding:4px 8px;border:none;" aria-label="关闭">' +
            '<svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
            '</div>' +
            '<div class="hub-nav-modal-grid">' + buildChips(activeKey, true) + '</div>' +
            accountChip('display:flex;justify-content:center;margin-top:12px;') +
            '<a class="hub-service hub-nav-modal-home" href="/" style="margin-top:8px;">' +
            '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' +
            '<span>游戏中心首页</span></a>' +
            '</div>';
        document.body.appendChild(modal);

        var burger = container.querySelector('.hub-nav-burger');
        var closeBtn = modal.querySelector('.hub-nav-modal-close');
        var closingTimer = null;

        function openModal() {
            if (closingTimer) { clearTimeout(closingTimer); closingTimer = null; }
            modal.classList.remove('closing');
            modal.classList.add('is-open');
            burger.setAttribute('aria-expanded', 'true');
        }

        function closeModal() {
            if (!modal.classList.contains('is-open')) return;
            modal.classList.add('closing');
            burger.setAttribute('aria-expanded', 'false');
            // 等退出动画播完再真正隐藏（对应 fadeScaleOut 0.1s）
            closingTimer = setTimeout(function () {
                modal.classList.remove('is-open', 'closing');
                closingTimer = null;
            }, 100);
        }

        burger.addEventListener('click', function (e) {
            e.stopPropagation();
            if (modal.classList.contains('is-open')) closeModal();
            else openModal();
        });

        closeBtn.addEventListener('click', closeModal);

        // 点遮罩空白处或点到链接则关闭
        modal.addEventListener('click', function (e) {
            if (e.target === modal || e.target.closest('a')) closeModal();
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeModal();
        });
    }

    function init() {
        var container = document.getElementById('hub-nav');
        if (!container) return;
        injectNav(container);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 暴露给首页复用（游戏中心首页用同一份数据渲染卡片）
    window.XQFGameHub = {
        games: HUB_GAMES,
        detectActiveKey: detectActiveKey
    };
})();
