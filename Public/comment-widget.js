/**
 * XQFGameHub —— 「评价与打分」共享组件
 * ---------------------------------------------------------------
 * 从 script.js 抽出，供首页(/)、1v1 玩法页(/turing) 等任意页面复用。
 * 组件自建弹层，只依赖 style.css 里已有的 #comment-overlay .cw-* 样式。
 *
 * 用法：<script src="/comment-widget.js?v="></script>
 *       CommentWidget.open()   // 打开弹层
 */
(function () {
    'use strict';

    var CMT_API = 'https://fakeicp.top';
    var CMT_SITE = 'game.xfcode.top';
    var CMT_PAGE = '/';   // 评价数据以 site+page 为键，保持不变以延续已有评分
    var CMT_TITLE = 'XQFGameHub';

    var overlayEl = null;
    var widgetEl = null;

    /** 按需创建弹层（各页只需一个挂载点，避免每页复制 DOM） */
    function ensureOverlay() {
        if (overlayEl) return;

        overlayEl = document.createElement('div');
        overlayEl.id = 'comment-overlay';
        overlayEl.innerHTML =
            '<div class="clipboard-drawer">' +
            '<div class="paper-content doodle-border">' +
            '<div class="drawer-header">' +
            '<h2>评价与打分</h2>' +
            '<button class="doodle-btn" id="btn-close-comment" style="padding: 4px 8px; border:none;" aria-label="关闭">' +
            '<svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
            '</div>' +
            '<div id="flm-comment-widget"></div>' +
            '</div></div>';
        document.body.appendChild(overlayEl);

        widgetEl = overlayEl.querySelector('#flm-comment-widget');

        overlayEl.querySelector('#btn-close-comment').addEventListener('click', function () {
            close();
        });
        overlayEl.addEventListener('click', function (e) {
            if (e.target === overlayEl) close();
        });
    }

    function close() {
        if (overlayEl) overlayEl.style.display = 'none';
    }




    let cmtSdk = null;
    let cmtSdkLoading = false;
    let cmtRating = 5;

    function cmtEsc(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function cmtStars(rating) {
        rating = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
        let h = '';
        for (let i = 1; i <= 5; i++) {
            h += '<span class="' + (i <= rating ? 'on' : 'off') + '">' + (i <= rating ? '★' : '☆') + '</span>';
        }
        return h;
    }

    function cmtLoadSdk(cb) {
        if (window.FlmCommentSDK) { cb(null); return; }
        if (cmtSdkLoading) return;
        cmtSdkLoading = true;
        const s = document.createElement('script');
        s.src = CMT_API + '/comment-sdk.js';
        s.async = true;
        s.onload = () => { cmtSdkLoading = false; cb(null); };
        s.onerror = () => { cmtSdkLoading = false; cb(new Error('评价 SDK 加载失败')); };
        document.head.appendChild(s);
    }

    function cmtOpen() {
        overlayEl.style.display = 'flex';
        widgetEl.innerHTML = '<div class="cw-loading">加载评价系统...</div>';
        cmtLoadSdk((err) => {
            if (err) {
                widgetEl.innerHTML = '<div class="cw-empty">' + cmtEsc(err.message) + '</div>';
                return;
            }
            if (!cmtSdk) {
                cmtSdk = new window.FlmCommentSDK({ apiBase: CMT_API, siteKey: CMT_SITE, pageKey: CMT_PAGE, pageTitle: CMT_TITLE });
            }
            cmtFetchAndRender();
        });
    }

    function cmtFetchAndRender() {
        let commentsData = null;
        let reactions = null;
        const done = () => {
            if (commentsData !== null && reactions !== null) {
                cmtRender(commentsData, reactions);
            }
        };
        cmtSdk.fetchComments({ page: 1, limit: 30 }, (err, res) => {
            if (err || !res || !res.ok) {
                widgetEl.innerHTML = '<div class="cw-empty">评价加载失败：' + cmtEsc(err ? err.message : '未知错误') + '</div>';
                return;
            }
            commentsData = res.data;
            done();
        });
        cmtSdk.fetchReactions((err, res) => {
            reactions = (res && res.ok && res.reactions) ? res.reactions : {};
            done();
        });
    }

    function cmtRender(data, reactions) {
        const stats = data.stats || {};
        const comments = data.comments || [];
        const icpInfo = data.icp_info;
        const total = stats.total_reviews || 0;
        const avg = (Number(stats.avg_rating) || 0).toFixed(1);
        const stamps = reactions.stamps || [];

        let html = '';

        // 头部：标题 + ICP 徽标 + 评分大厅链接
        html += '<div class="cw-header">';
        html += '<div class="cw-title-area">';
        html += '<div class="cw-title">评价与打分</div>';
        html += '<span class="cw-icp-badge">' + cmtEsc((icpInfo && icpInfo.display) || data.site_key || '未备案站点') + '</span>';
        html += '</div>';
        html += '<a class="cw-hall-link" href="' + CMT_API + '/rating.html" target="_blank" rel="noopener">进入假备评分大厅 →</a>';
        html += '</div>';

        // 汇总：均分 + 星级 + 分布条
        html += '<div class="cw-section cw-summary-row">';
        html += '<div class="cw-score-big">' + avg + '</div>';
        html += '<div class="cw-score-meta">';
        html += '<div class="cw-stars-row">' + cmtStars(Math.round(avg)) + '</div>';
        html += '<div class="cw-count-text">共 ' + total + ' 条有效评分</div>';
        html += '</div>';
        html += '<div class="cw-bars">';
        for (let star = 5; star >= 1; star--) {
            const sc = stats['star_' + star + '_count'] || 0;
            const pct = total > 0 ? Math.round((sc / total) * 100) : 0;
            html += '<div class="cw-bar-item"><span>' + star + '星</span>' +
                '<div class="cw-bar-bg"><div class="cw-bar-fill" style="width:' + pct + '%;"></div></div>' +
                '<span class="cw-bar-num">' + pct + '%</span></div>';
        }
        html += '</div>';
        html += '</div>';

        // 印章表态
        html += '<div class="cw-section">';
        html += '<div class="cw-section-title"><span>印章表态</span><span class="cw-section-sub">（免登录，点击即可表态）</span></div>';
        if (stamps.length) {
            html += '<div class="cw-stamp-grid">';
            for (let i = 0; i < stamps.length; i++) {
                const st = stamps[i];
                const sid = st.id || st.type;
                const key = 'flm_stamp_' + CMT_SITE + '_' + CMT_PAGE + '_' + sid;
                const active = window.localStorage ? window.localStorage.getItem(key) === '1' : false;
                html += '<button type="button" class="cw-stamp-btn' + (active ? ' active' : '') + '" data-type="' + cmtEsc(sid) + '" data-icon="' + cmtEsc(st.icon) + '">';
                html += '<span>' + cmtEsc(st.icon) + ' ' + cmtEsc(st.label) + '</span>';
                html += '<span class="cw-stamp-count">' + (Number(st.count) || 0) + '</span>';
                html += '</button>';
            }
            html += '</div>';
        } else {
            html += '<div class="cw-empty">印章数据加载失败，请稍后刷新重试</div>';
        }
        html += '</div>';

        // 发布表单
        html += '<div class="cw-section">';
        html += '<div class="cw-section-title"><span>发布评分与评语</span><span class="cw-section-sub">（打分评价每人限 1 次，重复提交自动覆盖）</span></div>';
        html += '<div class="cw-star-select" id="cw-star-box">';
        for (let s = 1; s <= 5; s++) {
            html += '<span data-star="' + s + '" class="on">★</span>';
        }
        html += '<span class="cw-star-tip" id="cw-star-tip">5星 力荐</span>';
        html += '</div>';
        html += '<div class="cw-input-grid">';
        html += '<input type="text" class="cw-input" id="cw-inp-nick" placeholder="昵称 *" maxlength="50" />';
        html += '<input type="email" class="cw-input" id="cw-inp-email" placeholder="邮箱（选填，支持头像）" />';
        html += '<input type="url" class="cw-input" id="cw-inp-web" placeholder="个人主页（选填，https://...）" />';
        html += '</div>';
        html += '<div class="cw-tag-row"><span class="cw-tag-label">添加标签:</span>';
        const defaultTags = ['独立博客', '前端', '技术干货', '实用工具', 'UI设计', '游戏', '生活'];
        for (let t = 0; t < defaultTags.length; t++) {
            html += '<button type="button" class="cw-tag-pill" data-tag="' + defaultTags[t] + '">+ #' + defaultTags[t] + '</button>';
        }
        html += '<input type="text" class="cw-input cw-tag-input" id="cw-inp-tags" placeholder="自定义标签（如 #前端 #博客）..." />';
        html += '</div>';
        html += '<textarea class="cw-textarea" id="cw-inp-content" placeholder="撰写您的客观评价正文（支持普通评论与星级打分）..."></textarea>';
        html += '<div class="cw-form-foot"><span class="cw-msg" id="cw-msg"></span>' +
            '<button type="button" class="cw-btn" id="cw-btn-submit">提交打分评价</button></div>';
        html += '</div>';

        // 评论列表
        html += '<div class="cw-list">';
        if (!comments.length) {
            html += '<div class="cw-empty">暂无评价，快来抢先留下第一条评价吧！</div>';
        } else {
            for (let i = 0; i < comments.length; i++) {
                html += cmtCard(comments[i]);
            }
        }
        html += '</div>';

        widgetEl.innerHTML = html;
        cmtBindEvents();
    }

    function cmtCard(c) {
        const avatar = window.FlmCommentSDK.getAvatarUrl(c.email, c.nickname);
        const time = window.FlmCommentSDK.formatTimeAgo(c.created_at);
        let html = '<div class="cw-card" data-id="' + cmtEsc(c.id) + '">';
        html += '<div class="cw-card-head">';
        html += '<div class="cw-user-info">';
        html += '<img class="cw-avatar" src="' + avatar + '" alt="avatar" />';
        html += '<div class="cw-user-meta">';
        html += '<div class="cw-nickname">' + cmtEsc(c.nickname);
        if (c.website) {
            html += '<a class="cw-web-link" href="' + cmtEsc(c.website) + '" target="_blank" rel="nofollow ugc noopener" title="访问个人主页">主页</a>';
        }
        html += '</div>';
        html += '<div class="cw-time">' + time + '</div>';
        html += '</div></div>';
        if (c.rating) {
            html += '<div class="cw-card-rating">' + cmtStars(c.rating) + '</div>';
        }
        html += '</div>';
        html += '<div class="cw-content">' + cmtEsc(c.content) + '</div>';
        if (c.tags) {
            const pills = String(c.tags).split(',')
                .filter((x) => x.trim())
                .map((x) => '<span>#' + cmtEsc(x.trim()) + '</span>')
                .join('');
            if (pills) {
                html += '<div class="cw-card-tags">' + pills + '</div>';
            }
        }
        html += '<div class="cw-card-foot">';
        html += '<button type="button" class="cw-action-btn cw-btn-like" data-id="' + cmtEsc(c.id) + '">赞 <span class="cw-like-num">' + (c.likes || 0) + '</span></button>';
        html += '<button type="button" class="cw-action-btn cw-btn-reply" data-id="' + cmtEsc(c.id) + '">回复 (' + (c.replies ? c.replies.length : 0) + ')</button>';
        html += '</div>';
        if (c.replies && c.replies.length) {
            html += '<div class="cw-replies">';
            for (let r = 0; r < c.replies.length; r++) {
                const rp = c.replies[r];
                html += '<div class="cw-reply-card"><div class="cw-reply-head"><span class="cw-reply-nick">' + cmtEsc(rp.nickname) + '</span>' +
                    '<span class="cw-time">' + window.FlmCommentSDK.formatTimeAgo(rp.created_at) + '</span></div>' +
                    '<div>' + cmtEsc(rp.content) + '</div></div>';
            }
            html += '</div>';
        }
        html += '<div class="cw-reply-drawer" id="cw-reply-drawer-' + cmtEsc(c.id) + '" style="display:none;"></div>';
        html += '</div>';
        return html;
    }

    function cmtReplyForm(parentId) {
        return '<div class="cw-reply-form">' +
            '<div class="cw-reply-form-title">回复评论 #' + parentId + '</div>' +
            '<div class="cw-input-grid" style="grid-template-columns:1fr 1fr; margin-bottom:6px;">' +
            '<input type="text" class="cw-input" id="cw-r-nick-' + parentId + '" placeholder="昵称 *" />' +
            '<input type="email" class="cw-input" id="cw-r-email-' + parentId + '" placeholder="邮箱（选填）" />' +
            '</div>' +
            '<textarea class="cw-textarea" id="cw-r-content-' + parentId + '" style="height:54px;" placeholder="撰写回复正文..."></textarea>' +
            '<div class="cw-form-foot"><span class="cw-msg" id="cw-r-msg-' + parentId + '"></span>' +
            '<button type="button" class="cw-btn" id="cw-r-btn-' + parentId + '" style="padding:4px 12px; font-size:12px;">发送回复</button></div>' +
            '</div>';
    }

    function cmtBindReplyEvents(parentId) {
        const btn = widgetEl.querySelector('#cw-r-btn-' + parentId);
        if (!btn) return;
        btn.addEventListener('click', () => {
            const nick = widgetEl.querySelector('#cw-r-nick-' + parentId).value;
            const email = widgetEl.querySelector('#cw-r-email-' + parentId).value;
            const content = widgetEl.querySelector('#cw-r-content-' + parentId).value;
            const msg = widgetEl.querySelector('#cw-r-msg-' + parentId);
            if (!nick || !content) {
                if (msg) msg.innerText = '请填写昵称与回复正文';
                return;
            }
            btn.disabled = true;
            cmtSdk.reply(parentId, { nickname: nick, email: email, content: content }, (err, res) => {
                btn.disabled = false;
                if (err || !res || !res.ok) {
                    if (msg) msg.innerText = err ? err.message : '回复失败';
                    return;
                }
                cmtFetchAndRender();
            });
        });
    }

    function cmtBindEvents() {
        // 印章表态
        widgetEl.querySelectorAll('.cw-stamp-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const type = btn.getAttribute('data-type');
                const key = 'flm_stamp_' + CMT_SITE + '_' + CMT_PAGE + '_' + type;
                if (window.localStorage && window.localStorage.getItem(key) === '1') return;
                const countEl = btn.querySelector('.cw-stamp-count');
                const cur = Number(countEl.innerText) || 0;
                countEl.innerText = cur + 1;
                btn.classList.add('active');
                if (window.localStorage) window.localStorage.setItem(key, '1');
                cmtSdk.sendReaction(type, (err, res) => {
                    if (res && res.ok && res.reactions) {
                        countEl.innerText = res.reactions[type] || (cur + 1);
                    }
                });
            });
        });

        // 星级选择
        const starBox = widgetEl.querySelector('#cw-star-box');
        if (starBox) {
            const stars = starBox.querySelectorAll('span[data-star]');
            const tip = widgetEl.querySelector('#cw-star-tip');
            const texts = { 1: '1星 极差', 2: '2星 较差', 3: '3星 一般', 4: '4星 推荐', 5: '5星 力荐' };
            stars.forEach((sp) => {
                sp.addEventListener('click', () => {
                    cmtRating = Number(sp.getAttribute('data-star'));
                    stars.forEach((st) => st.classList.toggle('on', Number(st.getAttribute('data-star')) <= cmtRating));
                    if (tip) tip.innerText = texts[cmtRating];
                });
            });
        }

        // 预设标签追加
        const tagInp = widgetEl.querySelector('#cw-inp-tags');
        widgetEl.querySelectorAll('.cw-tag-pill').forEach((btn) => {
            btn.addEventListener('click', () => {
                const t = '#' + btn.getAttribute('data-tag');
                const cur = (tagInp ? tagInp.value : '').trim();
                if (cur.indexOf(t) === -1) {
                    if (tagInp) tagInp.value = cur ? (cur + ' ' + t) : t;
                }
            });
        });

        // 提交评价
        const btnSubmit = widgetEl.querySelector('#cw-btn-submit');
        if (btnSubmit) {
            btnSubmit.addEventListener('click', () => {
                const nick = widgetEl.querySelector('#cw-inp-nick').value;
                const email = widgetEl.querySelector('#cw-inp-email').value;
                const web = widgetEl.querySelector('#cw-inp-web').value;
                const tags = tagInp ? tagInp.value : '';
                const content = widgetEl.querySelector('#cw-inp-content').value;
                const msg = widgetEl.querySelector('#cw-msg');
                if (!nick) { if (msg) msg.innerText = '请填写昵称'; return; }
                if (!content) { if (msg) msg.innerText = '请填写评价正文'; return; }
                btnSubmit.disabled = true;
                btnSubmit.innerText = '⏳ 提交中...';
                cmtSdk.submit({
                    nickname: nick,
                    email: email,
                    website: web,
                    tags: tags,
                    rating: cmtRating,
                    content: content
                }, (err, res) => {
                    btnSubmit.disabled = false;
                    btnSubmit.innerText = '提交打分评价';
                    if (err || !res || !res.ok) {
                        if (msg) msg.innerText = err ? err.message : '提交失败';
                        return;
                    }
                    if (msg) msg.innerText = res.message || '发布成功！';
                    cmtFetchAndRender();
                });
            });
        }

        // 点赞 / 回复（事件代理）
        widgetEl.addEventListener('click', (e) => {
            const likeBtn = e.target.closest('.cw-btn-like');
            if (likeBtn) {
                const cid = likeBtn.getAttribute('data-id');
                cmtSdk.like(cid, (err, res) => {
                    if (!err && res && res.ok) {
                        const numSpan = likeBtn.querySelector('.cw-like-num');
                        if (numSpan) numSpan.innerText = res.likes;
                        likeBtn.style.color = 'var(--ink-blue)';
                    }
                });
                return;
            }
            const replyBtn = e.target.closest('.cw-btn-reply');
            if (replyBtn) {
                const cid = replyBtn.getAttribute('data-id');
                const drawer = widgetEl.querySelector('#cw-reply-drawer-' + cid);
                if (!drawer) return;
                if (drawer.style.display === 'none' || drawer.style.display === '') {
                    drawer.style.display = 'block';
                    drawer.innerHTML = cmtReplyForm(cid);
                    cmtBindReplyEvents(cid);
                } else {
                    drawer.style.display = 'none';
                }
            }
        });
    }





    /**
     * 打开评价弹层。
     * 页面若自带 #btn-comment-widget（如首页拓展服务区），组件会自动绑定。
     */
    function open() {
        ensureOverlay();
        cmtOpen();
    }

    function bindTriggers() {
        var triggers = document.querySelectorAll('#btn-comment-widget, [data-comment-widget]');
        for (var i = 0; i < triggers.length; i++) {
            if (triggers[i].getAttribute('data-cw-bound') === '1') continue;
            triggers[i].setAttribute('data-cw-bound', '1');
            triggers[i].addEventListener('click', function (e) {
                e.preventDefault();
                open();
            });
        }
    }

    window.CommentWidget = { open: open, close: close, bindTriggers: bindTriggers };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindTriggers);
    } else {
        bindTriggers();
    }
})();
