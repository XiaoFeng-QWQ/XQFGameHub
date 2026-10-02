/**
 * XQFGameHub —— 游戏中心首页逻辑
 * ---------------------------------------------------------------
 * 职责：
 *   1. 在线人数：沿用主站 /ws 连接（与旧首页完全一致的「只连不发 join」行为）
 *   2. 状态条：本周对局数（只读接口，失败静默降级）
 *   3. 分类筛选：纯前端显示过滤
 *
 * 不做：不引入 script.js（避免带上匹配状态机、对局计时器与大量 UI 绑定）。
 * 账号相关能力已独立为 /account 页（见 Public/account/account.js）。
 */
(function () {
    'use strict';

    var WS_PATH = '/ws';
    var HEARTBEAT_MS = 25000;   // 与主站一致：25s 一次 ping
    var PONG_TIMEOUT_MS = 60000; // 与主站一致：60s 未收 pong 判定断线
    var RECONNECT_MS = 2000;

    // ============================================================
    //  一、在线人数（/ws）
    // ============================================================

    var ws = null;
    var heartbeatTimer = null;
    var reconnectTimer = null;
    var lastPongAt = 0;
    var manuallyClosed = false;

    function setOnlineText(text) {
        var el = document.getElementById('hub-online-num');
        if (el && el.textContent !== String(text)) el.textContent = text;
        var wrap = document.getElementById('hub-online-stat');
        if (wrap) wrap.classList.toggle('is-offline', text === '--');
    }

    function stopHeartbeat() {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    }

    function startHeartbeat() {
        stopHeartbeat();
        lastPongAt = Date.now();
        heartbeatTimer = setInterval(function () {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify({ type: 'ping' }));
            if (lastPongAt && Date.now() - lastPongAt > PONG_TIMEOUT_MS) {
                // 长时间无 pong：主动断开走重连
                try { ws.close(); } catch (e) { }
            }
        }, HEARTBEAT_MS);
    }

    function scheduleReconnect() {
        if (manuallyClosed || reconnectTimer) return;
        reconnectTimer = setTimeout(function () {
            reconnectTimer = null;
            connectOnline();
        }, RECONNECT_MS);
    }

    function connectOnline() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

        var protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        try {
            ws = new WebSocket(protocol + window.location.host + WS_PATH);
        } catch (e) {
            setOnlineText('--');
            scheduleReconnect();
            return;
        }

        ws.onopen = function () {
            // 与旧首页一致：onopen 不发 join，仅启心跳；
            // 服务端在 onOpen 阶段已单发一次 online_count，无需任何请求。
            startHeartbeat();
        };

        ws.onmessage = function (evt) {
            var data;
            try { data = JSON.parse(evt.data); } catch (e) { return; }
            if (!data || !data.type) return;

            if (data.type === 'pong') {
                lastPongAt = Date.now();
                return;
            }
            if (data.type === 'online_count') {
                setOnlineText(parseInt(data.count, 10) || 0);
                return;
            }
            // 全服公告：首页也能看到（沿用主站能力）
            if (data.type === 'broadcast' && typeof showDanmaku === 'function') {
                showDanmaku(data.text, '全服公告', data.duration || 0);
            }
        };

        ws.onclose = function () {
            stopHeartbeat();
            ws = null;
            // 不把数字清零：保留最后一次数值，仅标记为离线视觉
            scheduleReconnect();
        };

        ws.onerror = function () {
            // onclose 会紧随其后，这里不重复处理
        };
    }

    // 离开首页时主动断开，避免占用连接
    window.addEventListener('beforeunload', function () {
        manuallyClosed = true;
        stopHeartbeat();
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (ws) { try { ws.close(); } catch (e) { } }
    });

    // ============================================================
    //  二、状态条（本周对局，失败静默降级）
    // ============================================================

    function loadWeeklyStat() {
        var el = document.getElementById('hub-week-games');
        if (!el) return Promise.resolve();
        return fetch('/api/weekly-report?limit=1')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.overview && typeof data.overview.total_games !== 'undefined') {
                    el.textContent = data.overview.total_games;
                }
            })
            .catch(function () { /* 静默降级：保留占位符 */ });
    }

    // ============================================================
    //  三、分类筛选
    // ============================================================

    function initFilters() {
        var filters = document.querySelectorAll('.hub-filter');
        if (!filters.length) return;
        var cards = document.querySelectorAll('.hub-card');

        filters.forEach(function (btn) {
            btn.addEventListener('click', function () {
                filters.forEach(function (b) { b.classList.remove('is-active'); });
                btn.classList.add('is-active');

                var group = btn.getAttribute('data-group') || 'all';
                cards.forEach(function (card) {
                    var match = (group === 'all') || (card.getAttribute('data-group') === group);
                    if (match) card.removeAttribute('hidden');
                    else card.setAttribute('hidden', '');
                });
            });
        });
    }

    // ============================================================
    //  启动
    // ============================================================

    function init() {
        initFilters();
        loadWeeklyStat();
        connectOnline();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
