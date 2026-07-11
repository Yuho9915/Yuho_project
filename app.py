"""小组系统信息管理 - 后端服务

启动方式：
    pip install -r requirements.txt
    python app.py
然后访问 http://localhost:8000/
"""
import os
import sqlite3
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory, abort

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'data.db')
UPLOAD_DIR = os.path.join(BASE_DIR, 'uploads')
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024  # 单次请求 20MB 上限


# ============ 数据库 ============
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS systems (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            owner TEXT,
            url TEXT,
            category TEXT,
            desc TEXT,
            created_at INTEGER
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            system_id TEXT NOT NULL,
            name TEXT NOT NULL,
            size INTEGER,
            type TEXT,
            stored_name TEXT NOT NULL,
            added_at INTEGER,
            FOREIGN KEY(system_id) REFERENCES systems(id) ON DELETE CASCADE
        )
    ''')
    conn.commit()
    conn.close()


init_db()


# ============ 工具 ============
def gen_id():
    import uuid
    return uuid.uuid4().hex


def row_to_system(row, include_files=True):
    item = {
        'id': row['id'],
        'name': row['name'],
        'owner': row['owner'] or '',
        'url': row['url'] or '',
        'category': row['category'] or '',
        'desc': row['desc'] or '',
        'createdAt': row['created_at'],
    }
    if include_files:
        conn = get_db()
        files = conn.execute(
            'SELECT * FROM files WHERE system_id = ? ORDER BY added_at ASC',
            (row['id'],)
        ).fetchall()
        conn.close()
        item['files'] = [row_to_file(f) for f in files]
    return item


def row_to_file(row):
    return {
        'id': row['id'],
        'name': row['name'],
        'size': row['size'] or 0,
        'type': row['type'] or '',
        'addedAt': row['added_at'],
    }


# ============ API ============
@app.get('/api/systems')
def list_systems():
    keyword = (request.args.get('q') or '').strip().lower()
    conn = get_db()
    if keyword:
        like = '%' + keyword + '%'
        rows = conn.execute(
            '''SELECT * FROM systems
               WHERE LOWER(name) LIKE ? OR LOWER(IFNULL(owner,'')) LIKE ?
                  OR LOWER(IFNULL(desc,'')) LIKE ? OR LOWER(IFNULL(category,'')) LIKE ?
               ORDER BY created_at DESC''',
            (like, like, like, like)
        ).fetchall()
    else:
        rows = conn.execute(
            'SELECT * FROM systems ORDER BY created_at DESC'
        ).fetchall()
    conn.close()
    return jsonify([row_to_system(r) for r in rows])


@app.post('/api/systems')
def create_system():
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name 不能为空'}), 400
    sys_id = gen_id()
    now = int(datetime.now().timestamp() * 1000)
    conn = get_db()
    conn.execute(
        '''INSERT INTO systems (id, name, owner, url, category, desc, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)''',
        (sys_id, name,
         (data.get('owner') or '').strip(),
         (data.get('url') or '').strip(),
         data.get('category') or '业务系统',
         (data.get('desc') or '').strip(),
         now)
    )
    conn.commit()
    conn.close()
    return jsonify({'id': sys_id, 'createdAt': now}), 201


@app.put('/api/systems/<sys_id>')
def update_system(sys_id):
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name 不能为空'}), 400
    conn = get_db()
    row = conn.execute('SELECT id FROM systems WHERE id = ?', (sys_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': '系统不存在'}), 404
    conn.execute(
        '''UPDATE systems SET name=?, owner=?, url=?, category=?, desc=? WHERE id=?''',
        (name,
         (data.get('owner') or '').strip(),
         (data.get('url') or '').strip(),
         data.get('category') or '业务系统',
         (data.get('desc') or '').strip(),
         sys_id)
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.delete('/api/systems/<sys_id>')
def delete_system(sys_id):
    conn = get_db()
    rows = conn.execute('SELECT stored_name FROM files WHERE system_id = ?', (sys_id,)).fetchall()
    for r in rows:
        try:
            os.remove(os.path.join(UPLOAD_DIR, r['stored_name']))
        except OSError:
            pass
    conn.execute('DELETE FROM files WHERE system_id = ?', (sys_id,))
    conn.execute('DELETE FROM systems WHERE id = ?', (sys_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ============ 文件 ============
@app.post('/api/systems/<sys_id>/files')
def upload_files(sys_id):
    conn = get_db()
    row = conn.execute('SELECT id FROM systems WHERE id = ?', (sys_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': '系统不存在'}), 404

    uploaded = request.files.getlist('files')
    if not uploaded:
        conn.close()
        return jsonify({'error': '未接收到文件'}), 400

    results = []
    for f in uploaded:
        file_id = gen_id()
        stored_name = file_id + '_' + (f.filename or 'file')
        save_path = os.path.join(UPLOAD_DIR, stored_name)
        f.save(save_path)
        size = os.path.getsize(save_path)
        now = int(datetime.now().timestamp() * 1000)
        conn.execute(
            '''INSERT INTO files (id, system_id, name, size, type, stored_name, added_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)''',
            (file_id, sys_id, f.filename, size, f.mimetype, stored_name, now)
        )
        results.append({
            'id': file_id,
            'name': f.filename,
            'size': size,
            'type': f.mimetype,
            'addedAt': now
        })
    conn.commit()
    conn.close()
    return jsonify(results), 201


@app.delete('/api/files/<file_id>')
def delete_file(file_id):
    conn = get_db()
    row = conn.execute('SELECT stored_name FROM files WHERE id = ?', (file_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': '文件不存在'}), 404
    try:
        os.remove(os.path.join(UPLOAD_DIR, row['stored_name']))
    except OSError:
        pass
    conn.execute('DELETE FROM files WHERE id = ?', (file_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.get('/api/files/<file_id>')
def download_file(file_id):
    conn = get_db()
    row = conn.execute(
        'SELECT name, stored_name FROM files WHERE id = ?', (file_id,)
    ).fetchone()
    conn.close()
    if not row:
        abort(404)
    return send_from_directory(UPLOAD_DIR, row['stored_name'], as_attachment=True, download_name=row['name'])


# ============ 前端静态资源 ============
@app.get('/')
def index():
    return send_from_directory(BASE_DIR, 'index.html')


@app.get('/<path:filename>')
def static_files(filename):
    return send_from_directory(BASE_DIR, filename)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=True)
