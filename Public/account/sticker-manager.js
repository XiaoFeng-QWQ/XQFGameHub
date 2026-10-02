/**
 * XQFGameHub —— 个人资料页表情管理
 * ---------------------------------------------------------------
 * 复用 shared.js 的 token / HTML 转义能力，与服务端 sticker API
 * 直连（与 1v1 页 script.js 的管理器同一套协议；这里不依赖聊天 DOM）。
 */
(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }

    var grid = $('sticker-manager-grid');
    var statusEl = $('sticker-manager-status');
    var uploadBtn = $('btn-sticker-upload');
    var uploadInput = $('sticker-upload-input');
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.acc-sticker-tab'));

    var tab = 'mine';
    var store = { defaults: [], mine: [] };
    var loaded = false;

    function authHeaders() {
        return { 'Authorization': 'Bearer ' + getUserToken() };
    }

    function setStatus(text) {
        if (statusEl) statusEl.textContent = text || '';
    }

    function load() {
        if (!grid || !getUserToken()) return;
        setStatus('加载中...');
        fetch('/api/sticker/list', { headers: authHeaders() })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                store.defaults = [];
                store.mine = [];
                (res.stickers || []).forEach(function (s) {
                    var target = (s.id && s.id.indexOf('us_') === 0) ? store.mine : store.defaults;
                    target.push(s);
                });
                render();
                setStatus('');
            })
            .catch(function () { setStatus('加载失败，请稍后重试'); });
    }

    function render() {
        if (!grid) return;
        var list = tab === 'mine' ? store.mine : store.defaults;
        grid.innerHTML = '';

        if (!list.length) {
            var empty = document.createElement('div');
            empty.className = 'acc-sticker-empty';
            empty.textContent = tab === 'mine' ? '还没有自定义表情，点击「上传表情」添加' : '暂无默认表情';
            grid.appendChild(empty);
            return;
        }

        list.forEach(function (s) {
            var item = document.createElement('div');
            item.className = 'acc-sticker-item';

            var img = document.createElement('img');
            img.src = s.url || '';
            img.alt = s.name || '';
            img.loading = 'lazy';
            item.appendChild(img);

            if (tab === 'mine') {
                if (s.status && s.status !== 'approved') {
                    var badge = document.createElement('span');
                    badge.className = 'acc-sticker-badge ' + (s.status === 'pending' ? 'is-pending' : 'is-rejected');
                    badge.textContent = s.status === 'pending' ? '审核中' : '已拒绝';
                    item.appendChild(badge);
                }

                var del = document.createElement('button');
                del.type = 'button';
                del.className = 'acc-sticker-del';
                del.title = '删除';
                del.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>';
                del.addEventListener('click', function () {
                    if (!window.confirm('确认删除这个表情？')) return;
                    fetch('/api/sticker/delete', {
                        method: 'POST',
                        headers: authHeaders(),
                        body: JSON.stringify({ sticker_id: s.id })
                    })
                        .then(function (r) { return r.json(); })
                        .then(function (res) {
                            if (!res.error) load();
                            else setStatus(res.error || '删除失败');
                        })
                        .catch(function () { setStatus('删除失败，请稍后重试'); });
                });
                item.appendChild(del);
            } else if (tab === 'default') {
                var add = document.createElement('button');
                add.type = 'button';
                add.className = 'acc-sticker-add';
                add.title = '添加到我的表情';
                add.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>';
                add.addEventListener('click', function () {
                    addStickerToMine(s.id)
                        .then(function () { load(); })
                        .catch(function () { /* shared.js 已提示错误 */ });
                });
                item.appendChild(add);
            }
            grid.appendChild(item);
        });
    }

    function switchTab(next) {
        tab = next;
        tabs.forEach(function (t) {
            t.classList.toggle('is-active', t.getAttribute('data-tab') === next);
        });
        render();
    }

    function uploadQueue(files, tooBig) {
        var total = files.length;
        var failed = 0;
        var token = getUserToken();

        function finish() {
            var msg = failed > 0
                ? '完成：成功 ' + (total - failed) + ' 张，失败 ' + failed + ' 张'
                : '全部上传成功（' + total + ' 张）';
            if (tooBig > 0) msg += '，' + tooBig + ' 张超过 2MB 已跳过';
            setStatus(msg + '，等待管理员审核');
            load();
        }

        function one(index) {
            if (index >= total) { finish(); return; }
            var file = files[index];
            var reader = new FileReader();
            reader.onload = function () {
                var ext = (file.name.split('.').pop() || 'png').toLowerCase();
                setStatus('上传中 ' + (index + 1) + '/' + total + '...');
                fetch('/api/sticker/upload', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ image_data: reader.result, file_ext: ext })
                })
                    .then(function (r) { return r.json(); })
                    .then(function (res) {
                        if (res.error) {
                            if (/上限/.test(res.error)) {
                                setStatus(res.error + '（已上传 ' + index + ' 张，剩余未上传）');
                                load();
                                return;
                            }
                            failed += 1;
                        }
                        one(index + 1);
                    })
                    .catch(function () { failed += 1; one(index + 1); });
            };
            reader.readAsDataURL(file);
        }
        one(0);
    }

    function bind() {
        if (uploadBtn && uploadInput) {
            uploadBtn.addEventListener('click', function () { uploadInput.click(); });
            uploadInput.addEventListener('change', function () {
                var files = Array.prototype.slice.call(uploadInput.files || []);
                if (!files.length) return;
                var valid = files.filter(function (f) { return f.size <= 2 * 1024 * 1024; });
                var tooBig = files.length - valid.length;
                uploadInput.value = '';
                if (!valid.length) {
                    setStatus('所选图片均超过 2MB，已全部跳过');
                    return;
                }
                switchTab('mine');
                uploadQueue(valid, tooBig);
            });
        }

        tabs.forEach(function (t) {
            t.addEventListener('click', function () {
                switchTab(t.getAttribute('data-tab') || 'mine');
            });
        });

        // 账号页登录成功后 #account-main 才显示；监听其 display 变化，避免游客发起请求
        var main = $('account-main');
        var tryLoad = function () {
            if (loaded || !main || main.style.display === 'none' || !getUserToken()) return;
            loaded = true;
            load();
        };
        tryLoad();
        if (main && typeof MutationObserver === 'function') {
            var mo = new MutationObserver(tryLoad);
            mo.observe(main, { attributes: true, attributeFilter: ['style'] });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();