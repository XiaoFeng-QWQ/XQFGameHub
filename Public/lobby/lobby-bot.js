/**
 * XQFGameHub —— 聊天室内「聊天室 BOT」弹窗
 * ---------------------------------------------------------------
 * 取代原独立页 /bot-panel：入口收敛到 /lobby 的「更多」菜单，
 * 打开时向 /api/account/bot-access 查询权限，动态决定展示：
 *   approved → BOT 面板（KEY 复制/轮换、改名、状态）
 *   none     → 申请表单（邮箱 + 理由，POST /api/bot/apply）
 *   applied  → 等待审核提示
 *   disabled → 已被禁用提示
 *
 * 样式全部取 style.css 变量，暗色主题自动适配。
 */
(function () {
    'use strict';

    var API_ACCESS = '/api/account/bot-access';
    var API_PANEL = '/api/bot/panel';
    var API_APPLY = '/api/bot/apply';
    var API_NICK = '/api/bot/panel/nickname';
    var API_KEY = '/api/bot/panel/key';

    var overlay = null;
    var state = null; // 最近一次 bot-access 结果

    function $(id) { return document.getElementById(id); }

    function authHeaders(extra) {
        var h = { 'Authorization': 'Bearer ' + getUserToken() };
        if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
        return h;
    }

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    // ============================================================
    //  弹层骨架
    // ============================================================

    function ensureOverlay() {
        if (overlay) return;

        // 复用 hub.css 的通用弹窗（遮罩 + 手绘卡片 + 进出场动画），与站点其它弹窗风格一致
        overlay = document.createElement('div');
        overlay.id = 'lobby-bot-overlay';
        overlay.className = 'hub-modal';
        overlay.innerHTML =
            '<div class="hub-modal-card" role="dialog" aria-label="聊天室 BOT">' +
            '<div class="hub-modal-head">' +
            '<span class="hub-modal-title">' +
            '<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>' +
            '<line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>' +
            '<line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/></svg>' +
            '聊天室 BOT</span>' +
            '<button type="button" class="doodle-btn" id="lbot-close" style="padding:4px 8px;border:none;" aria-label="关闭">' +
            '<svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button></div>' +
            '<div id="lbot-body"></div>' +
            '</div>';
        document.body.appendChild(overlay);

        overlay.querySelector('#lbot-close').addEventListener('click', close);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) close();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') close();
        });
    }

    var closingTimer = null;

    function open() {
        ensureOverlay();
        if (closingTimer) { clearTimeout(closingTimer); closingTimer = null; }
        overlay.classList.remove('closing');
        overlay.classList.add('is-open');
        renderLoading();
        refresh();
    }

    function close() {
        if (!overlay || !overlay.classList.contains('is-open')) return;
        overlay.classList.add('closing');
        // 等退出动画播完再隐藏
        closingTimer = setTimeout(function () {
            overlay.classList.remove('is-open', 'closing');
            closingTimer = null;
        }, 100);
    }

    function renderLoading() {
        $('lbot-body').innerHTML =
            '<div style="text-align:center;padding:24px 0;color:var(--text-subtle);font-size:13px;">正在读取 BOT 权限…</div>';
    }

    // ============================================================
    //  权限查询 → 动态渲染
    // ============================================================

    function refresh() {
        if (!getUserToken()) {
            renderMessage('请先登录', '登录后即可查看或申请聊天室 BOT。', '前往账号中心', function () {
                window.location.href = '/account';
            });
            return;
        }
        fetch(API_ACCESS, { headers: authHeaders() })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                state = data || {};
                if (data.state === 'approved') { renderPanel(); return; }
                if (data.state === 'applied') {
                    renderMessage('申请已提交', data.message || '请等待管理员审核', '刷新状态', refresh);
                    return;
                }
                if (data.state === 'disabled') {
                    renderMessage('BOT 已被禁用', data.message || '请联系管理员', '刷新状态', refresh);
                    return;
                }
                renderApplyForm();
            })
            .catch(function () {
                renderMessage('读取失败', '网络错误，请稍后重试', '重试', refresh);
            });
    }

    function renderMessage(title, desc, btnText, onClick) {
        var html =
            '<div style="text-align:center;padding:6px 0 4px;">' +
            '<div style="font-size:16px;font-weight:bold;margin-bottom:8px;">' + esc(title) + '</div>' +
            '<div style="font-size:13px;color:var(--text-muted);line-height:1.6;margin-bottom:16px;">' + esc(desc) + '</div>' +
            '<button class="doodle-btn" id="lbot-action" style="justify-content:center;font-size:13px;">' + esc(btnText) + '</button>' +
            '</div>';
        $('lbot-body').innerHTML = html;
        $('lbot-action').addEventListener('click', onClick);
    }

    // ---------- 申请表单 ----------

    function renderApplyForm() {
        $('lbot-body').innerHTML =
            '<div style="font-size:13px;color:var(--text-muted);line-height:1.7;margin-bottom:14px;">' +
            '聊天室 BOT 可在公共聊天室里自动发言与互动。提交申请后由管理员审核，通过后此处会显示 BOT 面板与专属 KEY。' +
            '</div>' +
            '<div class="input-line" style="margin-bottom:12px;">' +
            '<label style="font-size:13px;font-weight:bold;">联系邮箱</label>' +
            '<input id="lbot-email" type="email" placeholder="用于接收审核结果" style="width:100%;box-sizing:border-box;padding:8px 10px;border:2px solid var(--ink-black);border-radius:6px;font-family:inherit;font-size:14px;background:var(--bg-input);color:var(--ink-black);">' +
            '</div>' +
            '<div class="input-line" style="margin-bottom:12px;">' +
            '<label style="font-size:13px;font-weight:bold;">申请理由（至少 10 个字）</label>' +
            '<textarea id="lbot-reason" rows="4" maxlength="500" placeholder="说说你想用 BOT 做什么，例如自动回复、定时公告…" style="width:100%;box-sizing:border-box;padding:8px 10px;border:2px solid var(--ink-black);border-radius:6px;font-family:inherit;font-size:14px;background:var(--bg-input);color:var(--ink-black);font-family:inherit;resize:vertical;"></textarea>' +
            '</div>' +
            '<div id="lbot-msg" style="display:none;font-size:12px;color:var(--danger);margin-bottom:10px;"></div>' +
            '<button class="doodle-btn" id="lbot-submit" style="width:100%;justify-content:center;font-size:14px;padding:9px 0;">提交申请</button>';

        $('lbot-submit').addEventListener('click', submitApply);
    }

    function submitApply() {
        var email = ($('lbot-email').value || '').trim();
        var reason = ($('lbot-reason').value || '').trim();
        var msg = $('lbot-msg');

        function fail(text) {
            msg.textContent = text;
            msg.style.display = '';
        }

        if (!email || email.indexOf('@') < 0) { fail('请填写有效的邮箱'); return; }
        if (reason.length < 10) { fail('申请理由至少 10 个字'); return; }

        msg.style.display = 'none';
        var btn = $('lbot-submit');
        btn.disabled = true;
        btn.textContent = '提交中…';

        fetch(API_APPLY, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ email: email, reason: reason })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                btn.disabled = false;
                btn.textContent = '提交申请';
                if (data && data.error) { fail(data.error); return; }
                showTopToast('申请已提交，请等待管理员审核', false);
                refresh(); // 状态动态更新为 applied
            })
            .catch(function () {
                btn.disabled = false;
                btn.textContent = '提交申请';
                fail('网络错误，请稍后重试');
            });
    }

    // ---------- 已通过：BOT 面板 ----------

    function renderPanel() {
        var d = state || {};
        $('lbot-body').innerHTML =
            '<div style="display:flex;flex-wrap:wrap;gap:10px;font-size:12px;color:var(--text-muted);margin-bottom:14px;">' +
            '<span>账号：<b style="color:var(--ink-black);">' + esc(d.nickname || '-') + '</b></span>' +
            '<span>状态：<b style="color:var(--success);">' + esc(d.status_text || '启用') + '</b></span>' +
            '<span>创建：' + esc(d.created_at || '-') + '</span>' +
            '</div>' +

            '<div style="font-size:12px;color:var(--text-subtle);margin-bottom:6px;">BOT KEY（用于 BOT 网关鉴权，请勿泄露）</div>' +
            '<div style="display:flex;gap:8px;margin-bottom:14px;">' +
            '<code id="lbot-key" style="flex:1;min-width:0;overflow:auto;white-space:nowrap;padding:8px 10px;border:2px dashed var(--border-light);border-radius:6px;font-size:12px;">' + esc(d.bot_key || '-') + '</code>' +
            '<button class="doodle-btn" id="lbot-copy" style="font-size:12px;padding:6px 10px;white-space:nowrap;flex-shrink:0;">复制</button>' +
            '<button class="doodle-btn danger" id="lbot-rotate" style="font-size:12px;padding:6px 10px;white-space:nowrap;flex-shrink:0;">重置</button>' +
            '</div>' +

            '<div style="font-size:12px;color:var(--text-subtle);margin-bottom:6px;">BOT 昵称（可随时修改）</div>' +
            '<div style="display:flex;gap:8px;margin-bottom:6px;">' +
            '<input id="lbot-nick" type="text" maxlength="12" value="' + esc(d.nickname || '') + '" style="flex:1;min-width:0;padding:8px 10px;border:2px solid var(--ink-black);border-radius:6px;font-family:inherit;font-size:14px;background:var(--bg-input);color:var(--ink-black);">' +
            '<button class="doodle-btn" id="lbot-save-nick" style="font-size:12px;padding:6px 12px;white-space:nowrap;flex-shrink:0;">保存</button>' +
            '</div>' +
            '<div id="lbot-msg" style="display:none;font-size:12px;color:var(--danger);margin-top:6px;"></div>' +
            '<div style="font-size:11px;color:var(--text-aa);margin-top:10px;line-height:1.6;">' +
            '接入方式与消息格式见 BOT 网关文档；KEY 重置后旧的 KEY 立即失效。' +
            '</div>';

        $('lbot-copy').addEventListener('click', function () {
            var key = (d.bot_key || '').trim();
            if (!key || key === '-') { showTopToast('暂无 KEY', true); return; }
            copyText(key).then(function (ok) {
                showTopToast(ok ? 'KEY 已复制' : '复制失败，请手动复制', !ok);
            });
        });

        $('lbot-rotate').addEventListener('click', function () {
            if (!confirm('重置后旧 KEY 立即失效，使用旧 KEY 的 BOT 会掉线。确定重置？')) return;
            var btn = $('lbot-rotate');
            btn.disabled = true;
            fetch(API_KEY, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: '{}' })
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    btn.disabled = false;
                    if (res && res.success && res.bot_key) {
                        state.bot_key = res.bot_key;
                        $('lbot-key').textContent = res.bot_key;
                        showTopToast('KEY 已重置', false);
                    } else {
                        showTopToast((res && res.error) || '重置失败', true);
                    }
                })
                .catch(function () {
                    btn.disabled = false;
                    showTopToast('网络错误，请重试', true);
                });
        });

        $('lbot-save-nick').addEventListener('click', function () {
            var nick = ($('lbot-nick').value || '').trim();
            var msg = $('lbot-msg');
            if (!nick) { msg.textContent = '昵称不能为空'; msg.style.display = ''; return; }
            var btn = $('lbot-save-nick');
            btn.disabled = true;
            fetch(API_NICK, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ nickname: nick })
            })
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    btn.disabled = false;
                    if (res && res.error) { msg.textContent = res.error; msg.style.display = ''; return; }
                    state.nickname = res.nickname || nick;
                    msg.style.display = 'none';
                    showTopToast('BOT 昵称已更新', false);
                })
                .catch(function () {
                    btn.disabled = false;
                    msg.textContent = '网络错误，请重试';
                    msg.style.display = '';
                });
        });
    }

    /** 复制到剪贴板（含非安全上下文降级） */
    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text).then(function () { return true; })
                .catch(function () { return false; });
        }
        return new Promise(function (resolve) {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;top:-9999px;';
            document.body.appendChild(ta);
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            document.body.removeChild(ta);
            resolve(ok);
        });
    }

    // ============================================================
    //  入口按钮：按权限动态显示
    // ============================================================

    function initEntry() {
        var btn = $('lobby-btn-bot');
        if (!btn) return;
        btn.addEventListener('click', open);

        // 入口始终可见：权限判断放到弹窗内动态完成
        // （有 BOT → 面板；无 BOT → 申请表单；已申请 → 等待审核）
        btn.style.display = '';
    }

    window.LobbyBot = { open: open, close: close, initEntry: initEntry };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEntry);
    } else {
        initEntry();
    }
})();
