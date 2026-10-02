/**
 * XQFGameHub —— 账号中心
 * ---------------------------------------------------------------
 * 数据来源：GET /api/account/overview（player_token 鉴权，只读）
 * 改名：POST /api/account/nickname（后端校验每月一次）
 * 绑定：复用 shared.js 的 OAuth 能力 + /api/oauth/* 接口
 */
(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }

    /**
     * 回调地址：各页跳转过来时用 ?redirect=<原页面> 告知「认证完回哪里」。
     * 只接受站内相对路径（以 / 开头且非 //），否则退回 /account。
     */
    var REDIRECT = (function () {
        var r = '';
        try {
            r = new URLSearchParams(window.location.search).get('redirect') || '';
        } catch (e) { r = ''; }
        if (r.charAt(0) !== '/' || r.charAt(1) === '/') r = '/account';
        return r;
    })();

    /** 认证完成后跳回来源页 */
    function goBackToSource() {
        window.location.href = REDIRECT;
    }

    function authHeaders(extra) {
        var h = { 'Authorization': 'Bearer ' + getUserToken() };
        if (extra) {
            Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
        }
        return h;
    }

    function showGuest() {
        $('account-loading').style.display = 'none';
        $('account-main').style.display = 'none';
        $('account-guest').style.display = '';
        initOAuthQuickButtons();
    }

    function showMain() {
        $('account-loading').style.display = 'none';
        $('account-guest').style.display = 'none';
        $('account-main').style.display = '';
    }

    /** 折叠区：按钮切换 body 显示，并维护 aria-expanded */
    function bindFold(toggleId, bodyId) {
        var toggle = $(toggleId);
        var body = $(bodyId);
        if (!toggle || !body) return;
        toggle.addEventListener('click', function () {
            var open = body.style.display !== 'none';
            body.style.display = open ? 'none' : '';
            toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
        });
    }

    // ============================================================
    //  一、加载账号总览
    // ============================================================

    function loadOverview() {
        return fetch('/api/account/overview', { headers: authHeaders() })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.ok) {
                    // token 失效 → 回到未登录视图
                    if (data && String(data.error || '').indexOf('token') >= 0) {
                        setUserToken('');
                        showGuest();
                        showTopToast('登录状态已失效，请重新登录', true);
                        return;
                    }
                    showGuest();
                    return;
                }
                renderOverview(data);
                showMain();
                loadAccountTags();
                loadChatHistoryList(1);
                loadMessageManageList();
            })
            .catch(function () {
                showGuest();
                showTopToast('账号信息读取失败，请稍后重试', true);
            });
    }

    function renderOverview(d) {
        // 头像：有则用图片，否则用昵称首字符 + 便签底色
        var av = $('account-avatar');
        av.textContent = '';
        av.style.backgroundImage = 'none';
        if (d.avatar) {
            av.style.backgroundImage = 'url("' + d.avatar + '")';
        } else {
            av.textContent = (d.nickname || '?').charAt(0).toUpperCase();
        }

        $('account-nickname').textContent = d.nickname || '—';
        $('account-disc').textContent = d.discriminator ? ('#' + d.discriminator) : '';
        $('account-pid').textContent = d.player_id || '—';
        $('account-created').textContent = d.created_at || '—';
        $('account-last-played').textContent = d.last_played_at || '—';

        // 佩戴标签（普通 + 官方特殊一起展示在身份卡）
        renderAccountWorn(d.worn_tags, d.worn_special_tags);

        // 战绩
        var st = d.stats || {};
        $('stat-games').textContent = st.total_games || 0;
        $('stat-winrate').textContent = (st.win_rate || 0) + '%';
        $('stat-avgmsgs').textContent = st.avg_msgs || 0;

        // 公开资料页入口（/player/{昵称}，未取到昵称时隐藏）
        var profileLink = $('link-public-profile');
        if (profileLink) {
            if (d.nickname) {
                profileLink.href = '/player/' + encodeURIComponent(d.nickname);
                profileLink.style.display = '';
            } else {
                profileLink.style.display = 'none';
            }
        }

        // 改名冷却提示
        $('rename-hint').textContent = d.rename_hint || '';
        $('btn-rename').disabled = !d.can_rename;

        // 本地昵称与服务端对齐（防止本地缓存过期）
        if (d.nickname) setUserNickname(d.nickname);

        renderBindings(d.bindings || []);
    }

    // ============================================================
    //  二、我的标签（读取标签库 + 保存佩戴）
    // ============================================================

    var accountTagMax = 3;
    var accountWornTags = [];
    var accountWornSpecialTags = [];

    function renderAccountWorn(wornTags, wornSpecialTags) {
        var tags = $('account-tags');
        if (!tags) return;
        tags.innerHTML = '';
        var wornItems = [];
        (wornTags || []).forEach(function (t) { wornItems.push({ tag: t, special: false }); });
        (wornSpecialTags || []).forEach(function (t) { wornItems.push({ tag: t, special: true }); });
        wornItems.forEach(function (item) {
            var s = document.createElement('span');
            s.className = 'acc-tag' + (item.special ? ' is-special' : '');
            s.textContent = item.tag;
            tags.appendChild(s);
        });
    }

    function accountTagStatus(message, type) {
        var el = $('account-tags-status');
        if (!el) return;
        el.textContent = message || '';
        el.style.display = message ? '' : 'none';
        el.classList.toggle('is-success', type === 'success');
        el.classList.toggle('is-error', type === 'error');
    }

    function accountMakeTagChip(tag, isSpecial, selected, count, onClick) {
        var chip = document.createElement('span');
        chip.className = 'worn-tag-chip' + (isSpecial ? ' special' : '') + (selected ? ' selected' : '');
        chip.textContent = isSpecial ? tag : tag + ' ×' + (count || 0);
        chip.dataset.tag = tag;
        chip.title = isSpecial
            ? '官方特殊称号，可自选佩戴（最多 ' + accountTagMax + ' 个，不占普通名额）'
            : (selected ? '点击取消佩戴' : '点击佩戴');
        chip.addEventListener('click', onClick);
        return chip;
    }

    function accountToggleTag(tag, isSpecial, chip) {
        var arr = isSpecial ? accountWornSpecialTags : accountWornTags;
        var idx = arr.indexOf(tag);
        if (idx >= 0) {
            arr.splice(idx, 1);
            chip.classList.remove('selected');
            accountTagStatus('');
            return;
        }
        if (arr.length >= accountTagMax) {
            accountTagStatus('最多佩戴 ' + accountTagMax + ' 个标签', 'error');
            setTimeout(function () { accountTagStatus(''); }, 2000);
            return;
        }
        arr.push(tag);
        chip.classList.add('selected');
        accountTagStatus('');
    }

    function accountRenderTags(data) {
        accountTagMax = data.max || 3;
        accountWornTags = Array.isArray(data.worn) ? data.worn.slice() : [];
        accountWornSpecialTags = Array.isArray(data.worn_special) ? data.worn_special.slice() : [];

        var cap = $('account-tags-cap');
        if (cap) cap.textContent = '最多佩戴 ' + accountTagMax + ' 个';

        var special = Array.isArray(data.special) ? data.special : [];
        var normal = (data.tags || []).filter(function (t) { return !t.is_special; });
        var specialBox = $('account-tags-special');
        var normalBox = $('account-tags-normal');
        var emptyEl = $('account-tags-empty');
        var hasAny = special.length || normal.length;

        if (specialBox) {
            specialBox.style.display = special.length ? '' : 'none';
            specialBox.innerHTML = '';
            if (special.length) {
                var specialLabel = document.createElement('span');
                specialLabel.className = 'acc-tag-group-label';
                specialLabel.textContent = '官方称号';
                specialBox.appendChild(specialLabel);
                special.forEach(function (tag) {
                    var chip = accountMakeTagChip(tag, true, accountWornSpecialTags.indexOf(tag) !== -1, 0, function () {
                        accountToggleTag(tag, true, chip);
                    });
                    specialBox.appendChild(chip);
                });
            }
        }

        if (normalBox) {
            normalBox.style.display = normal.length ? '' : 'none';
            normalBox.innerHTML = '';
            if (normal.length) {
                var normalLabel = document.createElement('span');
                normalLabel.className = 'acc-tag-group-label';
                normalLabel.textContent = '普通标签';
                normalBox.appendChild(normalLabel);
                normal.forEach(function (t) {
                    var chip = accountMakeTagChip(t.tag, false, accountWornTags.indexOf(t.tag) !== -1, t.count || 0, function () {
                        accountToggleTag(t.tag, false, chip);
                    });
                    normalBox.appendChild(chip);
                });
            } else if (special.length) {
                normalBox.style.display = '';
                var noNormal = document.createElement('span');
                noNormal.className = 'acc-muted';
                noNormal.textContent = '暂无普通标签';
                normalBox.appendChild(noNormal);
            }
        }

        if (emptyEl) emptyEl.style.display = hasAny ? 'none' : '';
        var saveBtn = $('btn-save-account-tags');
        if (saveBtn) saveBtn.disabled = !hasAny;
        accountTagStatus('');
    }

    function loadAccountTags() {
        if (!getUserToken()) return;
        fetch('/api/player/tags', { headers: authHeaders() })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !Array.isArray(data.tags)) throw new Error('bad response');
                accountRenderTags(data);
            })
            .catch(function () {
                accountTagStatus('标签加载失败，请稍后重试', 'error');
                var saveBtn = $('btn-save-account-tags');
                if (saveBtn) saveBtn.disabled = false;
            });
    }

    function syncAccountTagSelection() {
        ['account-tags-special', 'account-tags-normal'].forEach(function (id) {
            var box = $(id);
            if (!box) return;
            box.querySelectorAll('.worn-tag-chip').forEach(function (chip) {
                var isSpecial = chip.classList.contains('special');
                var list = isSpecial ? accountWornSpecialTags : accountWornTags;
                chip.classList.toggle('selected', list.indexOf(chip.dataset.tag) !== -1);
            });
        });
    }

    function saveAccountTags() {
        var btn = $('btn-save-account-tags');
        if (!btn || !getUserToken()) return;
        btn.disabled = true;
        accountTagStatus('保存中...');
        fetch('/api/player/worn-tags', {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ tags: accountWornTags, special_tags: accountWornSpecialTags })
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (res && res.success) {
                    accountWornTags = Array.isArray(res.worn) ? res.worn.slice() : accountWornTags;
                    accountWornSpecialTags = Array.isArray(res.worn_special) ? res.worn_special.slice() : accountWornSpecialTags;
                    syncAccountTagSelection();
                    renderAccountWorn(accountWornTags, accountWornSpecialTags);
                    accountTagStatus(res.message || '已保存', 'success');
                    btn.disabled = false;
                } else {
                    accountTagStatus((res && res.message) || '保存失败', 'error');
                    btn.disabled = false;
                }
            })
            .catch(function () {
                accountTagStatus('网络错误，请稍后重试', 'error');
                btn.disabled = false;
            });
    }

    // ============================================================
    //  三、第三方绑定
    // ============================================================

    function providerNameOf(providers, key) {
        for (var i = 0; i < providers.length; i++) {
            if (providers[i].key === key) return providers[i].name;
        }
        return key;
    }

    function renderBindings(bindings) {
        var listEl = $('oauth-binding-list');
        var addEl = $('oauth-bind-add');
        listEl.innerHTML = '';
        addEl.innerHTML = '';

        Promise.all([getOAuthProviders(), oauthFetchBindings()]).then(function (res) {
            var providers = Array.isArray(res[0]) ? res[0] : [];
            var bindingData = (res[1] && res[1].ok) ? res[1].bindings : [];
            var boundMap = {};
            (bindingData || []).forEach(function (b) { boundMap[b.provider] = b; });

            var boundKeys = Object.keys(boundMap);
            if (boundKeys.length === 0) {
                listEl.innerHTML = '<div class="acc-muted">尚未绑定任何平台</div>';
            }

            boundKeys.forEach(function (pKey) {
                var b = boundMap[pKey];
                var name = providerNameOf(providers, pKey);

                var row = document.createElement('div');
                row.className = 'oauth-bind-row';
                row.innerHTML =
                    '<span class="oauth-bind-name">' + escapeHtml(name) +
                    (b.email ? '<span class="oauth-bind-email">' + escapeHtml(b.email) + '</span>' : '') +
                    '</span>';

                var actions = document.createElement('div');
                actions.className = 'oauth-bind-actions';

                // 同步头像
                var syncBtn = document.createElement('button');
                syncBtn.className = 'doodle-btn';
                syncBtn.textContent = '同步头像';
                syncBtn.style.cssText = 'font-size:11px;padding:3px 10px;';
                syncBtn.addEventListener('click', function () {
                    syncBtn.disabled = true;
                    syncBtn.textContent = '同步中…';
                    fetch('/api/oauth/sync-avatar', {
                        method: 'POST',
                        headers: authHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
                        body: 'provider=' + encodeURIComponent(pKey)
                    })
                        .then(function (r) { return r.json(); })
                        .then(function (data) {
                            syncBtn.disabled = false;
                            syncBtn.textContent = '同步头像';
                            if (data.ok && data.player_id) {
                                // 预热缓存强制重新校验 ETag，再刷新预览
                                fetch(getAvatarUrl(data.player_id), { cache: 'reload' })
                                    .then(function () { return loadOverview(); })
                                    .catch(function () { });
                                showTopToast(name + ' 头像已同步', false);
                            } else {
                                showTopToast(data.error || '同步失败', true);
                            }
                        })
                        .catch(function () {
                            syncBtn.disabled = false;
                            syncBtn.textContent = '同步头像';
                            showTopToast('网络错误，请重试', true);
                        });
                });

                // 解绑
                var unbindBtn = document.createElement('button');
                unbindBtn.className = 'doodle-btn danger';
                unbindBtn.textContent = '解绑';
                unbindBtn.style.cssText = 'font-size:11px;padding:3px 10px;';
                unbindBtn.addEventListener('click', function () {
                    if (!confirm('确定解绑「' + name + '」？解绑后无法再用它一键登录。')) return;
                    unbindBtn.disabled = true;
                    oauthUnbind(pKey).then(function (data) {
                        if (data && data.ok) {
                            showTopToast('已解绑 ' + name, false);
                            loadOverview();
                        } else {
                            unbindBtn.disabled = false;
                            showTopToast((data && data.error) || '解绑失败', true);
                        }
                    });
                });

                actions.appendChild(syncBtn);
                actions.appendChild(unbindBtn);
                row.appendChild(actions);
                listEl.appendChild(row);
            });

            // 可添加的平台
            providers.forEach(function (p) {
                if (boundMap[p.key]) return;
                var btn = document.createElement('button');
                btn.className = 'doodle-btn';
                btn.textContent = '绑定 ' + p.name;
                btn.style.cssText = 'font-size:12px;padding:5px 12px;';
                btn.addEventListener('click', function () {
                    oauthBindSubmit(p.key, REDIRECT);
                });
                addEl.appendChild(btn);
            });
            if (!addEl.children.length) {
                addEl.innerHTML = '<div class="acc-muted">全部可用平台均已绑定</div>';
            }
        });
    }

    // ============================================================
    //  四、未登录：注册 / 找回 / OAuth 快捷登录
    // ============================================================

    function requestAccount(action, nickname, password) {
        return fetch('/api/generate-player-id?action=' + action +
            '&nickname=' + encodeURIComponent(nickname) +
            '&password=' + encodeURIComponent(password) +
            '&fp=' + encodeURIComponent(getFingerprint() || ''))
            .then(function (r) { return r.json(); });
    }

    /**
     * 认证成功后的收尾。
     * 若带了 ?redirect=（即从某个玩法页跳来），直接跳回该页；
     * 否则留在账号页刷新视图。
     */
    function afterLogin(nickname, token) {
        if (token) setUserToken(token);
        if (nickname) setUserNickname(nickname);

        if (REDIRECT !== '/account') {
            showTopToast('登录成功，正在返回…', false);
            setTimeout(goBackToSource, 500);
            return;
        }

        $('account-loading').style.display = '';
        loadOverview();
    }

    function initGuestActions() {
        var btnReg = $('btn-guest-register');
        btnReg.addEventListener('click', function () {
            var nickname = ($('guest-nickname').value || '').trim();
            var password = ($('guest-password').value || '').trim();
            if (!nickname) { showTopToast('请先填写昵称'); return; }
            if (password.length < 6) { showTopToast('请设置密码（6位以上）'); return; }

            btnReg.disabled = true;
            requestAccount('register', nickname, password).then(function (data) {
                btnReg.disabled = false;
                if (data.error) { showTopToast(data.error); return; }
                $('guest-password').value = '';
                showTopToast('账号创建成功！', false);
                afterLogin(data.nickname || nickname, data.token);
            }).catch(function () {
                btnReg.disabled = false;
                showTopToast('网络错误，请稍后重试', true);
            });
        });

        var btnRec = $('btn-guest-recover');
        btnRec.addEventListener('click', function () {
            var nickname = ($('guest-nickname').value || '').trim();
            var password = ($('guest-recover-password').value || '').trim();
            if (!nickname) { showTopToast('请先填写昵称'); return; }
            if (password.length < 6) { showTopToast('请输入密码（6位以上）'); return; }

            btnRec.disabled = true;
            requestAccount('recover', nickname, password).then(function (data) {
                btnRec.disabled = false;
                if (data.error) { showTopToast(data.error); return; }
                $('guest-recover-password').value = '';
                showTopToast('账号已找回！', false);
                afterLogin(nickname, data.token);
            }).catch(function () {
                btnRec.disabled = false;
                showTopToast('网络错误，请稍后重试', true);
            });
        });
    }

    function initOAuthQuickButtons() {
        var line = $('oauth-quick-line');
        var container = $('oauth-quick-buttons');
        if (!line || !container) return;
        if (getUserToken()) return;
        if (container.getAttribute('data-ready') === '1') return;

        getOAuthProviders().then(function (providers) {
            if (!Array.isArray(providers) || providers.length === 0) return;
            container.setAttribute('data-ready', '1');
            container.innerHTML = '';
            providers.forEach(function (p) {
                var a = document.createElement('a');
                a.className = 'doodle-btn';
                a.href = oauthLoginUrl(p.key, REDIRECT);
                a.style.cssText = 'font-size:12px;padding:6px 14px;';
                a.textContent = p.name + ' 登录';
                container.appendChild(a);
            });
            line.style.display = '';
        });
    }

    /** OAuth 建号确认弹窗（shared.js 的 oauthHandleReturn 需要它） */
    window.showOAuthCreateDialog = function (pendingCode) {
        oauthPendingInfo(pendingCode).then(function (info) {
            if (!info.ok) {
                showTopToast(info.error || '登录凭证已失效，请重新登录', true);
                oauthCleanUrlParams();
                return;
            }

            var overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:var(--overlay-bg);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
            overlay.innerHTML =
                '<div class="doodle-border hub-hand" style="background:var(--surface-white);padding:22px;width:min(360px,100%);box-sizing:border-box;">' +
                '<h3 style="margin:0 0 10px;font-size:16px;">创建新账号？</h3>' +
                '<p style="font-size:13px;color:var(--text-muted);margin:0 0 12px;">该 <b>' + escapeHtml(info.provider || '') + '</b> 账号尚未关联本站玩家，是否用以下邮箱创建账号？</p>' +
                '<div style="font-size:13px;background:var(--cover-bg);border-radius:8px;padding:8px 10px;margin-bottom:12px;word-break:break-all;">邮箱：' + escapeHtml(info.email || '（未提供）') + '</div>' +
                '<label style="font-size:12px;color:var(--text-subtle);">昵称（可修改）：</label>' +
                '<input id="oauth-create-nickname" type="text" maxlength="12" value="' + escapeHtmlAttr(info.nickname || '') + '" style="width:100%;box-sizing:border-box;margin-top:4px;padding:8px 10px;border:2px solid var(--ink-black);border-radius:8px;font-size:14px;background:var(--bg-input);color:var(--ink-black);">' +
                '<div id="oauth-create-error" style="display:none;font-size:12px;color:var(--danger);margin-top:8px;"></div>' +
                '<div style="display:flex;gap:10px;margin-top:16px;">' +
                '<button id="oauth-create-confirm" class="doodle-btn" style="flex:1;justify-content:center;">创建账户</button>' +
                '<button id="oauth-create-cancel" class="doodle-btn" style="flex:1;justify-content:center;">不创建</button>' +
                '</div></div>';
            document.body.appendChild(overlay);

            function showErr(msg) {
                var el = overlay.querySelector('#oauth-create-error');
                if (el) { el.textContent = msg; el.style.display = ''; }
            }

            overlay.querySelector('#oauth-create-cancel').addEventListener('click', function () {
                oauthCancelCreate(pendingCode);
                overlay.remove();
                oauthCleanUrlParams();
                showTopToast('已取消创建', false);
            });

            overlay.querySelector('#oauth-create-confirm').addEventListener('click', function () {
                var nickname = overlay.querySelector('#oauth-create-nickname').value.trim();
                if (!nickname) { showErr('昵称不能为空'); return; }
                var btn = overlay.querySelector('#oauth-create-confirm');
                btn.disabled = true;
                oauthConfirmCreate(pendingCode, nickname, getFingerprint()).then(function (data) {
                    if (data.ok && data.token) {
                        setUserToken(data.token);
                        if (data.nickname) setUserNickname(data.nickname);
                        overlay.remove();
                        oauthCleanUrlParams();
                        showTopToast('账号创建成功！', false);
                        setTimeout(goBackToSource, 800);
                    } else {
                        btn.disabled = false;
                        showErr(data.error || '创建失败，请重试');
                    }
                });
            });
        });
    };

    // ============================================================
    //  五、聊天记录回顾 / 对手留言管理
    // ============================================================

    var chatHistoryPage = 1;
    var stickerMapCache = null;
    var stickerMapRequest = null;

    /** 表情映射（优先本地缓存，缺失时拉取一次用于渲染记录里的表情消息） */
    function getStickerMap() {
        if (stickerMapCache) return Promise.resolve(stickerMapCache);
        if (!stickerMapRequest) {
            stickerMapRequest = fetch('/api/sticker/list', { headers: authHeaders() })
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    stickerMapCache = (res && res.stickers)
                        ? handleStickersList(res)
                        : (loadStickerCache() || {});
                    return stickerMapCache;
                })
                .catch(function () {
                    stickerMapCache = loadStickerCache() || {};
                    return stickerMapCache;
                });
        }
        return stickerMapRequest;
    }

    function emptyTip(el, text, isError) {
        el.innerHTML = '';
        var div = document.createElement('div');
        div.className = 'acc-empty' + (isError ? ' is-error' : '');
        div.textContent = text;
        el.appendChild(div);
    }

    // ---------- 聊天记录回顾 ----------

    var chatResultLabels = { win: '胜', lose: '负', draw: '平' };
    var chatGuessLabels = { human: '猜人类', ai: '猜AI' };
    var chatTruthLabels = { human: '对方是人类', ai: '对方是AI' };

    function loadChatHistoryList(page) {
        var listEl = $('chat-history-list');
        if (!listEl || !getUserToken()) return;
        chatHistoryPage = page || 1;
        emptyTip(listEl, '加载中…');

        fetch('/api/chat-history?page=' + chatHistoryPage, { headers: authHeaders() })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.error) { emptyTip(listEl, data.error, true); return; }
                renderChatHistoryList(data || {});
            })
            .catch(function () { emptyTip(listEl, '加载失败，请稍后重试', true); });
    }

    function renderChatHistoryList(data) {
        var listEl = $('chat-history-list');
        var pagEl = $('chat-history-pagination');
        var list = data.list || [];

        if (!list.length) {
            emptyTip(listEl, '暂无保存的聊天记录，对局结束后点「保存聊天记录」即可留档');
            pagEl.innerHTML = '';
            return;
        }

        listEl.innerHTML = '';
        list.forEach(function (item) {
            var row = document.createElement('div');
            row.className = 'acc-history-row';
            row.dataset.id = item.id;

            var time = item.created_at ? String(item.created_at).substring(0, 16).replace('T', ' ') : '';
            var title = item.title || (item.player_name + ' vs ' + item.opponent_name);
            var metaParts = [
                chatGuessLabels[item.player_guess] || '未判定',
                chatTruthLabels[item.opponent_truth] || '',
                item.message_count + ' 条消息',
                time
            ].filter(Boolean);
            if (item.likes) metaParts.push('❤ ' + item.likes);

            row.innerHTML =
                '<div class="acc-history-top">' +
                    '<span class="acc-history-title">' + (item.title ? '🔖 ' : '') +
                        escapeHtml(title) +
                        (item.is_public ? '<span class="acc-history-badge">公开</span>' : '') +
                    '</span>' +
                    '<span class="acc-history-result is-' + escapeHtml(item.result || '') + '">' +
                        escapeHtml(chatResultLabels[item.result] || '') + '</span>' +
                '</div>' +
                '<div class="acc-history-meta">' + escapeHtml(metaParts.join(' · ')) + '</div>';

            row.addEventListener('click', function () { showChatHistoryDetail(item.id); });
            listEl.appendChild(row);
        });

        var totalPages = Math.ceil((data.total || 0) / (data.page_size || 1));
        pagEl.innerHTML = '';
        if (totalPages <= 1) return;
        for (var i = 1; i <= totalPages; i++) {
            (function (n) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = n;
                if (n === data.page) {
                    btn.className = 'is-current';
                } else {
                    btn.addEventListener('click', function () { loadChatHistoryList(n); });
                }
                pagEl.appendChild(btn);
            })(i);
        }
    }

    function showChatHistoryDetail(id) {
        var token = getUserToken();
        if (!token || !id) return;

        var overlay = $('chat-history-detail-overlay');
        var titleEl = $('chat-detail-title');
        var infoEl = $('chat-detail-info');
        var msgEl = $('chat-detail-messages');

        titleEl.textContent = '加载中…';
        infoEl.innerHTML = '';
        emptyTip(msgEl, '加载中…');
        overlay.style.display = 'flex';

        Promise.all([
            fetch('/api/chat-history/detail?id=' + id, { headers: authHeaders() })
                .then(function (r) { return r.json(); }),
            getStickerMap()
        ]).then(function (res) {
            var data = res[0];
            var stickerMap = res[1] || {};
            if (!data || data.error) {
                emptyTip(msgEl, (data && data.error) || '加载失败', true);
                return;
            }
            renderChatHistoryDetail(id, data, stickerMap, titleEl, infoEl, msgEl);
        }).catch(function () {
            emptyTip(msgEl, '网络错误，请稍后重试', true);
        });
    }

    function renderChatHistoryDetail(id, data, stickerMap, titleEl, infoEl, msgEl) {
        var detailResultLabels = { win: '胜利', lose: '失败', draw: '平局' };
        var time = data.created_at ? String(data.created_at).substring(0, 16).replace('T', ' ') : '';
        var title = data.title || (data.player_name + ' vs ' + data.opponent_name);
        var publicUrl = data.public_token
            ? (window.location.origin + '/collection/' + data.public_token)
            : '';

        titleEl.textContent = title;

        infoEl.innerHTML =
            '<div class="acc-chat-summary">' +
                '<span class="acc-chat-result">' + escapeHtml(detailResultLabels[data.result] || '??') + '</span>' +
                '<span>' + escapeHtml(time) + '</span>' +
                '<span>' + (data.message_count || 0) + ' 条消息</span>' +
            '</div>' +
            '<div class="acc-collect-box">' +
                '<div class="acc-collect-label">收藏管理</div>' +
                '<input type="text" id="detail-title-input" maxlength="100" placeholder="为此记录起个名字" value="' +
                    escapeHtmlAttr(data.title || '') + '">' +
                '<label class="acc-collect-check">' +
                    '<input type="checkbox" id="detail-public-check"' + (data.is_public ? ' checked' : '') + '>' +
                    ' 公开聊天记录' +
                '</label>' +
                '<div class="acc-inline" id="detail-public-link" style="display:' +
                    (data.public_token ? 'flex' : 'none') + ';">' +
                    '<input type="text" id="detail-public-url" readonly value="' + escapeHtmlAttr(publicUrl) + '">' +
                    '<button class="doodle-btn" id="btn-copy-public-link" type="button">复制</button>' +
                '</div>' +
                '<button class="doodle-btn acc-cta" id="btn-detail-collection-save" type="button">保存</button>' +
                '<div class="acc-collect-status" id="detail-collection-status"></div>' +
            '</div>';

        renderChatMessages(msgEl, data.messages, stickerMap);

        bindCollectionActions(id);
    }

    function renderChatMessages(msgEl, messages, stickerMap) {
        if (!messages || !messages.length) {
            emptyTip(msgEl, '无聊天消息');
            return;
        }
        msgEl.innerHTML = '';
        messages.forEach(function (msg) {
            var isRight = msg.side === 'right';
            var contentHtml = escapeHtml(msg.text || '');
            if (msg.sticker_id) {
                var sName = escapeHtml(msg.sticker_name || msg.sticker_id);
                var sUrl = resolveStickerUrl(msg.sticker_id, msg.sticker_url || '', stickerMap);
                contentHtml = sUrl
                    ? '<img class="acc-chat-sticker" src="' + escapeHtmlAttr(sUrl) + '" alt="' + sName + '" loading="lazy">'
                    : '<span class="acc-chat-sticker-missing">[表情: ' + sName + ']</span>';
            }

            var wrap = document.createElement('div');
            wrap.className = 'acc-chat-msg ' + (isRight ? 'is-right' : 'is-left');
            wrap.innerHTML =
                '<div class="acc-chat-bubble">' +
                    '<div class="acc-chat-meta">' + escapeHtml(msg.sender || '') + ' · ' + escapeHtml(msg.time || '') + '</div>' +
                    '<div class="acc-chat-text">' + contentHtml + '</div>' +
                '</div>';
            msgEl.appendChild(wrap);
        });
    }

    function bindCollectionActions(id) {
        var statusEl = $('detail-collection-status');
        var linkArea = $('detail-public-link');
        var urlInput = $('detail-public-url');
        var publicCheck = $('detail-public-check');
        var saveBtn = $('btn-detail-collection-save');

        function setStatus(message, type) {
            statusEl.textContent = message || '';
            statusEl.style.display = message ? '' : 'none';
            statusEl.classList.toggle('is-success', type === 'success');
            statusEl.classList.toggle('is-error', type === 'error');
        }

        function collect(payload) {
            return fetch('/api/chat-history/collect', {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(payload)
            }).then(function (r) { return r.json(); });
        }

        // 公开开关：立即生效
        publicCheck.addEventListener('change', function () {
            var isPublic = publicCheck.checked;
            publicCheck.disabled = true;
            setStatus('处理中…');
            collect({ id: id, is_public: isPublic })
                .then(function (res) {
                    if (res && res.success) {
                        if (isPublic && res.public_url) {
                            urlInput.value = window.location.origin + res.public_url;
                            linkArea.style.display = 'flex';
                            setStatus('公开链接已生成', 'success');
                        } else {
                            linkArea.style.display = 'none';
                            setStatus('已关闭公开', 'success');
                        }
                    } else {
                        publicCheck.checked = !isPublic;
                        setStatus((res && res.message) || '操作失败', 'error');
                    }
                    publicCheck.disabled = false;
                })
                .catch(function () {
                    publicCheck.checked = !isPublic;
                    publicCheck.disabled = false;
                    setStatus('网络错误，请稍后重试', 'error');
                });
        });

        $('btn-copy-public-link').addEventListener('click', function () {
            var urlInput2 = $('detail-public-url');
            urlInput2.select();
            try { document.execCommand('copy'); } catch (e) { }
            setStatus('链接已复制', 'success');
        });

        saveBtn.addEventListener('click', function () {
            var title = $('detail-title-input').value.trim();
            saveBtn.disabled = true;
            saveBtn.textContent = '保存中…';
            collect({ id: id, title: title || null })
                .then(function (res) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = '保存';
                    if (res && res.success) {
                        setStatus('已保存', 'success');
                        loadChatHistoryList(chatHistoryPage);
                    } else {
                        setStatus((res && res.message) || '保存失败', 'error');
                    }
                })
                .catch(function () {
                    saveBtn.disabled = false;
                    saveBtn.textContent = '保存';
                    setStatus('网络错误，请稍后重试', 'error');
                });
        });
    }

    // ---------- 对手留言管理 ----------

    function loadMessageManageList() {
        var listEl = $('message-manage-list');
        if (!listEl || !getUserToken()) return;
        emptyTip(listEl, '加载中…');

        fetch('/api/player-messages', { headers: authHeaders() })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.error) { emptyTip(listEl, data.error, true); return; }
                renderMessageList(listEl, data || {});
            })
            .catch(function () { emptyTip(listEl, '加载失败，请稍后重试', true); });
    }

    function renderMessageList(listEl, data) {
        var allowLabel = $('message-allow-label');
        var allowToggle = $('message-allow-toggle');
        var messages = data.messages || [];

        allowLabel.style.display = 'flex';
        allowToggle.checked = data.allow_messages !== false;
        allowToggle.onchange = function () {
            fetch('/api/player-message/settings', {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ allow_messages: allowToggle.checked })
            }).then(function (r) { return r.json(); })
                .then(function (res) {
                    showTopToast((res && res.message) || '设置已更新', false);
                })
                .catch(function () {
                    allowToggle.checked = !allowToggle.checked;
                    showTopToast('网络错误，请稍后重试', true);
                });
        };

        if (!messages.length) {
            emptyTip(listEl, '暂无留言');
            return;
        }

        listEl.innerHTML = '';
        messages.forEach(function (msg) {
            var hidden = !!msg.hidden;
            var time = msg.created_at
                ? new Date(msg.created_at * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '';

            var row = document.createElement('div');
            row.className = 'acc-msg-row';
            row.innerHTML =
                '<div class="acc-msg-body">' +
                    '<span class="acc-msg-from">' + escapeHtml(msg.from || '') + '</span>' +
                    '<span class="acc-msg-text' + (hidden ? ' is-hidden' : '') + '"> ' + escapeHtml(msg.text || '') + '</span>' +
                    '<span class="acc-msg-time">' + escapeHtml(time) + '</span>' +
                '</div>';

            var btn = document.createElement('button');
            btn.className = 'doodle-btn';
            btn.type = 'button';
            btn.textContent = hidden ? '显示' : '隐藏';
            btn.addEventListener('click', function () {
                btn.disabled = true;
                fetch('/api/player-message/hide', {
                    method: 'POST',
                    headers: authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ message_id: msg.id, hidden: !hidden })
                }).then(function (r) { return r.json(); })
                    .then(function (res) {
                        if (res && res.success) {
                            loadMessageManageList();
                        } else {
                            btn.disabled = false;
                            showTopToast((res && res.error) || '操作失败', true);
                        }
                    })
                    .catch(function () {
                        btn.disabled = false;
                        showTopToast('网络错误，请稍后重试', true);
                    });
            });
            row.appendChild(btn);
            listEl.appendChild(row);
        });
    }

    function initChatDetailOverlay() {
        var overlay = $('chat-history-detail-overlay');
        if (!overlay) return;
        $('btn-chat-detail-close').addEventListener('click', function () {
            overlay.style.display = 'none';
        });
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) overlay.style.display = 'none';
        });
    }

    // ============================================================
    //  六、已登录操作
    // ============================================================

    function initMainActions() {
        // 保存佩戴标签
        var saveTagsBtn = $('btn-save-account-tags');
        if (saveTagsBtn) saveTagsBtn.addEventListener('click', saveAccountTags);

        // 修改昵称
        $('btn-rename').addEventListener('click', function () {
            var cur = getUserNickname();
            var input = prompt('输入新昵称（每月限改一次）', cur);
            if (input === null) return;
            var trimmed = input.trim();
            if (!trimmed || trimmed === cur) return;
            if (trimmed.length > 16) { showTopToast('昵称不能超过16个字符'); return; }

            var btn = $('btn-rename');
            btn.disabled = true;
            fetch('/api/account/nickname', {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ nickname: trimmed, fp: getFingerprint() || '' })
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data && data.ok) {
                        setUserNickname(data.nickname);
                        showTopToast('昵称已修改为：' + data.nickname, false);
                        loadOverview();
                    } else {
                        btn.disabled = false;
                        showTopToast((data && data.error) || '修改失败', true);
                    }
                })
                .catch(function () {
                    btn.disabled = false;
                    showTopToast('网络错误，请稍后重试', true);
                });
        });

        // 设置新密码（与首页「保存账号」同一后端能力）
        $('btn-set-password').addEventListener('click', function () {
            var pwd = ($('new-password').value || '').trim();
            if (pwd.length < 6) { showTopToast('请设置密码（6位以上）'); return; }
            var nickname = getUserNickname();
            if (!nickname) { showTopToast('未获取到昵称，请刷新重试'); return; }

            var btn = $('btn-set-password');
            btn.disabled = true;
            requestAccount('register', nickname, pwd).then(function (data) {
                btn.disabled = false;
                if (data.error) { showTopToast(data.error); return; }
                if (data.token) setUserToken(data.token);
                $('new-password').value = '';
                showTopToast('密码已更新', false);
            }).catch(function () {
                btn.disabled = false;
                showTopToast('网络错误，请稍后重试', true);
            });
        });

        // 退出登录
        $('btn-logout').addEventListener('click', function () {
            if (!confirm('确定退出？')) return;
            try {
                setUserToken('');
                setUserNickname('');
            } catch (e) { }
            showTopToast('已退出登录', false);
            setTimeout(function () { window.location.reload(); }, 500);
        });
    }

    // ============================================================
    //  启动
    // ============================================================

    function init() {
        $('btn-back').addEventListener('click', function () { window.location.href = '/'; });
        bindFold('guest-recover-toggle', 'guest-recover-body');
        bindFold('password-toggle', 'password-body');
        initChatDetailOverlay();
        initGuestActions();
        initMainActions();

        // OAuth 回调（oauth_code / pending_code / oauth_error）：
        // 兑换成功后会整页刷新；无参数时为 no-op。需在读取视图之前处理。
        if (typeof oauthHandleReturn === 'function') oauthHandleReturn();

        if (!getUserToken()) {
            showGuest();
            return;
        }
        loadOverview();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
