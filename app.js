(function () {
    'use strict';

    var API = '/api';
    var MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB（单文件，前端预检）

    // 内存中的系统数据
    var systems = [];
    // 当前编辑/新增时临时挂载的文件列表（{file: File, ...} 表示新增，{id, ...} 表示已有）
    var pendingFiles = [];

    // ===== 工具函数 =====
    function $(sel, root) { return (root || document).querySelector(sel); }
    function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    }

    function formatDate(ts) {
        var d = new Date(ts);
        var p = function (n) { return n < 10 ? '0' + n : n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
               ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function fileIcon(name) {
        var ext = (name.split('.').pop() || '').toLowerCase();
        var map = {
            pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗',
            ppt: '📙', pptx: '📙', zip: '🗜', rar: '🗜', '7z': '🗜',
            png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', bmp: '🖼',
            txt: '📄', md: '📄', json: '📄', csv: '📄'
        };
        return map[ext] || '📄';
    }

    function toast(msg, type) {
        var el = $('#toast');
        el.textContent = msg;
        el.className = 'toast show' + (type ? ' ' + type : '');
        el.hidden = false;
        clearTimeout(el._timer);
        el._timer = setTimeout(function () {
            el.classList.remove('show');
            setTimeout(function () { el.hidden = true; }, 300);
        }, 2200);
    }

    // ===== API 调用 =====
    function api(url, opts) {
        opts = opts || {};
        return fetch(API + url, opts).then(function (res) {
            if (!res.ok) {
                return res.json().catch(function () { return { error: '请求失败' }; })
                    .then(function (err) { throw new Error(err.error || '请求失败'); });
            }
            var ct = res.headers.get('content-type') || '';
            if (ct.indexOf('application/json') >= 0) return res.json();
            return res;
        });
    }

    function load() {
        return api('/systems').then(function (data) {
            systems = data || [];
            render();
        }).catch(function (e) {
            toast('加载数据失败：' + e.message, 'error');
        });
    }

    // ===== 渲染 =====
    function render() {
        var grid = $('#systemGrid');
        var empty = $('#emptyState');
        var keyword = ($('#searchInput').value || '').trim().toLowerCase();

        var filtered = systems.filter(function (s) {
            if (!keyword) return true;
            return (s.name + ' ' + (s.owner || '') + ' ' + (s.desc || '') + ' ' + (s.category || ''))
                .toLowerCase().indexOf(keyword) >= 0;
        });

        $('#systemCount').textContent = systems.length;
        $('#fileCount').textContent = systems.reduce(function (sum, s) {
            return sum + (s.files ? s.files.length : 0);
        }, 0);

        if (filtered.length === 0) {
            grid.innerHTML = '';
            empty.style.display = systems.length === 0 ? 'block' : 'none';
            if (systems.length > 0 && keyword) {
                grid.innerHTML = '<div class="empty-state"><div class="empty-icon">⌕</div>' +
                    '<h2>没有匹配的系统</h2><p>试试其他关键词。</p></div>';
            }
            return;
        }
        empty.style.display = 'none';

        grid.innerHTML = filtered.map(function (s) {
            var files = s.files || [];
            var fileChips = files.slice(0, 4).map(function (f) {
                return '<span class="file-chip" data-file-id="' + f.id + '" title="点击下载">' +
                    fileIcon(f.name) + ' <span class="name">' + escapeHtml(f.name) + '</span></span>';
            }).join('');
            var more = files.length > 4 ? '<span class="file-count-more">+' + (files.length - 4) + '</span>' : '';

            var linkHtml = '';
            if (s.url) {
                linkHtml = '<a class="card-link" href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener" title="' + escapeHtml(s.url) + '">' +
                    '<span>🔗 ' + escapeHtml(s.url) + '</span></a>';
            } else {
                linkHtml = '<span class="card-link" style="color:var(--text-muted)">暂无链接</span>';
            }

            return '<article class="system-card" data-id="' + s.id + '">' +
                '<div class="card-header">' +
                    (s.category ? '<span class="card-badge">' + escapeHtml(s.category) + '</span>' : '') +
                    '<div class="card-title">' + escapeHtml(s.name) + '</div>' +
                    (s.owner ? '<div class="card-owner">👤 ' + escapeHtml(s.owner) + '</div>' : '') +
                    '<div class="card-actions card-menu-btn">' +
                        '<button class="icon-btn" data-act="edit" title="编辑">✎</button>' +
                        '<button class="icon-btn danger" data-act="del" title="删除">🗑</button>' +
                    '</div>' +
                '</div>' +
                (s.desc ? '<div class="card-desc">' + escapeHtml(s.desc) + '</div>' : '') +
                (files.length ? '<div class="card-files">' + fileChips + more + '</div>' : '') +
                '<div class="card-footer">' +
                    linkHtml +
                    '<button class="icon-btn" data-act="detail" title="详情">⋯</button>' +
                '</div>' +
            '</article>';
        }).join('');
    }

    // ===== 弹窗 =====
    function closeModal(id) {
        var modal = $('#' + id);
        modal.hidden = true;
    }

    function openSystemModal(system) {
        pendingFiles = [];
        var form = $('#systemForm');
        form.reset();

        if (system) {
            $('#modalTitle').textContent = '编辑系统';
            form.dataset.editId = system.id;
            $('#sysName').value = system.name || '';
            $('#sysOwner').value = system.owner || '';
            $('#sysUrl').value = system.url || '';
            $('#sysCategory').value = system.category || '业务系统';
            $('#sysDesc').value = system.desc || '';
            // 已有文件作为待保留项
            pendingFiles = (system.files || []).map(function (f) {
                return { id: f.id, name: f.name, size: f.size, type: f.type, addedAt: f.addedAt, existing: true };
            });
        } else {
            $('#modalTitle').textContent = '添加系统';
            delete form.dataset.editId;
        }
        renderPendingFiles();
        $('#systemModal').hidden = false;
        setTimeout(function () { $('#sysName').focus(); }, 50);
    }

    function renderPendingFiles() {
        var ul = $('#fileList');
        if (pendingFiles.length === 0) { ul.innerHTML = ''; return; }
        ul.innerHTML = pendingFiles.map(function (f, i) {
            var tag = f.existing ? '<span class="f-tag">已存</span>' : '<span class="f-tag" style="color:var(--success)">新增</span>';
            return '<li>' +
                '<span>' + fileIcon(f.name) + '</span>' +
                '<span class="f-name">' + escapeHtml(f.name) + '</span>' +
                tag +
                '<span class="f-size">' + formatSize(f.size) + '</span>' +
                '<button type="button" class="f-remove" data-rm="' + i + '" title="移除">✕</button>' +
            '</li>';
        }).join('');
    }

    // ===== 详情弹窗 =====
    function openDetail(system) {
        $('#detailTitle').textContent = system.name;
        var body = $('#detailBody');
        var files = system.files || [];

        var html = '';
        if (system.category) {
            html += '<div class="detail-section"><h4>分类</h4><span class="card-badge">' + escapeHtml(system.category) + '</span></div>';
        }
        if (system.owner) {
            html += '<div class="detail-section"><h4>负责人</h4>' + escapeHtml(system.owner) + '</div>';
        }
        if (system.url) {
            html += '<div class="detail-section"><h4>页面链接</h4>' +
                '<a class="detail-link" href="' + escapeHtml(system.url) + '" target="_blank" rel="noopener">🔗 ' + escapeHtml(system.url) + '</a></div>';
        }
        if (system.desc) {
            html += '<div class="detail-section"><h4>系统描述</h4><div style="white-space:pre-wrap">' + escapeHtml(system.desc) + '</div></div>';
        }
        html += '<div class="detail-section"><h4>相关文件（' + files.length + '）</h4>';
        if (files.length === 0) {
            html += '<p style="color:var(--text-muted)">暂无文件</p>';
        } else {
            html += '<ul class="detail-file-list">';
            files.forEach(function (f) {
                html += '<li>' +
                    '<span class="f-icon">' + fileIcon(f.name) + '</span>' +
                    '<div class="f-info">' +
                        '<div class="name">' + escapeHtml(f.name) + '</div>' +
                        '<div class="meta">' + formatSize(f.size) + ' · ' + formatDate(f.addedAt) + '</div>' +
                    '</div>' +
                    '<button class="btn btn-sm btn-ghost" data-dl="' + f.id + '">下载</button>' +
                '</li>';
            });
            html += '</ul>';
        }
        html += '</div>';

        body.innerHTML = html;
        $('#detailModal').hidden = false;
    }

    function downloadFile(fileId) {
        window.open(API + '/files/' + fileId, '_blank');
    }

    // ===== 事件绑定 =====
    function bindEvents() {
        $('#addSystemBtn').addEventListener('click', function () { openSystemModal(null); });

        $('#searchInput').addEventListener('input', render);

        // 弹窗关闭
        $all('[data-close]').forEach(function (el) {
            el.addEventListener('click', function () {
                var modal = el.closest('.modal');
                if (modal) modal.hidden = true;
            });
        });

        // 表单提交
        $('#systemForm').addEventListener('submit', function (e) {
            e.preventDefault();
            var form = this;
            var editId = form.dataset.editId;
            var payload = {
                name: $('#sysName').value.trim(),
                owner: $('#sysOwner').value.trim(),
                url: $('#sysUrl').value.trim(),
                category: $('#sysCategory').value,
                desc: $('#sysDesc').value.trim()
            };

            if (!payload.name) { toast('请填写系统名称', 'error'); return; }

            var newFiles = pendingFiles.filter(function (f) { return f.file; });
            var removedExistingIds;
            var submitBtn = form.querySelector('button[type=submit]');
            submitBtn.disabled = true;
            submitBtn.textContent = '保存中…';

            var p;
            if (editId) {
                p = api('/systems/' + editId, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }).then(function () {
                    // 删除被移除的已有文件
                    removedExistingIds = (systems.filter(function (s) { return s.id === editId; })[0].files || [])
                        .map(function (f) { return f.id; })
                        .filter(function (id) {
                            return !pendingFiles.some(function (pf) { return pf.existing && pf.id === id; });
                        });
                    return Promise.all(removedExistingIds.map(function (id) {
                        return api('/files/' + id, { method: 'DELETE' });
                    }));
                }).then(function () {
                    return uploadNewFiles(editId, newFiles);
                }).then(function () { return editId; });
            } else {
                p = api('/systems', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }).then(function (res) {
                    return uploadNewFiles(res.id, newFiles).then(function () { return res.id; });
                });
            }

            p.then(function () {
                return load();
            }).then(function () {
                closeModal('systemModal');
                toast(editId ? '已更新' : '已添加', 'success');
            }).catch(function (e) {
                toast('保存失败：' + e.message, 'error');
            }).finally(function () {
                submitBtn.disabled = false;
                submitBtn.textContent = '保存';
            });
        });

        // 文件选择
        var fileInput = $('#fileInput');
        var dropZone = $('#fileDropZone');
        fileInput.addEventListener('change', function (e) {
            addFiles(e.target.files);
            e.target.value = '';
        });

        // 拖拽上传
        ['dragenter', 'dragover'].forEach(function (evt) {
            dropZone.addEventListener(evt, function (e) {
                e.preventDefault();
                dropZone.classList.add('dragover');
            });
        });
        ['dragleave', 'drop'].forEach(function (evt) {
            dropZone.addEventListener(evt, function (e) {
                e.preventDefault();
                dropZone.classList.remove('dragover');
            });
        });
        dropZone.addEventListener('drop', function (e) {
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        });

        // 移除待上传文件
        $('#fileList').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-rm]');
            if (!btn) return;
            pendingFiles.splice(parseInt(btn.getAttribute('data-rm'), 10), 1);
            renderPendingFiles();
        });

        // 卡片操作
        $('#systemGrid').addEventListener('click', function (e) {
            var card = e.target.closest('.system-card');
            if (!card) return;
            var id = card.getAttribute('data-id');
            var sys = systems.filter(function (s) { return s.id === id; })[0];
            if (!sys) return;

            var actBtn = e.target.closest('[data-act]');
            if (actBtn) {
                var act = actBtn.getAttribute('data-act');
                if (act === 'edit') openSystemModal(sys);
                else if (act === 'del') {
                    if (confirm('确定删除「' + sys.name + '」？此操作不可撤销。')) {
                        api('/systems/' + id, { method: 'DELETE' }).then(function () {
                            return load();
                        }).then(function () {
                            toast('已删除', 'success');
                        }).catch(function (e) {
                            toast('删除失败：' + e.message, 'error');
                        });
                    }
                } else if (act === 'detail') {
                    openDetail(sys);
                }
                return;
            }

            var chip = e.target.closest('.file-chip');
            if (chip) {
                downloadFile(chip.getAttribute('data-file-id'));
            }
        });

        // 详情下载
        $('#detailBody').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-dl]');
            if (!btn) return;
            downloadFile(btn.getAttribute('data-dl'));
        });

        // ESC 关闭弹窗
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                $all('.modal').forEach(function (m) { if (!m.hidden) m.hidden = true; });
            }
        });
    }

    function addFiles(fileList) {
        var files = Array.prototype.slice.call(fileList);
        files.forEach(function (f) {
            if (f.size > MAX_FILE_SIZE) {
                toast('文件「' + f.name + '」超过 10MB，已跳过', 'error');
                return;
            }
            pendingFiles.push({
                file: f,
                name: f.name,
                size: f.size,
                type: f.type
            });
        });
        renderPendingFiles();
    }

    function uploadNewFiles(sysId, newFiles) {
        if (!newFiles.length) return Promise.resolve();
        var fd = new FormData();
        newFiles.forEach(function (pf) { fd.append('files', pf.file, pf.name); });
        return api('/systems/' + sysId + '/files', { method: 'POST', body: fd });
    }

    // ===== 初始化 =====
    document.addEventListener('DOMContentLoaded', function () {
        bindEvents();
        load();
    });
})();
