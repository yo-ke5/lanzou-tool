const CACHE_TTL = 1200;
const DB_NAME = 'drive-tool';
const AES_KEY = 'lanZouY-disk-app';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36';
const ILENZOU_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const DOUPLOAD_URL = 'https://pc.woozooo.com/doupload.php';
const UPLOAD_URL = 'https://pc.woozooo.com/html5up.php';
const LOGIN_URL = 'https://up.woozooo.com/mlogin.php';
const VALID_SUFFIX = ['ppt','xapk','ke','azw','cpk','gho','dwg','db','docx','deb','e','ttf','xls','bat','crx','rpm','txf','pdf','apk','ipa','txt','mobi','osk','dmg','rp','osz','jar','ttc','z','w3x','xlsx','cetrainer','ct','rar','mp3','pptx','mobileconfig','epub','imazingapp','doc','iso','img','appimage','7z','rplib','lolgezi','exe','azw3','zip','conf','tar','dll','flac','xpa','lua','cad','hwt','accdb','ce','xmind','enc','bds','bdi','ssf','it','gz'];

async function dbInit(db) {
    try {
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS parse_cache (
                cache_key TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                pwd TEXT DEFAULT '',
                result TEXT NOT NULL,
                expires_at INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s','now'))
            )
        `).run();
    } catch (e) {
        console.log('[DB] 创建parse_cache表失败:', e.message);
    }
    try {
        await db.prepare(`CREATE INDEX IF NOT EXISTS idx_cache_expires ON parse_cache(expires_at)`).run();
    } catch (e) {}
    try {
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS parse_stats (
                id INTEGER PRIMARY KEY DEFAULT 1,
                total INTEGER DEFAULT 0,
                success INTEGER DEFAULT 0,
                failed INTEGER DEFAULT 0,
                cached INTEGER DEFAULT 0
            )
        `).run();
    } catch (e) {
        console.log('[DB] 创建parse_stats表失败:', e.message);
    }
    try {
        await db.prepare(`INSERT OR IGNORE INTO parse_stats (id, total, success, failed, cached) VALUES (1, 0, 0, 0, 0)`).run();
    } catch (e) {}
    try {
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS parse_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT NOT NULL,
                pwd TEXT DEFAULT '',
                type TEXT DEFAULT '',
                success INTEGER DEFAULT 0,
                file_name TEXT DEFAULT '',
                file_size TEXT DEFAULT '',
                download_url TEXT DEFAULT '',
                from_cache INTEGER DEFAULT 0,
                msg TEXT DEFAULT '',
                created_at INTEGER DEFAULT (strftime('%s','now'))
            )
        `).run();
    } catch (e) {
        console.log('[DB] 创建parse_records表失败:', e.message);
    }
}

async function cacheGet(db, url, pwd) {
    try {
        const key = generateCacheKey(url, pwd);
        const now = Math.floor(Date.now() / 1000);
        const row = await db.prepare('SELECT result, expires_at FROM parse_cache WHERE cache_key = ?').bind(key).first();
        if (!row) return null;
        if (row.expires_at > 0 && row.expires_at < now) {
            await db.prepare('DELETE FROM parse_cache WHERE cache_key = ?').bind(key).run();
            return null;
        }
        const result = JSON.parse(row.result);
        result._expires_at = row.expires_at;
        return result;
    } catch (e) {
        console.log('[DB] 缓存读取失败:', e.message);
        return null;
    }
}

async function cacheSet(db, url, pwd, result) {
    try {
        const key = generateCacheKey(url, pwd);
        const expiresAt = Math.floor(Date.now() / 1000) + CACHE_TTL;
        const toCache = { ...result };
        delete toCache.expires_in;
        delete toCache._expires_at;
        const resultStr = JSON.stringify(toCache);
        await db.prepare('INSERT OR REPLACE INTO parse_cache (cache_key, url, pwd, result, expires_at) VALUES (?, ?, ?, ?, ?)')
            .bind(key, url, pwd || '', resultStr, expiresAt).run();
    } catch (e) {
        console.log('[DB] 缓存写入失败:', e.message);
    }
}

async function cacheCleanup(db) {
    try {
        const now = Math.floor(Date.now() / 1000);
        await db.prepare('DELETE FROM parse_cache WHERE expires_at > 0 AND expires_at < ?').bind(now).run();
    } catch (e) {}
}

function generateCacheKey(url, pwd) {
    const combined = `${url}|||${pwd || ''}`;
    return 'parse_' + btoa(unescape(encodeURIComponent(combined)));
}

async function statsGet(db) {
    try {
        const row = await db.prepare('SELECT total, success, failed, cached FROM parse_stats WHERE id = 1').first();
        return row || { total: 0, success: 0, failed: 0, cached: 0 };
    } catch (e) {
        return { total: 0, success: 0, failed: 0, cached: 0 };
    }
}

async function statsUpdate(db, field) {
    try {
        await db.prepare(`UPDATE parse_stats SET ${field} = ${field} + 1, total = total + 1 WHERE id = 1`).run();
    } catch (e) {
        console.log('[DB] 统计更新失败:', e.message);
    }
}

async function recordAdd(db, url, pwd, type, success, fileName, downloadUrl, fileSize, fromCache, msg) {
    try {
        await db.prepare('INSERT INTO parse_records (url, pwd, type, success, file_name, file_size, download_url, from_cache, msg) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(url, pwd || '', type, success ? 1 : 0, fileName || '', fileSize || '', downloadUrl || '', fromCache ? 1 : 0, msg || '').run();
    } catch (e) {}
}

async function recordsGet(db) {
    try {
        const result = await db.prepare('SELECT * FROM parse_records ORDER BY created_at DESC').all();
        return result.results || [];
    } catch (e) {
        return [];
    }
}

function aes128EcbEncrypt(key, plaintext) {
    const keyBytes = new TextEncoder().encode(key);
    const keyData = new Uint8Array(16);
    keyData.set(keyBytes.slice(0, 16));
    for (let i = keyBytes.length; i < 16; i++) keyData[i] = 0;

    const data = new TextEncoder().encode(plaintext);
    const padLen = 16 - (data.length % 16);
    const padded = new Uint8Array(data.length + padLen);
    padded.set(data);
    for (let i = data.length; i < padded.length; i++) padded[i] = padLen;

    const sBox = [
        0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
        0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
        0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
        0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
        0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
        0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
        0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
        0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
        0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
        0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
        0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
        0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
        0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
        0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
        0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
        0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
    ];

    const rCon = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];

    function subBytes(s) { for (let i = 0; i < 16; i++) s[i] = sBox[s[i]]; }
    function shiftRows(s) {
        const t = [...s];
        s[1]=t[5]; s[5]=t[9]; s[9]=t[13]; s[13]=t[1];
        s[2]=t[10]; s[6]=t[14]; s[10]=t[2]; s[14]=t[6];
        s[3]=t[15]; s[7]=t[3]; s[11]=t[7]; s[15]=t[11];
    }
    function gmul(a, b) {
        let p = 0;
        for (let i = 0; i < 8; i++) { if (b & 1) p ^= a; const hi = a & 0x80; a <<= 1; if (hi) a ^= 0x1b; b >>= 1; }
        return p & 0xff;
    }
    function mixColumns(s) {
        for (let i = 0; i < 4; i++) {
            const a=s[i*4],b=s[i*4+1],c=s[i*4+2],d=s[i*4+3];
            s[i*4]=gmul(2,a)^gmul(3,b)^c^d; s[i*4+1]=a^gmul(2,b)^gmul(3,c)^d;
            s[i*4+2]=a^b^gmul(2,c)^gmul(3,d); s[i*4+3]=gmul(3,a)^b^c^gmul(2,d);
        }
    }
    function addRoundKey(s, rk) { for (let i = 0; i < 16; i++) s[i] ^= rk[i]; }

    const expanded = new Uint8Array(176);
    expanded.set(keyData);
    let gen = 16, rconI = 1;
    const tmp = new Uint8Array(4);
    while (gen < 176) {
        for (let i = 0; i < 4; i++) tmp[i] = expanded[gen - 4 + i];
        if (gen % 16 === 0) {
            const t = tmp[0]; tmp[0]=tmp[1]; tmp[1]=tmp[2]; tmp[2]=tmp[3]; tmp[3]=t;
            for (let i = 0; i < 4; i++) tmp[i] = sBox[tmp[i]];
            tmp[0] ^= rCon[rconI - 1]; rconI++;
        }
        for (let i = 0; i < 4; i++) { expanded[gen] = expanded[gen - 16] ^ tmp[i]; gen++; }
    }

    let hex = '';
    for (let off = 0; off < padded.length; off += 16) {
        const state = new Uint8Array(padded.slice(off, off + 16));
        addRoundKey(state, expanded.slice(0, 16));
        for (let r = 1; r < 10; r++) { subBytes(state); shiftRows(state); mixColumns(state); addRoundKey(state, expanded.slice(r*16,(r+1)*16)); }
        subBytes(state); shiftRows(state); addRoundKey(state, expanded.slice(160, 176));
        for (let j = 0; j < 16; j++) hex += state[j].toString(16).padStart(2, '0');
    }
    return hex.toLowerCase();
}

function generateUUID() {
    const c = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
    let r = '';
    for (let i = 0; i < 21; i++) r += c[Math.floor(Math.random() * 64)];
    return r;
}

function decodeHtmlEntities(text) {
    if (!text) return text;
    const e = {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#039;':"'",'&apos;':"'",'&#39;':"'",};
    return text.replace(/&amp;|&lt;|&gt;|&quot;|&#039;|&apos;|&#39;/g, m => e[m] || m);
}

function nameFormat(name) { return name.replace(/\xa0/g,' ').replace(/\u3000/g,' ').replace(/  /g,' ').replace(/[$%^!*<>)(+=\`'"\/:;,?]/g,''); }
function isNameValid(filename) { const ext = filename.split('.').pop().toLowerCase(); return VALID_SUFFIX.includes(ext); }
function buildCookieStr(phpsessid, ylogin, phpdiskInfo) { return `PHPSESSID=${phpsessid}; ylogin=${ylogin}; phpdisk_info=${phpdiskInfo}`; }
function lanzouHeaders(cookie, referer = 'https://pc.woozooo.com/mydisk.php') {
    return { 'User-Agent': DESKTOP_UA, 'Referer': referer, 'Accept-Encoding': 'gzip, deflate, br', 'Accept': '*/*', 'Origin': 'https://pc.woozooo.com', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Cookie': cookie };
}

async function login(username, password) {
    const resp = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: { 'User-Agent': DESKTOP_UA, 'Referer': LOGIN_URL, 'Accept': '*/*', 'Origin': 'https://up.woozooo.com', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ task:'3', uid:username, pwd:password, setSessionId:'', setSig:'', setScene:'', setTocen:'', formhash:'' }).toString(),
        redirect: 'manual'
    });
    const body = await resp.text();
    const cookies = {};
    const scHeaders = resp.headers.get('set-cookie') || '';
    for (const m of scHeaders.matchAll(/([^=,\s]+)=([^;,\s]+)/g)) { if (m[1] && m[2]) cookies[m[1].trim()] = m[2].trim(); }
    let bodyData;
    try { bodyData = JSON.parse(body); } catch (e) { return { success: false, msg: '登录响应解析失败' }; }
    if (!bodyData || bodyData.zt !== 1) return { success: false, msg: '登录失败，请检查账号密码是否正确' };
    if (!cookies.ylogin) cookies.ylogin = String(bodyData.id || '');
    if (!cookies.PHPSESSID) cookies.PHPSESSID = '';
    return { success: true, msg: '登录成功', cookies: { PHPSESSID: cookies.PHPSESSID || '', ylogin: cookies.ylogin || '', phpdisk_info: cookies.phpdisk_info || '' } };
}

async function getDirList(phpsessid, ylogin, phpdiskInfo, folderId = -1) {
    const cookie = buildCookieStr(phpsessid, ylogin, phpdiskInfo);
    const resp = await fetch(`${DOUPLOAD_URL}?uid=${ylogin}`, {
        method: 'POST',
        headers: { ...lanzouHeaders(cookie), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ task:'47', folder_id:String(folderId), vei:'VFBQUg1fUghQBA9fUghQBA9fAFo=' }).toString()
    });
    const data = await resp.json();
    if (!data) return null;
    if (data.info === 0 || data.info === false || data.zs === 0) return null;
    if (data.info === undefined && data.text === undefined) return null;
    if (!data.text || !Array.isArray(data.text)) return [];
    return data.text.map(f => ({ id: f.fol_id, name: f.name, has_pwd: f.onof == 1, desc: (f.folder_des || '').replace(/^\[|\]$/g, '').trim() }));
}

async function getFileList(phpsessid, ylogin, phpdiskInfo, folderId = -1) {
    const cookie = buildCookieStr(phpsessid, ylogin, phpdiskInfo);
    let page = 1, fileList = [];
    while (true) {
        const resp = await fetch(DOUPLOAD_URL, {
            method: 'POST',
            headers: { ...lanzouHeaders(cookie), 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ task:'5', folder_id:String(folderId), pg:String(page), vei:'VFBQUg1fUghQBA9fAFo=' }).toString()
        });
        const data = await resp.json();
        if (!data || data.info === 0) break;
        if (data.text && Array.isArray(data.text)) {
            for (const f of data.text) {
                fileList.push({ id: f.id, name: (f.name_all || '').replace(/&amp;/g, '&'), time: f.time || '', size: (f.size || '').replace(/,/g, ''), type: (f.name_all || '').split('.').pop(), downs: f.downs || '0', has_pwd: f.onof == 1, has_des: f.is_des == 1 });
            }
        }
        page++;
        if (page > 50) break;
    }
    return fileList;
}

async function getShareInfo(phpsessid, ylogin, phpdiskInfo, fid, isFile = true) {
    const cookie = buildCookieStr(phpsessid, ylogin, phpdiskInfo);
    const postData = isFile ? { task:22, file_id:fid } : { task:18, folder_id:fid };
    const resp = await fetch(DOUPLOAD_URL, {
        method: 'POST',
        headers: { ...lanzouHeaders(cookie), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(postData).toString()
    });
    const fInfo = await resp.json();
    if (!fInfo || !fInfo.info) return { success: false, request_msg: '解析失败' };
    const info = fInfo.info;
    if ((info.f_id && info.f_id === 'i') || (info.name !== undefined && !info.name)) return { success: false, request_msg: 'fid错误' };
    const pwd = (info.onof == 1) ? (info.pwd || '') : '';
    let url, name, desc;
    if (info.f_id) {
        url = info.is_newd + '/' + info.f_id;
        const resp2 = await fetch(DOUPLOAD_URL, {
            method: 'POST',
            headers: { ...lanzouHeaders(cookie), 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ task:12, file_id:fid }).toString()
        });
        const fileData = await resp2.json();
        name = fileData.text || '';
        desc = fileData.info || '';
    } else {
        url = info.new_url || '';
        name = info.name || '';
        desc = info.des || '';
    }
    return { success: true, request_msg: '请求成功', name, url, desc, pwd };
}

async function uploadFile(phpsessid, ylogin, phpdiskInfo, file, folderId = -1) {
    const cookie = buildCookieStr(phpsessid, ylogin, phpdiskInfo);
    const originalName = file.name;
    if (!isNameValid(originalName)) return { success: false, msg: '文件后缀不允许上传，仅支持：' + VALID_SUFFIX.join(', ') };
    const filename = nameFormat(originalName);
    const formData = new FormData();
    formData.append('task', '1');
    formData.append('vie', '2');
    formData.append('ve', '2');
    formData.append('id', 'WU_FILE_0');
    formData.append('name', filename);
    formData.append('type', file.type || 'application/octet-stream');
    formData.append('lastModifiedDate', new Date().toUTCString());
    formData.append('folder_id_bb_n', String(folderId));
    formData.append('upload_file', file, filename);
    const resp = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: lanzouHeaders(cookie, 'https://pc.woozooo.com/mydisk.php'),
        body: formData
    });
    const result = await resp.json();
    if (!result || result.zt !== 1) return { success: false, msg: result?.info || '上传失败' };
    const uploadedFiles = (result.text || []).map(f => ({ id: f.id || '', name: f.name || '', time: f.time || '', size: f.size || '', type: f.icon || '', downs: f.downs || '0' }));
    return { success: true, msg: '上传成功', files: uploadedFiles };
}

async function uploadFileAndShare(phpsessid, ylogin, phpdiskInfo, file, folderId = -1) {
    const uploadResult = await uploadFile(phpsessid, ylogin, phpdiskInfo, file, folderId);
    if (!uploadResult.success) return uploadResult;
    const shareResults = [];
    for (const f of uploadResult.files) {
        const shareInfo = await getShareInfo(phpsessid, ylogin, phpdiskInfo, f.id, true);
        shareResults.push({ file_id: f.id, file_name: f.name, share_url: shareInfo.url || '', share_pwd: shareInfo.pwd || '', share_name: shareInfo.name || '' });
    }
    uploadResult.share_info = shareResults;
    return uploadResult;
}

async function deleteFileOrFolder(phpsessid, ylogin, phpdiskInfo, fid, isFile = true) {
    const cookie = buildCookieStr(phpsessid, ylogin, phpdiskInfo);
    const postData = isFile ? { task:6, file_id:fid } : { task:3, folder_id:fid };
    const resp = await fetch(DOUPLOAD_URL, {
        method: 'POST',
        headers: { ...lanzouHeaders(cookie), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(postData).toString()
    });
    const data = await resp.json();
    return data && data.zt === 1;
}

async function parseIlanzou(url, pwd) {
    url = url.trim();
    let shareId;
    const m = url.match(/ilanzou\.com\/s\/([a-zA-Z0-9]+)/);
    if (m) { shareId = m[1]; }
    else {
        const parts = url.replace(/\/+$/, '').split('/');
        let last = parts[parts.length - 1] || '';
        const qi = last.indexOf('?');
        if (qi !== -1) last = last.substring(0, qi);
        shareId = last;
    }
    if (!shareId) return { success: false, msg: '无效的分享链接' };

    const uuid = generateUUID();
    const ts = Date.now();
    const encTs = aes128EcbEncrypt(AES_KEY, String(ts));

    const params = new URLSearchParams({ devType:'6', devModel:'Chrome', uuid, extra:'2', timestamp:encTs, shareId, type:'0', offset:'1', limit:'60' });
    if (pwd) params.append('code', pwd);

    const resp = await fetch(`https://api.ilanzou.com/unproved/recommend/list?${params.toString()}`, {
        headers: { 'Accept':'application/json, text/plain, */*', 'Referer':'https://www.ilanzou.com/', 'User-Agent': ILENZOU_UA }
    });
    const data = await resp.json();

    if (data.msg && data.msg !== '成功') {
        if (data.msg.includes('密码') || data.msg.includes('提取码'))
            return { success: false, msg: pwd ? '密码错误' : '请输入密码', need_password: true };
        return { success: false, msg: data.msg };
    }
    if (!data.list || !data.list.length) return { success: false, msg: '未找到文件信息' };

    let item = data.list[0];
    if (item.fileList && Array.isArray(item.fileList) && item.fileList.length > 0)
        item = Object.assign({}, item, item.fileList[0]);

    const fileId = item.fileIds || item.fileId || item.id || '';
    const fileName = item.fileName || item.name || '';
    const fileSize = item.fileSize || item.size || '';
    if (!fileId) return { success: false, msg: '文件信息获取失败' };
    if (!fileName && !fileSize && !pwd) return { success: false, msg: '请输入密码', need_password: true };

    const downloadUrl = await getIlanzouDownloadUrl(fileId, uuid);
    if (!downloadUrl) return { success: false, msg: '获取下载链接失败' };

    return { success: true, msg: '解析成功', type: 'ilanzou', file_id: fileId, file_name: fileName, file_size: fileSize, download_url: downloadUrl };
}

async function getIlanzouDownloadUrl(fileIds, uuid) {
    const ts = Date.now();
    const encTs = aes128EcbEncrypt(AES_KEY, String(ts));
    const auth = aes128EcbEncrypt(AES_KEY, `${fileIds}|${ts}`);
    const downloadId = aes128EcbEncrypt(AES_KEY, `${fileIds}|`);

    const params = new URLSearchParams({ downloadId, enable:'1', devType:'6', uuid, timestamp:encTs, auth });
    const resp = await fetch(`https://api.ilanzou.com/unproved/file/redirect?${params.toString()}`, {
        redirect: 'manual',
        headers: { 'Referer':'https://www.ilanzou.com/', 'User-Agent': ILENZOU_UA }
    });

    if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get('Location');
        if (loc) return loc;
    }
    const text = await resp.text();
    const m = text.match(/https?:\/\/[^\s"'<>]+/i);
    return m ? m[0] : '';
}

async function parseLanzou(url, pwd) {
    url = url.trim();
    const idMatch = url.match(/(?:lanzou[a-z]{0,2}\.com)\/(?:tp\/)?([a-zA-Z0-9_\-]+)(\?[\s\S]*)?/i);
    if (!idMatch) return { success: false, msg: '无效的分享链接' };
    const shareId = idMatch[1];
    const queryStr = idMatch[2] || '';

    const domains = ['www.lanzoui.com','www.lanzouo.com','www.lanzoux.com','www.lanzouw.com'];
    let html = null, usedDomain = null;

    for (const domain of domains) {
        try {
            const resp = await fetch(`https://${domain}/${shareId}${queryStr}`, {
                headers: { 'User-Agent': DESKTOP_UA, 'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language':'zh-CN;q=0.9' },
                redirect: 'follow'
            });
            const text = await resp.text();
            if (resp.ok && text.length > 500) { html = text; usedDomain = domain; break; }
        } catch (e) { continue; }
    }
    if (!html) return { success: false, msg: '无法访问分享页面' };

    if (/来晚[啦了]|文件取消分享|文件不存在|页面不存在|已被删除|sharedeleted/i.test(html))
        return { success: false, msg: '文件不存在或取消分享了' };

    html = html.replace(/<!--[\s\S]*?-->/g, '');

    const jsMatches = [];
    const jsRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let jm;
    while ((jm = jsRe.exec(html)) !== null) jsMatches.push(jm[1]);
    let js = jsMatches.join('\n').trim();

    if (js.includes('/filemoreajax.php'))
        return await parseLanzouFolder(html, js, shareId, pwd, usedDomain);

    const info = {};

    const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"]*?)["']/i);
    if (descMatch) {
        const fi = descMatch[1];
        const sm = fi.match(/(?:文件)?大小：([^|]+?)(?:\||$)/u);
        if (sm) info.size = sm[1].trim();
    }

    const nm = html.match(/<div class="n_box_3fn"[^>]*>([^<]+)<\/div>/) ||
               html.match(/<div style="font[^>]*>([^<]+)<\/div>/) ||
               html.match(/class="b">.*?<span>([^<]+)</);
    if (nm) info.name = decodeHtmlEntities(nm[1]);

    if (!info.size) {
        const sm = html.match(/<div class="n_filesize">大小：(.+?)<\/div>/) ||
                   html.match(/文件大小：<\/span>([^<]+)</);
        if (sm) info.size = sm[1];
    }

    const um = html.match(/<span class="user-name">([^<]+)<\/span>/) ||
               html.match(/<font[^>]*>([^<]+)<\/font>/);
    if (um) info.user = um[1];

    const tm = html.match(/<span class="n_file_infos">([^<]+)<\/span>\s*<span class="n_file_infos">/) ||
               html.match(/<span class="p7">上传时间：<\/span>([^<]+)<br>/);
    if (tm) info.time = tm[1];

    const iframeMatch = html.match(/<iframe[^>]*src="(.+?)"/);
    if (iframeMatch) {
        try {
            const iframeResp = await fetch(`https://${usedDomain}${iframeMatch[1]}`, {
                headers: { 'User-Agent': DESKTOP_UA, 'Referer': `https://${usedDomain}/` }, redirect: 'follow'
            });
            const iframeHtml = await iframeResp.text();
            if (iframeHtml) {
                const jsUrlMatch = iframeHtml.match(/https?:\/\/waf\.woozooo\.com\/pc\/.+?\.js/);
                if (jsUrlMatch) {
                    const jsResp = await fetch(jsUrlMatch[0], { headers: { 'User-Agent': DESKTOP_UA } });
                    const jsContent = await jsResp.text();
                    if (jsContent) js = jsContent;
                } else { js = iframeHtml; }
            }
        } catch (e) {}
    }

    if (!js) return { success: false, msg: '获取失败' };

    const cleaned = js.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');

    const fidMatch = cleaned.match(/file=(\d+)/) || js.match(/file=(\d+)/);
    const fileid = fidMatch ? parseInt(fidMatch[1]) : null;
    info.fid = fileid;

    if (cleaned.includes("document.getElementById('pwd').value;") && !pwd)
        return { success: false, msg: '请输入密码', need_password: true };

    let sign = null;
    let sm2 = cleaned.match(/'sign':'(\w+)'/);
    if (sm2) sign = sm2[1];
    if (!sign) {
        const svm = cleaned.match(/'sign':(\w+),/);
        if (svm) {
            const vn = svm[1];
            const vm = [...cleaned.matchAll(new RegExp(`${vn}\\s*=\\s*'(.*?)'`, 'g'))];
            const vals = vm.map(x => x[1]).filter(Boolean);
            if (vals.length) sign = vals.reduce((a, b) => a.length < b.length ? a : b);
        }
    }
    if (!sign) {
        const cm = [...cleaned.matchAll(/'(\w+?_c)'/g)].map(x => x[1]);
        if (cm.length) sign = cm.reduce((a, b) => a.length < b.length ? a : b);
    }
    if (!sign) {
        const lm = [...cleaned.matchAll(/'([\w]{50,})'/g)].map(x => x[1]);
        if (lm.length) sign = lm.reduce((a, b) => a.length > b.length ? a : b);
    }
    if (!sign) return { success: false, msg: '获取失败，无法解析sign' };

    const wsm = cleaned.match(/'([0-9])'/);
    const websign = wsm ? wsm[1] : '';
    const wskm = cleaned.match(/'([a-zA-Z0-9]{4})'/);
    const websignkey = wskm ? wskm[1] : '';

    const ajaxResp = await fetch(`https://${usedDomain}/ajaxm.php?file=${fileid}`, {
        method: 'POST',
        headers: { 'User-Agent': DESKTOP_UA, 'Content-Type':'application/x-www-form-urlencoded', 'Referer': `https://${usedDomain}/` },
        body: new URLSearchParams({ action:'downprocess', sign, p:pwd||'', websign, websignkey }).toString()
    });
    const ajaxText = await ajaxResp.text();

    let json;
    try { json = JSON.parse(ajaxText); }
    catch (e) {
        const dm = ajaxText.match(/"dom":"([^"]+)"/);
        const um2 = ajaxText.match(/"url":"([^"]+)"/);
        if (dm && um2) json = { zt:1, dom:dm[1], url:um2[1] };
        else json = { zt:0 };
    }

    if (json.zt === 1) {
        if (json.inf) info.name = json.inf;
        info.url = `${json.dom}/file/${json.url}`;
        const directUrl = await getLanzouDirectLink(info.url);
        info.download_url = directUrl || info.url;
        return { success: true, msg: '解析成功', type: 'lanzou', file_id: info.fid, file_name: info.name||'', file_size: info.size||'', download_url: info.download_url };
    } else {
        const errMsg = json.inf || '获取失败';
        if (errMsg.includes('密码'))
            return { success: false, msg: pwd ? '密码错误' : '请输入密码', need_password: true };
        return { success: false, msg: errMsg };
    }
}

async function getLanzouDirectLink(url) {
    const headers = { 'User-Agent': DESKTOP_UA, 'Cookie': 'down_ip=1', 'Referer': 'https://www.lanzoui.com/' };

    const resp1 = await fetch(url, { headers, redirect: 'manual' });
    if (resp1.status >= 300 && resp1.status < 400) {
        const loc = resp1.headers.get('Location');
        if (loc) return loc;
    }
    const body1 = await resp1.text();

    const argMatch = body1.match(/arg1='(.+?)'/);
    if (argMatch) {
        const acw = acwScV2(argMatch[1]);
        headers['Cookie'] = `down_ip=1; acw_sc__v2=${acw}`;
        const resp2 = await fetch(url, { headers, redirect: 'manual' });
        if (resp2.status >= 300 && resp2.status < 400) {
            const loc = resp2.headers.get('Location');
            if (loc) return loc;
        }
    }

    headers['User-Agent'] = MOBILE_UA;
    const resp3 = await fetch(url, { headers, redirect: 'manual' });
    if (resp3.status >= 300 && resp3.status < 400) {
        const loc = resp3.headers.get('Location');
        if (loc) return loc;
    }
    const body3 = await resp3.text();
    const dlMatch = body3.match(/<a\s+[^>]*href="([^"]*download[^"]*)"/i) ||
                    body3.match(/<a\s+[^>]*href="([^"]*down[^"]*)"/i) ||
                    body3.match(/<a\s+href="(https?:\/\/[^"\s]+)"/i);
    return dlMatch ? dlMatch[1] : '';
}

function acwScV2(arg1) {
    const str = arg1;
    const len = str.length;
    let base = '';
    for (let i = 0; i < len; i++) base += (str.charCodeAt(i) ^ 0x13).toString(16).padStart(2, '0');

    const keys = [];
    for (let i = 0; i < 256; i++) keys[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
        j = (j + keys[i] + str.charCodeAt(i % len)) % 256;
        [keys[i], keys[j]] = [keys[j], keys[i]];
    }

    let result = '';
    let a = 0, b = 0;
    for (let i = 0; i < base.length; i++) {
        a = (a + 1) % 256;
        b = (b + keys[a]) % 256;
        [keys[a], keys[b]] = [keys[b], keys[a]];
        result += String.fromCharCode(parseInt(base[i], 16) ^ keys[(keys[a] + keys[b]) % 256]);
    }
    return md5(result);
}

function md5(str) {
    function md5cycle(x, k) {
        let a=x[0],b=x[1],c=x[2],d=x[3];
        a=ff(a,b,c,d,k[0],7,-680876936);d=ff(d,a,b,c,k[1],12,-389564586);c=ff(c,d,a,b,k[2],17,606105819);b=ff(b,c,d,a,k[3],22,-1044525330);
        a=ff(a,b,c,d,k[4],7,-176418897);d=ff(d,a,b,c,k[5],12,1200080426);c=ff(c,d,a,b,k[6],17,-1473231341);b=ff(b,c,d,a,k[7],22,-45705983);
        a=ff(a,b,c,d,k[8],7,1770035416);d=ff(d,a,b,c,k[9],12,-1958414417);c=ff(c,d,a,b,k[10],17,-42063);b=ff(b,c,d,a,k[11],22,-1990404162);
        a=ff(a,b,c,d,k[12],7,1804603682);d=ff(d,a,b,c,k[13],12,-40341101);c=ff(c,d,a,b,k[14],17,-1502002290);b=ff(b,c,d,a,k[15],22,1236535329);
        a=gg(a,b,c,d,k[1],5,-165796510);d=gg(d,a,b,c,k[6],9,-1069501632);c=gg(c,d,a,b,k[11],14,643717713);b=gg(b,c,d,a,k[0],20,-373897302);
        a=gg(a,b,c,d,k[5],5,-701558691);d=gg(d,a,b,c,k[10],9,38016083);c=gg(c,d,a,b,k[15],14,-660478335);b=gg(b,c,d,a,k[4],20,-405537848);
        a=gg(a,b,c,d,k[9],5,568446438);d=gg(d,a,b,c,k[14],9,-1019803690);c=gg(c,d,a,b,k[3],14,-187363961);b=gg(b,c,d,a,k[8],20,1163531501);
        a=gg(a,b,c,d,k[13],5,-1444681467);d=gg(d,a,b,c,k[2],9,-51403784);c=gg(c,d,a,b,k[7],14,1735328473);b=gg(b,c,d,a,k[12],20,-1926607734);
        a=hh(a,b,c,d,k[5],4,-378558);d=hh(d,a,b,c,k[8],11,-2022574463);c=hh(c,d,a,b,k[11],16,1839030562);b=hh(b,c,d,a,k[14],23,-35309556);
        a=hh(a,b,c,d,k[1],4,-1530992060);d=hh(d,a,b,c,k[4],11,1272893353);c=hh(c,d,a,b,k[7],16,-155497632);b=hh(b,c,d,a,k[10],23,-1094730640);
        a=hh(a,b,c,d,k[13],4,681279174);d=hh(d,a,b,c,k[0],11,-358537222);c=hh(c,d,a,b,k[3],16,-722521979);b=hh(b,c,d,a,k[6],23,76029189);
        a=hh(a,b,c,d,k[9],4,-640364487);d=hh(d,a,b,c,k[12],11,-421815835);c=hh(c,d,a,b,k[15],16,530742520);b=hh(b,c,d,a,k[2],23,-995338651);
        a=ii(a,b,c,d,k[0],6,-198630844);d=ii(d,a,b,c,k[7],10,1126891415);c=ii(c,d,a,b,k[14],15,-1416354905);b=ii(b,c,d,a,k[5],21,-57434055);
        a=ii(a,b,c,d,k[12],6,1700485571);d=ii(d,a,b,c,k[3],10,-1894986606);c=ii(c,d,a,b,k[10],15,-1051523);b=ii(b,c,d,a,k[1],21,-2054922799);
        a=ii(a,b,c,d,k[8],6,1873313359);d=ii(d,a,b,c,k[15],10,-30611744);c=ii(c,d,a,b,k[6],15,-1560198380);b=ii(b,c,d,a,k[13],21,1309151649);
        a=ii(a,b,c,d,k[4],6,-145523070);d=ii(d,a,b,c,k[11],10,-1120210379);c=ii(c,d,a,b,k[2],15,718787259);b=ii(b,c,d,a,k[9],21,-343485551);
        x[0]=add32(a,x[0]);x[1]=add32(b,x[1]);x[2]=add32(c,x[2]);x[3]=add32(d,x[3]);
    }
    function cmn(q,a,b,x,s,t){a=add32(add32(a,q),add32(x,t));return add32((a<<s)|(a>>>(32-s)),b);}
    function ff(a,b,c,d,x,s,t){return cmn((b&c)|((~b)&d),a,b,x,s,t);}
    function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&(~d)),a,b,x,s,t);}
    function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t);}
    function ii(a,b,c,d,x,s,t){return cmn(c^(b|(~d)),a,b,x,s,t);}
    function add32(a,b){return(a+b)&0xFFFFFFFF;}
    function md5blk(s){const md5blks=[];for(let i=0;i<64;i+=4)md5blks[i>>2]=s.charCodeAt(i)+(s.charCodeAt(i+1)<<8)+(s.charCodeAt(i+2)<<16)+(s.charCodeAt(i+3)<<24);return md5blks;}
    function rhex(n){const hex_chr='0123456789abcdef';let s='';for(let j=0;j<4;j++)s+=hex_chr.charAt((n>>(j*8+4))&0x0F)+hex_chr.charAt((n>>(j*8))&0x0F);return s;}
    function hex(x){for(let i=0;i<x.length;i++)x[i]=rhex(x[i]);return x.join('');}

    let n=s.length,state=[1732584193,4023233417,2562383102,271733878],i;
    for(i=64;i<=s.length;i+=64)md5cycle(state,md5blk(s.substring(i-64,i)));
    s=s.substring(i-64);
    const tail=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    for(i=0;i<s.length;i++)tail[i>>2]|=s.charCodeAt(i)<<((i%4)<<8);
    tail[i>>2]|=0x80<<((i%4)<<8);
    if(i>55){md5cycle(state,tail);for(i=0;i<16;i++)tail[i]=0;}
    tail[14]=n*8;
    md5cycle(state,tail);
    return hex(state);
}

async function parseLanzouFolder(html, js, shareId, pwd, domain) {
    const info = { name: '', desc: '', sub_folders: [], list: [], have_page: false };

    const arrMatch = js.match(/data\s*:\s*\{([\s\S]*?)\},/);
    if (!arrMatch) return { success: false, msg: '获取文件夹参数失败' };

    const parameter = {};
    for (const line of arrMatch[1].split('\n')) {
        const l = line.trim();
        if (!l) continue;
        const kv1 = l.match(/^'([^']+)':\s*(\d+),?$/);
        if (kv1) { parameter[kv1[1]] = parseInt(kv1[2]); continue; }
        const kv2 = l.match(/^'([^']+)':\s*'([^']*)',?$/);
        if (kv2) { parameter[kv2[1]] = kv2[2]; continue; }
        const kv3 = l.match(/^'([^']+)':\s*(\w+),?$/);
        if (kv3) {
            const vn = kv3[2];
            const vm = js.match(new RegExp(`${vn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*'(.*?)'`));
            if (vm) parameter[kv3[1]] = vm[1];
            else {
                const vm2 = js.match(new RegExp(`${vn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(\\d+)`));
                if (vm2) parameter[kv3[1]] = parseInt(vm2[1]);
                else parameter[kv3[1]] = '';
            }
        }
    }

    const tvm = js.match(/document\.title\s*=\s*([^;]+);/);
    if (tvm) {
        const vn = tvm[1].trim();
        const nm = js.match(new RegExp(`${vn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*'(.*?)'`));
        if (nm) info.name = decodeHtmlEntities(nm[1]);
    }
    if (!info.name) {
        const nm = html.match(/class="b">([^<]+)</);
        if (nm) info.name = decodeHtmlEntities(nm[1].trim());
    }
    if (!info.name) {
        const nm = html.match(/user-title">([^<]+)</);
        if (nm) info.name = decodeHtmlEntities(nm[1]);
    }
    if (!info.name) {
        const nm = html.match(/class="b">([\s\S]*?)<div/);
        if (nm) info.name = decodeHtmlEntities(nm[1].trim());
    }
    if (!info.name && parameter.fid == 1) {
        const nm = html.match(/<title>(.+?)\s*-\s*蓝奏云/);
        if (nm) info.name = decodeHtmlEntities(nm[1]);
    }

    const dm1 = html.match(/说<\/span>([\s\S]*?)<\/div>/);
    if (dm1 && dm1[1].trim()) info.desc = dm1[1].replace(/<[^>]+>/g, '').trim();
    if (!info.desc) {
        const dm2 = html.match(/<span id="filename">([\s\S]*?)<\/div>/);
        if (dm2 && dm2[1].trim()) info.desc = dm2[1].replace(/<[^>]+>/g, '').trim();
    }
    if (!info.desc) {
        const dm3 = html.match(/user-radio-0"><\/div>([\s\S]*?)<\/div>/);
        if (dm3 && dm3[1].trim()) info.desc = dm3[1].replace(/<[^>]+>/g, '').trim();
    }

    const folderParts = html.split(/<div class="pc-folderlink">|<div class="mbx mbxfolder">/);
    if (folderParts.length > 1) {
        for (let i = 1; i < folderParts.length; i++) {
            const f = folderParts[i];
            const fiMatch = f.match(/href="\/([^"]+)"/);
            const fi = fiMatch ? fiMatch[1] : null;
            let fn = null;
            if (fi) {
                const fnMatch = f.match(new RegExp(`filename">|<a href="/${fi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">([^<]+)<`));
                if (fnMatch) fn = decodeHtmlEntities(fnMatch[1]);
            }
            const fdMatch = f.match(/(?:filesize|pc-folderlinkdes)">([\s\S]*?)</);
            info.sub_folders.push({
                id: fi,
                name: fn,
                desc: fdMatch ? decodeHtmlEntities(fdMatch[1]) : null
            });
        }
    }

    if (js.includes("document.getElementById('pwd').value;") && !pwd)
        return { success: false, msg: '请输入密码', need_password: true };

    parameter.pg = 1;
    parameter.pwd = pwd || '';

    let allFiles = [];
    let page = 1;
    let havePage = true;

    while (havePage) {
        parameter.pg = page;
        const resp = await fetch(`https://${domain}/filemoreajax.php`, {
            method: 'POST',
            headers: { 'User-Agent': DESKTOP_UA, 'Content-Type':'application/x-www-form-urlencoded', 'Referer': `https://${domain}/` },
            body: new URLSearchParams(parameter).toString()
        });
        const json = await resp.json();

        if (json.text && Array.isArray(json.text)) {
            for (const v of json.text) {
                if (v.id != '-1')
                    allFiles.push({ id: v.id, name: decodeHtmlEntities(v.name_all||''), size: v.size||'', time: v.time||'', duan: v.duan||'' });
            }
            havePage = json.text.length >= 50;
            page++;
            if (page > 50) break;
        } else if (json.zt === 2) {
            havePage = false;
        } else {
            if (page === 1) return { success: false, msg: json.info || '获取文件夹失败' };
            break;
        }
    }

    info.list = allFiles;
    info.have_page = false;

    return { success: true, msg: '解析成功（文件夹）', type: 'lanzou', is_folder: true, folder_name: info.name, folder_desc: info.desc, sub_folders: info.sub_folders, file_list: info.list, folder_domain: domain, folder_pwd: pwd||'' };
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
    });
}

function htmlResponse(html) {
    return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
    });
}

function getFrontendHtml(stats) {
    const real_total = stats.total - stats.cached;
    const pct_s = real_total > 0 ? ((stats.success/real_total)*100).toFixed(1) : (stats.total > 0 ? '100.0' : '0.0');
    const pct_c = stats.total > 0 ? ((stats.cached/stats.total)*100).toFixed(1) : '0.0';
    const S = [
        '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1.0">',
        '<title>蓝奏云解析</title><style>',
        '*{margin:0;padding:0;box-sizing:border-box}',
        'body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:linear-gradient(135deg,#0c0c1d 0%,#1a1a2e 50%,#16213e 100%);color:#e0e0e0;min-height:100vh}',
        '.container{max-width:800px;margin:0 auto;padding:20px}',
        'h1{text-align:center;font-size:28px;margin:30px 0;background:linear-gradient(90deg,#4fc3f7,#ab47bc);-webkit-background-clip:text;-webkit-text-fill-color:transparent}',
        '.card{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:24px;margin-bottom:20px;backdrop-filter:blur(10px)}',
        'h2{font-size:18px;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.1)}',
        '.form-group{margin-bottom:14px}',
        'label{display:block;font-weight:600;margin-bottom:6px;color:#aaa;font-size:13px}',
        'input[type="text"],input[type="password"],select{width:100%;padding:10px 14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#e0e0e0;font-size:14px;transition:border-color 0.2s}',
        'input:focus,select:focus{outline:none;border-color:#4fc3f7;box-shadow:0 0 0 3px rgba(79,195,247,0.15)}',
        'select option{background:#1a1a2e;color:#e0e0e0}',
        '.btn{display:inline-block;padding:10px 28px;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;transition:all 0.2s}',
        '.btn-primary{background:linear-gradient(135deg,#4fc3f7,#2196f3);color:#fff}',
        '.btn-primary:hover{opacity:0.9;transform:translateY(-1px)}',
        '.btn-primary:disabled{opacity:0.5;cursor:not-allowed;transform:none}',
        '.btn-secondary{background:rgba(255,255,255,0.1);color:#e0e0e0;margin-left:12px}',
        '.btn-secondary:hover{background:rgba(255,255,255,0.15)}',
        '.btn-sm{padding:8px 20px;font-size:13px}',
        '.btn-row{text-align:left;margin-top:16px}',
        '.msg{padding:10px 14px;border-radius:8px;margin-top:12px;font-size:13px;display:none}',
        '.msg.error{background:rgba(244,67,54,0.15);color:#ef5350;border:1px solid rgba(244,67,54,0.3)}',
        '.msg.success{background:rgba(76,175,80,0.15);color:#66bb6a;border:1px solid rgba(76,175,80,0.3)}',
        '.main-tab-row{display:flex;gap:0;margin-bottom:24px;border-bottom:2px solid rgba(255,255,255,0.1)}',
        '.main-tab-btn{flex:1;padding:14px 0;text-align:center;font-size:16px;font-weight:600;cursor:pointer;border:none;background:none;color:#999;border-bottom:3px solid transparent;margin-bottom:-2px;transition:all 0.2s}',
        '.main-tab-btn.active{color:#4fc3f7;border-bottom-color:#4fc3f7}',
        '.main-tab-btn:hover{color:#4fc3f7}',
        '.main-tab-content{display:none}',
        '.main-tab-content.active{display:block}',
        '.tab-row{display:flex;gap:0;margin-bottom:20px;border-bottom:2px solid rgba(255,255,255,0.1)}',
        '.tab-btn{flex:1;padding:10px 0;text-align:center;font-size:15px;font-weight:600;cursor:pointer;border:none;background:none;color:#999;border-bottom:3px solid transparent;margin-bottom:-2px;transition:all 0.2s}',
        '.tab-btn.active{color:#4fc3f7;border-bottom-color:#4fc3f7}',
        '.tab-btn:hover{color:#4fc3f7}',
        '.tab-content{display:none}',
        '.tab-content.active{display:block}',
        '.result-item{background:rgba(255,255,255,0.05);border-radius:10px;padding:14px;margin-top:12px;border-left:3px solid #4fc3f7}',
        '.result-item .label{font-size:11px;color:#888;margin-bottom:3px}',
        '.result-item .value{font-size:13px;color:#e0e0e0;word-break:break-all}',
        '.result-item .share-url{color:#4fc3f7;font-weight:600}',
        '.copy-btn{display:inline-block;margin-left:6px;padding:2px 10px;background:#4fc3f7;color:#000;border:none;border-radius:4px;font-size:11px;cursor:pointer;font-weight:600}',
        '.copy-btn:hover{background:#29b6f6}',
        '.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}',
        '.stat-card{background:rgba(255,255,255,0.05);border-radius:10px;padding:14px;text-align:center;border:1px solid rgba(255,255,255,0.08)}',
        '.stat-card .num{font-size:24px;font-weight:700;background:linear-gradient(135deg,#4fc3f7,#ab47bc);-webkit-background-clip:text;-webkit-text-fill-color:transparent}',
        '.stat-card .lbl{font-size:11px;color:#888;margin-top:4px}',
        '.file-table{width:100%;border-collapse:collapse;margin-top:12px}',
        '.file-table th,.file-table td{padding:8px 10px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.08);font-size:12px}',
        '.file-table th{background:rgba(255,255,255,0.05);color:#888;font-weight:600}',
        '.file-table tr:hover{background:rgba(255,255,255,0.03)}',
        '.hint{font-size:11px;color:#666;margin-top:6px}',
        '.loading{text-align:center;padding:16px;color:#888}',
        '.spinner{display:inline-block;width:18px;height:18px;border:2px solid rgba(255,255,255,0.2);border-top-color:#4fc3f7;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:6px;vertical-align:middle}',
        '@keyframes spin{to{transform:rotate(360deg)}}',
        '.file-upload-area{border:2px dashed rgba(255,255,255,0.2);border-radius:12px;padding:40px 20px;text-align:center;cursor:pointer;transition:all 0.2s;position:relative}',
        '.file-upload-area:hover{border-color:#4fc3f7;background:rgba(79,195,247,0.05)}',
        '.file-upload-area.dragover{border-color:#4fc3f7;background:rgba(79,195,247,0.1)}',
        '.file-upload-area input[type="file"]{position:absolute;inset:0;opacity:0;cursor:pointer}',
        '.selected-file{margin-top:12px;padding:10px 14px;background:rgba(79,195,247,0.1);border-radius:8px;font-size:14px;display:none}',
        '.selected-file .name{font-weight:600}',
        '.selected-file .size{color:#888;margin-left:8px}',
        '.progress-wrap{margin-top:16px;display:none}',
        '.progress-bar{width:100%;height:8px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden}',
        '.progress-bar-inner{height:100%;background:linear-gradient(90deg,#4fc3f7,#ab47bc);border-radius:4px;transition:width 0.3s;width:0%}',
        '.progress-text{font-size:13px;color:#888;margin-top:6px;text-align:center}',
        '.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}',
        '.badge-yes{background:rgba(76,175,80,0.2);color:#66bb6a}',
        '.badge-no{background:rgba(255,255,255,0.05);color:#888}',
        '.action-btn{padding:4px 12px;border:none;border-radius:4px;font-size:11px;cursor:pointer;font-weight:600;margin-right:4px}',
        '.action-btn-share{background:rgba(79,195,247,0.2);color:#4fc3f7}',
        '.action-btn-share:hover{background:rgba(79,195,247,0.3)}',
        '.action-btn-delete{background:rgba(244,67,54,0.2);color:#ef5350}',
        '.action-btn-delete:hover{background:rgba(244,67,54,0.3)}',
        '@media(max-width:600px){.stats-grid{grid-template-columns:repeat(2,1fr)}}',
        '.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;justify-content:center;align-items:center}',
        '.modal-overlay.active{display:flex}',
        '.modal-box{background:#1e1e32;border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:28px;max-width:520px;width:90%;max-height:80vh;overflow-y:auto;position:relative;box-shadow:0 8px 32px rgba(0,0,0,0.5)}',
        '.modal-close{position:absolute;top:12px;right:16px;background:none;border:none;color:#888;font-size:22px;cursor:pointer;line-height:1}',
        '.modal-close:hover{color:#e0e0e0}',
        '.modal-title{font-size:18px;font-weight:700;margin-bottom:18px;padding-right:30px;color:#e0e0e0}',
        '.modal-info{background:rgba(255,255,255,0.05);border-radius:10px;padding:14px;margin-bottom:16px}',
        '.modal-info .label{font-size:11px;color:#888;margin-bottom:3px}',
        '.modal-info .value{font-size:13px;color:#e0e0e0;word-break:break-all;margin-bottom:10px}',
        '.modal-info .value:last-child{margin-bottom:0}',
        '.modal-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:16px}',
        '</style></head><body><div class="container">',
        '<h1>\u2601\ufe0f 蓝奏云解析</h1>',
        '<div class="main-tab-row">',
        '<button class="main-tab-btn active" data-maintab="main-parse">\ud83d\udd17 解析界面</button>',
        '<button class="main-tab-btn" data-maintab="main-upload">\ud83d\udc64 登录上传</button>',
        '</div>',
        '<div class="main-tab-content active" id="main-parse">',
        '<div class="card"><h2>\ud83d\udcca 解析统计</h2>',
        '<div class="stats-grid">',
        '<div class="stat-card"><div class="num" id="statTotal">'+stats.total+'</div><div class="lbl">总解析</div></div>',
        '<div class="stat-card"><div class="num" id="statSuccess">'+stats.success+'</div><div class="lbl">成功</div></div>',
        '<div class="stat-card"><div class="num" id="statFailed">'+stats.failed+'</div><div class="lbl">失败</div></div>',
        '<div class="stat-card"><div class="num" id="statCached">'+stats.cached+'</div><div class="lbl">缓存命中</div></div>',
        '</div>',
        '<div style="display:flex;gap:12px;font-size:12px;color:#888">',
        '<span>成功率: <strong style="color:#66bb6a">'+pct_s+'%</strong></span>',
        '<span>缓存率: <strong style="color:#4fc3f7">'+pct_c+'%</strong></span>',
        '</div></div>',
        '<div class="card"><h2>\ud83d\udd17 链接解析</h2>',
        '<div class="form-group"><label>分享链接</label><input type="text" id="parse_url" placeholder="蓝奏云或蓝奏云优享版"></div>',
        '<div class="form-group"><label>提取码（选填）</label><input type="text" id="parse_pwd" placeholder="如有密码请输入" style="width:200px"></div>',
        '<div class="btn-row"><button class="btn btn-primary btn-sm" id="parseBtn">解析链接</button></div>',
        '<div class="msg" id="parseMsg" style="margin-top:12px"></div>',
        '<div id="parseResult"></div></div>',
        '</div>',
        '<div class="main-tab-content" id="main-upload">',
        '<div class="card"><h2>\ud83d\udd10 账号登录</h2>',
        '<div class="tab-row">',
        '<button class="tab-btn active" data-tab="tab-login" id="tabLoginBtn">账号密码登录</button>',
        '<button class="tab-btn" data-tab="tab-cookie" id="tabCookieBtn">Cookie 登录</button>',
        '</div>',
        '<div class="tab-content active" id="tab-login">',
        '<div class="msg" id="loginStatus"></div>',
        '<div class="form-group"><label>蓝奏云账号</label><input type="text" id="loginUsername" placeholder="请输入蓝奏云账号"></div>',
        '<div class="form-group"><label>密码</label><input type="password" id="loginPassword" placeholder="请输入密码"></div>',
        '<div class="btn-row"><button class="btn btn-primary btn-sm" id="loginBtn">登录</button></div>',
        '<div class="hint" style="margin-top:12px">\ud83d\udca1 使用蓝奏云注册的账号密码直接登录，无需手动获取 Cookie</div>',
        '</div>',
        '<div class="tab-content" id="tab-cookie">',
        '<div class="msg" id="cookieMsg"></div>',
        '<div class="form-group"><label>PHPSESSID</label><input type="text" id="PHPSESSID" placeholder="请输入 PHPSESSID"></div>',
        '<div class="form-group"><label>ylogin</label><input type="text" id="ylogin" placeholder="请输入 ylogin"></div>',
        '<div class="form-group"><label>phpdisk_info</label><input type="text" id="phpdisk_info" placeholder="请输入 phpdisk_info"></div>',
        '<div class="hint">\ud83d\udca1 请登录蓝奏云网页版，在浏览器按（F12）开发者工具 \u2192 Application \u2192 Cookies 中获取以上三个值</div>',
        '<div class="btn-row" style="margin-top:14px"><button class="btn btn-primary btn-sm" id="cookieLoginBtn">确认登录</button></div>',
        '</div></div>',
        '<div class="card"><h2>\ud83d\udcc1 上传文件</h2>',
        '<div class="form-group"><label>目标文件夹</label><select id="folder_id"aj><option value="-1">根目录（默认）</option></select><div class="hint">登录后自动加载文件夹列表</div></div>',
        '<div class="file-upload-area" id="dropZone"><input type="file" id="fileInput"><div style="font-size:48px;color:#888;margin-bottom:10px">\ud83d\udcc1</div><div style="color:#888;font-size:14px">拖拽文件到此处，或 <strong style="color:#4fc3f7">点击选择文件</strong></div><div style="margin-top:8px;color:#666;font-size:12px">单文件最大 100MB，仅支持蓝奏云允许的格式</div></div>',
        '<div class="selected-file" id="selectedFile"><span class="name" id="fileName"></span><span class="size" id="fileSize"></span></div>',
        '<div class="progress-wrap" id="progressWrap"><div class="progress-bar"><div class="progress-bar-inner" id="progressBar"></div></div><div class="progress-text" id="progressText">上传中...</div></div>',
        '<div class="btn-row"><button class="btn btn-primary" id="uploadBtn" disabled>上传并获取分享链接</button><button class="btn btn-secondary btn-sm" id="listBtn">查看文件列表</button></div>',
        '<div class="msg" id="uploadMsg"></div></div>',
        '<div class="card" id="resultArea" style="display:none"><h2>结果</h2><div id="resultContent"></div></div>',
        '<div class="card" id="fileListArea" style="display:none"><h2>\ud83d\udccb 文件列表</h2><div id="fileListContent"><div class="loading"><span class="spinner"></span>加载中...</div></div></div>',
        '</div>',
        '</div>',
        '<' + 'script>',
        'function escapeHtml(s){var d=document.createElement("div");d.appendChild(document.createTextNode(s));return d.innerHTML;}',
        'function copyText(t){var ok=false;if(navigator.clipboard){navigator.clipboard.writeText(t);ok=true;}else{var a=document.createElement("textarea");a.value=t;document.body.appendChild(a);a.select();document.execCommand("copy");document.body.removeChild(a);ok=true;}if(ok){var toast=document.createElement("div");toast.textContent="\\u2705 已复制到剪贴板";toast.style.cssText="position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(76,175,80,0.95);color:#fff;padding:10px 24px;border-radius:8px;font-size:14px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 0.3s";document.body.appendChild(toast);setTimeout(function(){toast.style.opacity="0";setTimeout(function(){document.body.removeChild(toast);},300);},1500);}}',
        'function formatSize(b){if(b<1024)return b+" B";if(b<1048576)return(b/1024).toFixed(1)+" KB";return(b/1048576).toFixed(2)+" MB";}',
        'var chosenFile=null,isLoggedIn=false;',
        'function getCookieParams(){return{PHPSESSID:document.getElementById("PHPSESSID").value.trim(),ylogin:document.getElementById("ylogin").value.trim(),phpdisk_info:document.getElementById("phpdisk_info").value.trim()};}',
        'function validateCookies(){var c=getCookieParams();return c.PHPSESSID&&c.ylogin&&c.phpdisk_info;}',
        'function checkReady(){document.getElementById("uploadBtn").disabled=!(validateCookies()&&chosenFile);}',
        'function showMsg(el,t,ty){el.textContent=t;el.className="msg "+ty;el.style.display="block";}',
        'function hideMsg(el){el.style.display="none";}',
        'document.querySelectorAll(".main-tab-btn").forEach(function(b){b.addEventListener("click",function(){document.querySelectorAll(".main-tab-btn").forEach(function(x){x.classList.remove("active");});document.querySelectorAll(".main-tab-content").forEach(function(x){x.classList.remove("active");});b.classList.add("active");document.getElementById(b.dataset.maintab).classList.add("active");});});',
        'document.querySelectorAll(".tab-btn").forEach(function(b){b.addEventListener("click",function(){document.querySelectorAll(".tab-btn").forEach(function(x){x.classList.remove("active");});document.querySelectorAll(".tab-content").forEach(function(x){x.classList.remove("active");});b.classList.add("active");document.getElementById(b.dataset.tab).classList.add("active");checkReady();});});',
        'document.getElementById("loginBtn").addEventListener("click",function(){var u=document.getElementById("loginUsername").value.trim(),p=document.getElementById("loginPassword").value.trim(),ls=document.getElementById("loginStatus");if(!u||!p){showMsg(ls,"请输入账号和密码","error");return;}ls.textContent="登录中...";ls.className="msg";ls.style.display="block";var btn=this;btn.disabled=true;var fd=new FormData();fd.append("username",u);fd.append("password",p);fetch("/api/login",{method:"POST",body:fd}).then(function(r){return r.json();}).then(function(resp){btn.disabled=false;if(resp.success&&resp.cookies){document.getElementById("PHPSESSID").value=resp.cookies.PHPSESSID||"";document.getElementById("ylogin").value=resp.cookies.ylogin||"";document.getElementById("phpdisk_info").value=resp.cookies.phpdisk_info||"";showMsg(ls,"\\u2705 登录成功，文件夹列表已加载","success");isLoggedIn=true;checkReady();loadFolderList();}else{showMsg(ls,"\\u274c "+(resp.msg||"登录失败"),"error");}}).catch(function(){btn.disabled=false;showMsg(ls,"\\u274c 网络错误","error");});});',
        '["PHPSESSID","ylogin","phpdisk_info"].forEach(function(id){document.getElementById(id).addEventListener("input",function(){checkReady();});});',
        'document.getElementById("cookieLoginBtn").addEventListener("click",function(){var cm=document.getElementById("cookieMsg");if(!validateCookies()){showMsg(cm,"请填写完整的 Cookie 信息（PHPSESSID、ylogin、phpdisk_info）","error");return;}cm.textContent="验证 Cookie 中...";cm.className="msg";cm.style.display="block";var btn=this;btn.disabled=true;var fd=new FormData(),c=getCookieParams();fd.append("PHPSESSID",c.PHPSESSID);fd.append("ylogin",c.ylogin);fd.append("phpdisk_info",c.phpdisk_info);fd.append("folder_id","-1");fetch("/api/dirs",{method:"POST",body:fd}).then(function(r){return r.json();}).then(function(resp){btn.disabled=false;if(resp.success){isLoggedIn=true;checkReady();loadFolderList();showMsg(cm,"\\u2705 Cookie 验证成功，文件夹列表已加载","success");}else{showMsg(cm,"\\u274c Cookie 无效或已过期："+(resp.msg||"请重新获取"),"error");}}).catch(function(){btn.disabled=false;showMsg(cm,"\\u274c 网络错误，请重试","error");});});',
        'function loadFolderList(){if(!validateCookies())return;var fs=document.getElementById("folder_id");fs.innerHTML="<option value=\\"-1\\">根目录（默认）</option><option disabled>加载中...</option>";var fd=new FormData(),c=getCookieParams();fd.append("PHPSESSID",c.PHPSESSID);fd.append("ylogin",c.ylogin);fd.append("phpdisk_info",c.phpdisk_info);fd.append("folder_id","-1");fetch("/api/dirs",{method:"POST",body:fd}).then(function(r){return r.json();}).then(function(resp){fs.innerHTML="<option value=\\"-1\\">根目录（默认）</option>";if(resp.success&&resp.dirs&&resp.dirs.length>0){resp.dirs.forEach(function(d){var o=document.createElement("option");o.value=d.id;o.textContent=d.name+(d.has_pwd?" \\ud83d\\udd12":"")+" (ID: "+d.id+")";fs.appendChild(o);});}}).catch(function(){fs.innerHTML="<option value=\\"-1\\">根目录（默认）</option>";});}',
        'var fileInput=document.getElementById("fileInput"),dropZone=document.getElementById("dropZone");',
        'fileInput.addEventListener("change",function(){if(this.files&&this.files[0]){chosenFile=this.files[0];document.getElementById("fileName").textContent=chosenFile.name;document.getElementById("fileSize").textContent=formatSize(chosenFile.size);document.getElementById("selectedFile").style.display="block";checkReady();}});',
        'dropZone.addEventListener("dragover",function(e){e.preventDefault();dropZone.classList.add("dragover");});',
        'dropZone.addEventListener("dragleave",function(){dropZone.classList.remove("dragover");});',
        'dropZone.addEventListener("drop",function(e){e.preventDefault();dropZone.classList.remove("dragover");if(e.dataTransfer.files&&e.dataTransfer.files[0]){chosenFile=e.dataTransfer.files[0];document.getElementById("fileName").textContent=chosenFile.name;document.getElementById("fileSize").textContent=formatSize(chosenFile.size);document.getElementById("selectedFile").style.display="block";checkReady();}});',
        'document.getElementById("uploadBtn").addEventListener("click",function(){if(!validateCookies()||!chosenFile)return;var um=document.getElementById("uploadMsg"),pw=document.getElementById("progressWrap"),pb=document.getElementById("progressBar"),pt=document.getElementById("progressText"),btn=this;btn.disabled=true;hideMsg(um);pw.style.display="block";pb.style.width="0%";pt.textContent="上传中...";var fd=new FormData(),c=getCookieParams();fd.append("PHPSESSID",c.PHPSESSID);fd.append("ylogin",c.ylogin);fd.append("phpdisk_info",c.phpdisk_info);fd.append("folder_id",document.getElementById("folder_id").value);fd.append("file",chosenFile);var xhr=new XMLHttpRequest();xhr.open("POST","/api/upload",true);xhr.upload.onprogress=function(e){if(e.lengthComputable){var pct=Math.round((e.loaded/e.total)*100);pb.style.width=pct+"%";pt.textContent="上传中... "+pct+"%";}};xhr.onload=function(){btn.disabled=false;pw.style.display="none";try{var resp=JSON.parse(xhr.responseText);if(resp.success){showMsg(um,"\\u2705 "+resp.msg,"success");displayUploadResult(resp);}else{showMsg(um,"\\u274c "+(resp.msg||"上传失败"),"error");}}catch(e){showMsg(um,"\\u274c 响应解析失败","error");}};xhr.onerror=function(){btn.disabled=false;pw.style.display="none";showMsg(um,"\\u274c 网络错误","error");};xhr.send(fd);});',
        'function displayUploadResult(resp){var a=document.getElementById("resultArea"),c=document.getElementById("resultContent");a.style.display="block";var h="";if(resp.files&&resp.files.length>0){resp.files.forEach(function(f){h+="<div class=\\"result-item\\"><div><div class=\\"label\\">文件名</div><div class=\\"value\\">"+escapeHtml(f.name)+"</div></div><div style=\\"margin-top:6px\\"><div class=\\"label\\">文件ID</div><div class=\\"value\\">"+escapeHtml(String(f.id))+"</div></div><div style=\\"margin-top:6px\\"><div class=\\"label\\">大小</div><div class=\\"value\\">"+escapeHtml(f.size)+"</div></div></div>";});}if(resp.share_info&&resp.share_info.length>0){resp.share_info.forEach(function(s){h+="<div class=\\"result-item\\" style=\\"border-left-color:#ab47bc\\"><div><div class=\\"label\\">分享名称</div><div class=\\"value\\">"+escapeHtml(s.share_name||"")+"</div></div>";if(s.share_url)h+="<div style=\\"margin-top:6px\\"><div class=\\"label\\">分享链接</div><div class=\\"value share-url\\">"+escapeHtml(s.share_url)+" <button class=\\"copy-btn\\" onclick=\\"copyText(this.dataset.url)\\" data-url=\\""+escapeHtml(s.share_url)+"\\">复制</button></div></div>";if(s.share_pwd)h+="<div style=\\"margin-top:6px\\"><div class=\\"label\\">提取码</div><div class=\\"value\\">"+escapeHtml(s.share_pwd)+" <button class=\\"copy-btn\\" onclick=\\"copyText(this.dataset.pwd)\\" data-pwd=\\""+escapeHtml(s.share_pwd)+"\\">复制</button></div></div>";h+="</div>";});}c.innerHTML=h;}',
        'document.getElementById("listBtn").addEventListener("click",function(){if(!validateCookies()){showMsg(document.getElementById("uploadMsg"),"请先登录或填写 Cookie 并登录","error");return;}var fla=document.getElementById("fileListArea"),flc=document.getElementById("fileListContent");fla.style.display="block";flc.innerHTML="<div class=\\"loading\\"><span class=\\"spinner\\"></span>加载中...</div>";var fd=new FormData(),c=getCookieParams();fd.append("PHPSESSID",c.PHPSESSID);fd.append("ylogin",c.ylogin);fd.append("phpdisk_info",c.phpdisk_info);fd.append("folder_id",document.getElementById("folder_id").value);fetch("/api/files",{method:"POST",body:fd}).then(function(r){return r.json();}).then(function(resp){if(resp.success&&resp.files&&resp.files.length>0){var h="<table class=\\"file-table\\"><thead><tr><th>文件名</th><th>大小</th><th>类型</th><th>下载</th><th>密码</th><th>操作</th></tr></thead><tbody>";resp.files.forEach(function(f){h+="<tr><td>"+escapeHtml(f.name)+"</td><td>"+escapeHtml(f.size)+"</td><td>"+escapeHtml(f.type)+"</td><td>"+escapeHtml(f.downs)+"</td><td>"+(f.has_pwd?"<span class=\\"badge badge-yes\\">有</span>":"<span class=\\"badge badge-no\\">无</span>")+"</td><td><button class=\\"action-btn action-btn-share\\" data-fid=\\""+f.id+"\\" onclick=\\"getShareForFile(this.dataset.fid,true)\\">获取分享</button> <button class=\\"action-btn action-btn-delete\\" data-fid=\\""+f.id+"\\" data-name=\\""+escapeHtml(f.name)+"\\" onclick=\\"deleteItem(this.dataset.fid,true,this.dataset.name)\\">删除</button></td></tr>";});h+="</tbody></table>";flc.innerHTML=h;}else{flc.innerHTML="<div style=\\"text-align:center;color:#888;padding:12px\\">暂无文件</div>";}}).catch(function(){flc.innerHTML="<div style=\\"text-align:center;color:#888;padding:12px\\">加载失败</div>";});});',
        'window.getShareForFile=function(fid,isFile){var c=getCookieParams(),fd=new FormData();fd.append("PHPSESSID",c.PHPSESSID);fd.append("ylogin",c.ylogin);fd.append("phpdisk_info",c.phpdisk_info);fd.append("fid",fid);fd.append("is_file",isFile?"1":"0");fetch("/api/share",{method:"POST",body:fd}).then(function(r){return r.json();}).then(function(resp){if(resp.success){var h="<div class=\\"result-item\\" style=\\"border-left-color:#ab47bc\\"><div><div class=\\"label\\">分享名称</div><div class=\\"value\\">"+escapeHtml(resp.name||"")+"</div></div>";if(resp.url)h+="<div style=\\"margin-top:6px\\"><div class=\\"label\\">分享链接</div><div class=\\"value share-url\\">"+escapeHtml(resp.url)+" <button class=\\"copy-btn\\" onclick=\\"copyText(this.dataset.url)\\" data-url=\\""+escapeHtml(resp.url)+"\\">复制</button></div></div>";if(resp.pwd)h+="<div style=\\"margin-top:6px\\"><div class=\\"label\\">提取码</div><div class=\\"value\\">"+escapeHtml(resp.pwd)+" <button class=\\"copy-btn\\" onclick=\\"copyText(this.dataset.pwd)\\" data-pwd=\\""+escapeHtml(resp.pwd)+"\\">复制</button></div></div>";if(resp.desc)h+="<div style=\\"margin-top:6px\\"><div class=\\"label\\">描述</div><div class=\\"value\\">"+escapeHtml(resp.desc)+"</div></div>";h+="</div>";var a=document.getElementById("resultArea");a.style.display="block";document.getElementById("resultContent").innerHTML=h;a.scrollIntoView({behavior:"smooth"});}else{showMsg(document.getElementById("uploadMsg"),"\\u274c 获取分享信息失败: "+(resp.request_msg||resp.msg||"未知错误"),"error");}}).catch(function(){showMsg(document.getElementById("uploadMsg"),"\\u274c 网络错误","error");});};',
        'window.deleteItem=function(fid,isFile,name){if(!confirm("确定要删除 "+(name||"此项目")+" 吗？"))return;var c=getCookieParams(),fd=new FormData();fd.append("PHPSESSID",c.PHPSESSID);fd.append("ylogin",c.ylogin);fd.append("phpdisk_info",c.phpdisk_info);fd.append("fid",fid);fd.append("is_file",isFile?"1":"0");fetch("/api/delete",{method:"POST",body:fd}).then(function(r){return r.json();}).then(function(resp){if(resp.success){showMsg(document.getElementById("uploadMsg"),"\\u2705 删除成功","success");document.getElementById("listBtn").click();}else{showMsg(document.getElementById("uploadMsg"),"\\u274c 删除失败: "+(resp.msg||"未知错误"),"error");}}).catch(function(){showMsg(document.getElementById("uploadMsg"),"\\u274c 网络错误","error");});};',
        'document.getElementById("parseBtn").addEventListener("click",function(){var url=document.getElementById("parse_url").value.trim(),pwd=document.getElementById("parse_pwd").value.trim(),msgEl=document.getElementById("parseMsg"),resultEl=document.getElementById("parseResult");if(!url){showMsg(msgEl,"请输入分享链接","error");return;}if(pwd.length>=60&&/^[A-Za-z0-9_+.=\\-]+$/.test(pwd)){url=url.split("?")[0]+"?webpage="+pwd;pwd="";}var th="";if(/ilanzou\\.com/i.test(url))th="蓝奏云优享版";else if(/lanzou[a-z]{0,2}\\.com/i.test(url))th="蓝奏云";else{showMsg(msgEl,"无法识别的链接","error");return;}hideMsg(msgEl);resultEl.innerHTML="<div class=\\"loading\\"><span class=\\"spinner\\"></span>正在解析"+th+"链接...</div>";var btn=this;btn.disabled=true;var fd=new FormData();fd.append("url",url);fd.append("pwd",pwd||"");fetch("/api/parse",{method:"POST",body:fd}).then(function(r){return r.json();}).then(function(resp){btn.disabled=false;window.currentParseResult=resp;window.currentParseUrl=url;window.currentParsePwd=pwd;if(resp.success){showMsg(msgEl,"\\u2705 "+resp.msg+(resp.from_cache?" (缓存)":""),"success");}else{showMsg(msgEl,"\\u274c "+resp.msg,"error");}displayResult("parseResult",resp);refreshStats();}).catch(function(){btn.disabled=false;showMsg(msgEl,"\\u274c 网络错误","error");resultEl.innerHTML="";});});',
        'function displayResult(id,resp){var c=document.getElementById(id);if(!resp.success){var h="<div style=\\"color:#ef5350;padding:10px;background:rgba(244,67,54,0.1);border-radius:8px\\">"+escapeHtml(resp.msg||"解析失败");if(resp.need_password)h+="<br><span style=\\"color:#888;font-size:11px\\">该链接需要提取码，请在上方输入后重新解析</span>";h+="</div>";c.innerHTML=h;return;}var expStr="";if(typeof resp.expires_in==="number"&&resp.expires_in>0){var em=Math.floor(resp.expires_in/60),es=resp.expires_in%60;expStr=em>0?em+"分"+es+"秒":es+"秒";}if(resp.is_folder){var h="<div class=\\"result-item\\"><div><div class=\\"label\\">文件夹名称</div><div class=\\"value\\">"+escapeHtml(resp.folder_name||"")+"</div></div>";if(resp.folder_desc)h+="<div style=\\"margin-top:6px\\"><div class=\\"label\\">描述</div><div class=\\"value\\">"+escapeHtml(resp.folder_desc)+"</div></div>";h+="</div>";if(resp.sub_folders&&resp.sub_folders.length>0){h+="<div style=\\"margin-top:10px\\"><div class=\\"label\\">子文件夹</div><table class=\\"file-table\\"><thead><tr><th>名称</th><th>描述</th></tr></thead><tbody>";resp.sub_folders.forEach(function(f){h+="<tr><td>"+escapeHtml(f.name||f.id||"")+"</td><td>"+escapeHtml(f.desc||"")+"</td></tr>";});h+="</tbody></table></div>";}if(resp.file_list&&resp.file_list.length>0){h+="<table class=\\"file-table\\"><thead><tr><th>文件名</th><th>大小</th><th>时间</th><th>操作</th></tr></thead><tbody>";resp.file_list.forEach(function(f){h+="<tr><td>"+escapeHtml(f.name)+"</td><td>"+escapeHtml(f.size)+"</td><td>"+escapeHtml(f.time)+"</td><td><button class=\\"btn btn-primary btn-sm\\" data-file-id=\\""+f.id+"\\" data-domain=\\""+(resp.folder_domain||"www.lanzoui.com")+"\\" data-name=\\""+escapeHtml(f.name)+"\\" data-size=\\""+escapeHtml(f.size)+"\\" data-time=\\""+escapeHtml(f.time)+"\\" data-pwd=\\""+(resp.folder_pwd||"")+"\\" onclick=\\"viewFolderFile(this)\\"\\">查看</button></td></tr>";});h+="</tbody></table>";}else if(!resp.sub_folders||resp.sub_folders.length===0) h+="<div style=\\"text-align:center;color:#888;padding:12px\\">文件夹为空</div>";c.innerHTML=h;}else{var h="<div class=\\"result-item\\">";if(resp.file_name)h+="<div><div class=\\"label\\">文件名</div><div class=\\"value\\">"+escapeHtml(resp.file_name)+"</div></div>";if(resp.file_size)h+="<div style=\\"margin-top:6px\\"><div class=\\"label\\">文件大小</div><div class=\\"value\\">"+escapeHtml(resp.file_size)+"</div></div>";if(resp.file_id)h+="<div style=\\"margin-top:6px\\"><div class=\\"label\\">文件ID</div><div class=\\"value\\">"+escapeHtml(String(resp.file_id))+"</div></div>";if(resp.download_url)h+="<div style=\\"margin-top:6px\\"><div class=\\"label\\">下载直链</div><div class=\\"value share-url\\" style=\\"word-break:break-all\\">"+escapeHtml(resp.download_url)+" <button class=\\"copy-btn\\" onclick=\\"copyText(this.dataset.url)\\" data-url=\\""+escapeHtml(resp.download_url)+"\\">复制</button></div></div>";if(expStr)h+="<div style=\\"margin-top:6px\\"><div class=\\"label\\">有效期</div><div class=\\"value\\">"+escapeHtml(expStr)+"</div></div>";h+="</div>";h+="<div style=\\"display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;justify-content:center\\">";h+="<button class=\\"btn btn-primary btn-sm\\" onclick=\\"copyParseJSON()\\">复制JSON</button>";if(resp.download_url)h+="<button class=\\"btn btn-primary btn-sm\\" onclick=\\"copyDownloadLink()\\">生成永久直链并复制</button>";if(resp.download_url)h+="<button class=\\"btn btn-primary btn-sm\\" onclick=\\"downloadCurrentFile()\\">下载此文件</button>";h+="</div>";c.innerHTML=h;}}',
        'window.copyDownloadLink=function(){if(!window.currentParseUrl){showMsg(document.getElementById("parseMsg"),"\\u274c 没有可复制的链接","error");return;}var link=location.origin+"/?url="+encodeURIComponent(window.currentParseUrl);if(window.currentParsePwd)link+="&pwd="+encodeURIComponent(window.currentParsePwd);copyText(link);showMsg(document.getElementById("parseMsg"),"\\u2705 链接已复制","success");};',
        'window.copyParseJSON=function(){if(!window.currentParseResult){showMsg(document.getElementById("parseMsg"),"\\u274c 没有可复制的内容","error");return;}var jsonStr=JSON.stringify(window.currentParseResult,null,2);copyText(jsonStr);showMsg(document.getElementById("parseMsg"),"\\u2705 JSON已复制","success");};',
        'window.downloadCurrentFile=function(){if(!window.currentParseResult||!window.currentParseResult.download_url){showMsg(document.getElementById("parseMsg"),"\\u274c 没有可用的下载链接","error");return;}window.open(window.currentParseResult.download_url,"_blank");};',
        'window.viewFolderFile=function(btn){var fileId=btn.dataset.fileId,domain=btn.dataset.domain||"www.lanzoui.com",name=btn.dataset.name||"",size=btn.dataset.size||"",time=btn.dataset.time||"";var wpIdx=fileId.indexOf("?webpage=");var shareId=wpIdx>=0?fileId.substring(0,wpIdx):fileId;var webpagePwd=wpIdx>=0?fileId.substring(wpIdx+9):"";var shareUrl="https://"+domain+"/"+shareId;document.getElementById("modalTitle").textContent=name;var infoHtml="<div><div class=\\"label\\">文件名</div><div class=\\"value\\">"+escapeHtml(name)+"</div></div>";infoHtml+="<div><div class=\\"label\\">文件大小</div><div class=\\"value\\">"+escapeHtml(size)+"</div></div>";infoHtml+="<div><div class=\\"label\\">上传时间</div><div class=\\"value\\">"+escapeHtml(time)+"</div></div>";infoHtml+="<div><div class=\\"label\\">蓝奏云链接</div><div class=\\"value\\"><a href=\\""+escapeHtml(shareUrl)+"\\" target=\\"_blank\\" style=\\"color:#4fc3f7\\">"+escapeHtml(shareUrl)+"</a></div></div>";if(webpagePwd)infoHtml+="<div><div class=\\"label\\">密码</div><div class=\\"value\\">"+escapeHtml(webpagePwd)+"</div></div>";document.getElementById("modalInfo").innerHTML=infoHtml;document.getElementById("modalResult").innerHTML="";var actHtml="<button class=\\"btn btn-primary btn-sm\\" id=\\"modalParseBtn\\" data-file-id=\\""+fileId+"\\" data-domain=\\""+domain+"\\" onclick=\\"modalParseFile()\\">解析</button>";document.getElementById("modalActions").innerHTML=actHtml;document.getElementById("fileModal").classList.add("active");};',
        'window.closeFileModal=function(){document.getElementById("fileModal").classList.remove("active");};',
        'window.modalParseFile=function(){var btn=document.getElementById("modalParseBtn");if(btn.disabled)return;btn.disabled=true;btn.textContent="解析中...";var fileId=btn.dataset.fileId,domain=btn.dataset.domain||"www.lanzoui.com";var fd=new FormData();fd.append("file_id",fileId);fd.append("domain",domain);fetch("/api/parse_folder_file",{method:"POST",body:fd}).then(function(r){return r.json();}).then(function(resp){btn.disabled=false;if(resp.success){btn.textContent="已解析";btn.style.background="#4caf50";var resultHtml="<div class=\\"result-item\\" style=\\"margin-top:0\\">";if(resp.file_name)resultHtml+="<div><div class=\\"label\\">文件名</div><div class=\\"value\\">"+escapeHtml(resp.file_name)+"</div></div>";if(resp.file_size)resultHtml+="<div style=\\"margin-top:6px\\"><div class=\\"label\\">文件大小</div><div class=\\"value\\">"+escapeHtml(resp.file_size)+"</div></div>";if(resp.download_url)resultHtml+="<div style=\\"margin-top:6px\\"><div class=\\"label\\">下载直链</div><div class=\\"value share-url\\" style=\\"word-break:break-all\\">"+escapeHtml(resp.download_url)+" <button class=\\"copy-btn\\" onclick=\\"copyText(this.dataset.url)\\" data-url=\\""+escapeHtml(resp.download_url)+"\\">复制</button></div></div>";if(typeof resp.expires_in==="number"&&resp.expires_in>0){var em=Math.floor(resp.expires_in/60),es=resp.expires_in%60;var expStr=em>0?em+"分"+es+"秒":es+"秒";resultHtml+="<div style=\\"margin-top:6px\\"><div class=\\"label\\">有效期</div><div class=\\"value\\">"+escapeHtml(expStr)+"</div></div>";}resultHtml+="</div>";document.getElementById("modalResult").innerHTML=resultHtml;var actHtml="<button class=\\"btn btn-primary btn-sm\\" style=\\"background:#4caf50\\">已解析</button>";actHtml+="<button class=\\"btn btn-primary btn-sm\\" onclick=\\"copyText(window._modalShareLink);showMsg(document.getElementById(\\u0027parseMsg\\u0027),\\u0027\\u2705 链接已复制\\u0027,\\u0027success\\u0027)\\">生成永久直链并复制</button>";actHtml+="<button class=\\"btn btn-primary btn-sm\\" onclick=\\"window.open(window._modalDownloadUrl,\\u0027_blank\\u0027)\\">下载此文件</button>";document.getElementById("modalActions").innerHTML=actHtml;window._modalDownloadUrl=resp.download_url;window._modalShareLink=location.origin+"/?url="+encodeURIComponent("https://"+domain+"/"+fileId);showMsg(document.getElementById("parseMsg"),"\\u2705 "+resp.file_name+" 解析成功","success");}else{btn.textContent="解析";showMsg(document.getElementById("parseMsg"),"\\u274c "+resp.msg,"error");}}).catch(function(){btn.disabled=false;btn.textContent="解析";showMsg(document.getElementById("parseMsg"),"\\u274c 网络错误","error");});};',
        'function refreshStats(){fetch("/api/stats").then(function(r){return r.json();}).then(function(d){if(d.success){var s=d.data;document.getElementById("statTotal").textContent=s.total;document.getElementById("statSuccess").textContent=s.success;document.getElementById("statFailed").textContent=s.failed;document.getElementById("statCached").textContent=s.cached;}}).catch(function(){});}',
        '</' + 'script>',
        '<footer style="margin-top:48px;text-align:center;padding:24px 0;border-top:1px solid rgba(255,255,255,0.08)">',
        '<div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap">',
        '<a href="https://github.com/whortle/drive-tool" target="_blank" style="color:#4fc3f7;text-decoration:none;font-size:14px">GitHub项目</a>',
        '<span style="color:#666">|</span>',
        '<span style="color:#888;font-size:14px">By：<span style="color:#ccc;font-weight:600">whortle</span></span>',
        '</div>',
        '<div style="color:#666;font-size:12px;margin-top:8px">蓝奏云解析工具 - 基于CloudFlare Workers部署</div>',
        '</footer>',
        '<div class="modal-overlay" id="fileModal" onclick="if(event.target===this)closeFileModal()"><div class="modal-box"><button class="modal-close" onclick="closeFileModal()">&times;</button><div class="modal-title" id="modalTitle"></div><div class="modal-info" id="modalInfo"></div><div id="modalResult"></div><div class="modal-actions" id="modalActions"></div></div></div>',
        '</body></html>'
    ];
    return S.join('\n');
}

function generateAdminToken(username, password) {
    const raw = username + ':' + password + ':' + Math.floor(Date.now() / 86400000);
    let hash = 0;
    for (let i = 0; i < raw.length; i++) { hash = ((hash << 5) - hash) + raw.charCodeAt(i); hash |= 0; }
    return btoa(username + ':' + Math.abs(hash).toString(36));
}

function verifyAdminToken(token, env) {
    try {
        const decoded = atob(token);
        const parts = decoded.split(':');
        if (parts.length < 2) return false;
        const expected = generateAdminToken(env.admin || '', env.pass || '');
        return token === expected;
    } catch (e) { return false; }
}

function getAdminCookie(request) {
    const cookieHeader = request.headers.get('Cookie') || '';
    const match = cookieHeader.match(/admin_token=([^;]+)/);
    return match ? match[1] : '';
}

function getAdminHtml() {
    const S = [
        '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1.0">',
        '<title>后台管理</title><style>',
        '*{margin:0;padding:0;box-sizing:border-box}',
        'body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:linear-gradient(135deg,#0c0c1d 0%,#1a1a2e 50%,#16213e 100%);color:#e0e0e0;min-height:100vh}',
        '.container{max-width:1000px;margin:0 auto;padding:20px}',
        'h1{text-align:center;font-size:26px;margin:30px 0;background:linear-gradient(90deg,#f44336,#ff9800);-webkit-background-clip:text;-webkit-text-fill-color:transparent}',
        '.card{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:24px;margin-bottom:20px;backdrop-filter:blur(10px)}',
        'h2{font-size:18px;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.1)}',
        '.form-group{margin-bottom:14px}',
        'label{display:block;font-weight:600;margin-bottom:6px;color:#aaa;font-size:13px}',
        'input[type="text"],input[type="password"]{width:100%;padding:10px 14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#e0e0e0;font-size:14px}',
        'input:focus{outline:none;border-color:#f44336;box-shadow:0 0 0 3px rgba(244,67,54,0.15)}',
        '.btn{display:inline-block;padding:10px 28px;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;transition:all 0.2s}',
        '.btn-danger{background:linear-gradient(135deg,#f44336,#e53935);color:#fff}',
        '.btn-danger:hover{opacity:0.9;transform:translateY(-1px)}',
        '.btn-danger:disabled{opacity:0.5;cursor:not-allowed;transform:none}',
        '.btn-warn{background:rgba(255,152,0,0.2);color:#ff9800;margin-left:12px}',
        '.btn-warn:hover{background:rgba(255,152,0,0.3)}',
        '.btn-sm{padding:8px 20px;font-size:13px}',
        '.btn-row{text-align:left;margin-top:16px}',
        '.msg{padding:10px 14px;border-radius:8px;margin-top:12px;font-size:13px;display:none}',
        '.msg.error{background:rgba(244,67,54,0.15);color:#ef5350;border:1px solid rgba(244,67,54,0.3)}',
        '.msg.success{background:rgba(76,175,80,0.15);color:#66bb6a;border:1px solid rgba(76,175,80,0.3)}',
        '.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}',
        '.stat-card{background:rgba(255,255,255,0.05);border-radius:10px;padding:14px;text-align:center;border:1px solid rgba(255,255,255,0.08)}',
        '.stat-card .num{font-size:24px;font-weight:700;background:linear-gradient(135deg,#f44336,#ff9800);-webkit-background-clip:text;-webkit-text-fill-color:transparent}',
        '.stat-card .lbl{font-size:11px;color:#888;margin-top:4px}',
        '.file-table{width:100%;border-collapse:collapse;margin-top:12px}',
        '.file-table th,.file-table td{padding:8px 10px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.08);font-size:12px}',
        '.file-table th{background:rgba(255,255,255,0.05);color:#888;font-weight:600}',
        '.file-table tr:hover{background:rgba(255,255,255,0.03)}',
        '.action-btn{padding:4px 12px;border:none;border-radius:4px;font-size:11px;cursor:pointer;font-weight:600;margin-right:4px}',
        '.action-btn-delete{background:rgba(244,67,54,0.2);color:#ef5350}',
        '.action-btn-delete:hover{background:rgba(244,67,54,0.3)}',
        '.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}',
        '.badge-yes{background:rgba(76,175,80,0.2);color:#66bb6a}',
        '.badge-no{background:rgba(244,67,54,0.2);color:#ef5350}',
        '.login-box{max-width:400px;margin:80px auto}',
        '.tab-row{display:flex;gap:0;margin-bottom:20px;border-bottom:2px solid rgba(255,255,255,0.1)}',
        '.tab-btn{flex:1;padding:10px 0;text-align:center;font-size:15px;font-weight:600;cursor:pointer;border:none;background:none;color:#999;border-bottom:3px solid transparent;margin-bottom:-2px;transition:all 0.2s}',
        '.tab-btn.active{color:#f44336;border-bottom-color:#f44336}',
        '.tab-btn:hover{color:#f44336}',
        '.tab-content{display:none}',
        '.tab-content.active{display:block}',
        '.filter-row{display:flex;gap:10px;margin-bottom:12px;align-items:center}',
        '.filter-row select,.filter-row input{padding:8px 12px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#e0e0e0;font-size:13px}',
        '.filter-row select option{background:#1a1a2e;color:#e0e0e0}',
        '@media(max-width:600px){.stats-grid{grid-template-columns:repeat(2,1fr)}}',
        '</style></head><body>',
        '<div id="loginPage" class="container"><div class="login-box card">',
        '<h1>\ud83d\udd12 后台管理</h1>',
        '<div class="form-group"><label>用户名</label><input type="text" id="adminUser" placeholder="请输入用户名"></div>',
        '<div class="form-group"><label>密码</label><input type="password" id="adminPass" placeholder="请输入密码"></div>',
        '<div class="btn-row" style="text-align:center"><button class="btn btn-danger" id="adminLoginBtn">登录</button></div>',
        '<div style="text-align:center;margin-top:12px"><a href="/" style="color:#4fc3f7;font-size:13px;text-decoration:none">\u2190 返回首页</a></div>',
        '<div class="msg" id="loginMsg"></div>',
        '</div>',
        '<footer style="margin-top:48px;text-align:center;padding:24px 0;border-top:1px solid rgba(255,255,255,0.08)">',
        '<div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap">',
        '<a href="https://github.com/whortle/drive-tool" target="_blank" style="color:#4fc3f7;text-decoration:none;font-size:14px">GitHub项目</a>',
        '<span style="color:#666">|</span>',
        '<span style="color:#888;font-size:14px">By：<span style="color:#ccc;font-weight:600">whortle</span></span>',
        '</div>',
        '<div style="color:#666;font-size:12px;margin-top:8px">蓝奏云解析工具 - 基于CloudFlare Workers部署</div>',
        '</footer>',
        '</div>',
        '<div id="adminPage" class="container" style="display:none">',
        '<h1>\ud83d\udd12 后台管理面板</h1>',
        '<div class="msg" id="adminMsg" style="margin-bottom:16px"></div>',
        '<div class="card"><h2>\ud83d\udcca 解析统计</h2>',
        '<div class="stats-grid">',
        '<div class="stat-card"><div class="num" id="statTotal">0</div><div class="lbl">总解析</div></div>',
        '<div class="stat-card"><div class="num" id="statSuccess">0</div><div class="lbl">成功</div></div>',
        '<div class="stat-card"><div class="num" id="statFailed">0</div><div class="lbl">失败</div></div>',
        '<div class="stat-card"><div class="num" id="statCached">0</div><div class="lbl">缓存命中</div></div>',
        '</div>',
        '<div style="display:flex;gap:12px;font-size:12px;color:#888">',
        '<span>成功率: <strong style="color:#66bb6a" id="pctSuccess">0%</strong></span>',
        '<span>缓存率: <strong style="color:#4fc3f7" id="pctCached">0%</strong></span>',
        '</div>',
        '<div class="btn-row"><button class="btn btn-danger btn-sm" id="clearStatsBtn">重置统计</button></div>',
        '</div>',
        '<div class="card"><h2>\ud83d\udccb 解析记录 <button class="btn btn-danger btn-sm" id="clearRecordsBtn" style="font-size:11px;margin-left:10px;vertical-align:middle">清空全部记录</button></h2>',
        '<div class="tab-row">',
        '<button class="tab-btn active" data-filter="all">全部</button>',
        '<button class="tab-btn" data-filter="success">成功</button>',
        '<button class="tab-btn" data-filter="failed">失败</button>',
        '</div>',
        '<div id="allRecords"></div>',
        '<div id="recordsPager"></div>',
        '</div>',
        '<div style="text-align:center;margin-top:20px"><button class="btn btn-warn btn-sm" id="logoutBtn">退出登录</button> <a href="/" class="btn btn-sm" style="text-decoration:none;margin-left:8px;background:#4fc3f7;color:#fff">返回首页</a></div>',
        '<footer style="margin-top:48px;text-align:center;padding:24px 0;border-top:1px solid rgba(255,255,255,0.08)">',
        '<div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap">',
        '<a href="https://github.com/whortle/drive-tool" target="_blank" style="color:#4fc3f7;text-decoration:none;font-size:14px">GitHub项目</a>',
        '<span style="color:#666">|</span>',
        '<span style="color:#888;font-size:14px">By：<span style="color:#ccc;font-weight:600">whortle</span></span>',
        '</div>',
        '<div style="color:#666;font-size:12px;margin-top:8px">蓝奏云解析工具 - 基于CloudFlare Workers部署</div>',
        '</footer>',
        '</div>',
        '<div id="recordModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;justify-content:center;align-items:center">',
        '<div style="background:#1e1e32;border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:24px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;position:relative">',
        '<button id="closeRecordModal" style="position:absolute;top:10px;right:14px;background:none;border:none;color:#888;font-size:20px;cursor:pointer">&times;</button>',
        '<h3 style="margin:0 0 16px;color:#e0e0e0;font-size:16px">记录详情</h3>',
        '<div id="recordDetail" style="font-size:13px;color:#ccc"></div>',
        '</div></div>',
        '<' + 'script>',
        'function escapeHtml(s){var d=document.createElement("div");d.appendChild(document.createTextNode(s));return d.innerHTML;}',
        'function showMsg(el,t,ty){el.textContent=t;el.className="msg "+ty;el.style.display="block";}',
        'var adminToken=document.cookie.match(/admin_token=([^;]+)/);adminToken=adminToken?adminToken[1]:"";',
        'function apiGet(path){return fetch(path,{headers:{"X-Admin-Token":adminToken}}).then(function(r){return r.json();});}',
        'function apiPost(path,data){var fd=new FormData();if(data){for(var k in data)fd.append(k,data[k]);}return fetch(path,{method:"POST",headers:{"X-Admin-Token":adminToken},body:fd}).then(function(r){return r.json();});}',
        'document.getElementById("adminLoginBtn").addEventListener("click",function(){var u=document.getElementById("adminUser").value.trim(),p=document.getElementById("adminPass").value.trim(),msg=document.getElementById("loginMsg");if(!u||!p){showMsg(msg,"请输入用户名和密码","error");return;}var btn=this;btn.disabled=true;apiPost("/api/admin/login",{username:u,password:p}).then(function(resp){btn.disabled=false;if(resp.success&&resp.token){adminToken=resp.token;document.cookie="admin_token="+resp.token+";path=/;max-age=86400";showAdminPage();}else{showMsg(msg,resp.msg||"登录失败","error");}}).catch(function(){btn.disabled=false;showMsg(msg,"网络错误","error");});});',
        'function showAdminPage(){document.getElementById("loginPage").style.display="none";document.getElementById("adminPage").style.display="block";loadStats();loadRecords();}',
        'document.querySelectorAll(".tab-btn").forEach(function(b){b.addEventListener("click",function(){document.querySelectorAll(".tab-btn").forEach(function(x){x.classList.remove("active");});b.classList.add("active");window._recordsFilter=b.dataset.filter||"all";window._recordsPage=1;renderRecords();});});',
        'function loadStats(){apiGet("/api/admin/stats").then(function(d){if(!d.success)return;var s=d.data;document.getElementById("statTotal").textContent=s.total;document.getElementById("statSuccess").textContent=s.success;document.getElementById("statFailed").textContent=s.failed;document.getElementById("statCached").textContent=s.cached;var rt=s.total-s.cached;var p1=rt>0?((s.success/rt)*100).toFixed(1):(s.total>0?"100.0":"0.0");var p2=s.total>0?((s.cached/s.total)*100).toFixed(1):"0.0";document.getElementById("pctSuccess").textContent=p1+"%";document.getElementById("pctCached").textContent=p2+"%";}).catch(function(){});}',
        'window._recordsAll=[];window._recordsPage=1;window._recordsPerPage=10;window._recordsFilter="all";',
        'function renderRecords(){var c=document.getElementById("allRecords");var all=window._recordsAll||[];var filtered=all;if(window._recordsFilter==="success")filtered=all.filter(function(r){return r.success;});else if(window._recordsFilter==="failed")filtered=all.filter(function(r){return !r.success;});if(!filtered||filtered.length===0){c.innerHTML="<div style=\\"text-align:center;color:#888;padding:20px;font-size:13px\\">暂无记录</div>";document.getElementById("recordsPager").innerHTML="";return;}var total=filtered.length;var pages=Math.ceil(total/window._recordsPerPage);if(window._recordsPage>pages)window._recordsPage=pages;if(window._recordsPage<1)window._recordsPage=1;var start=(window._recordsPage-1)*window._recordsPerPage;var pageData=filtered.slice(start,start+window._recordsPerPage);var h="<table class=\\"file-table\\" style=\\"font-size:12px\\"><thead><tr><th style=\\"min-width:130px\\">时间</th><th style=\\"min-width:100px\\">链接</th><th>文件名</th><th>返回类型</th><th>状态</th><th>操作</th></tr></thead><tbody>";pageData.forEach(function(r,i){var t=new Date(r.created_at*1000).toLocaleString("zh-CN");var shortUrl=r.url&&r.url.length>30?r.url.substring(0,30)+"...":r.url;var idx=start+i;h+="<tr><td>"+escapeHtml(t)+"</td><td style=\\"max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\\" title=\\""+escapeHtml(r.url)+"\\">"+escapeHtml(shortUrl)+"</td><td style=\\"max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\\" title=\\""+escapeHtml(r.file_name)+"\\">"+escapeHtml(r.file_name||"-")+"</td><td>"+(r.from_cache?"<span style=\\"color:#4fc3f7\\">缓存</span>":"<span style=\\"color:#66bb6a\\">解析</span>")+"</td><td>"+(r.success?"<span class=\\"badge badge-yes\\">成功</span>":"<span class=\\"badge badge-no\\">失败</span>")+"</td><td><button class=\\"action-btn\\" style=\\"background:#4fc3f7;color:#fff;border:none;padding:2px 8px;border-radius:4px;font-size:11px;cursor:pointer;margin-right:4px\\" onclick=\\"viewRecord("+idx+")\\">查看</button><button class=\\"action-btn action-btn-delete\\" data-id=\\""+r.id+"\\" onclick=\\"deleteRecord(this.dataset.id)\\">删除</button></td></tr>";});h+="</tbody></table>";c.innerHTML=h;var ph="";if(pages>1){ph+="<div style=\\"display:flex;align-items:center;justify-content:center;gap:6px;margin-top:12px;font-size:12px\\">";ph+="<button class=\\"btn btn-sm\\" style=\\"padding:2px 8px;font-size:11px\\" onclick=\\"goRecordsPage(1)\\" "+(window._recordsPage<=1?"disabled":"")+">首页</button>";ph+="<button class=\\"btn btn-sm\\" style=\\"padding:2px 8px;font-size:11px\\" onclick=\\"goRecordsPage("+(window._recordsPage-1)+")\\" "+(window._recordsPage<=1?"disabled":"")+">上一页</button>";ph+="<span style=\\"color:#aaa\\">"+window._recordsPage+"/"+pages+"</span>";ph+="<button class=\\"btn btn-sm\\" style=\\"padding:2px 8px;font-size:11px\\" onclick=\\"goRecordsPage("+(window._recordsPage+1)+")\\" "+(window._recordsPage>=pages?"disabled":"")+">下一页</button>";ph+="<button class=\\"btn btn-sm\\" style=\\"padding:2px 8px;font-size:11px\\" onclick=\\"goRecordsPage("+pages+")\\" "+(window._recordsPage>=pages?"disabled":"")+">末页</button>";ph+="</div>";}document.getElementById("recordsPager").innerHTML=ph;}',
        'window.viewRecord=function(idx){var all=window._recordsAll||[];var filtered=all;if(window._recordsFilter==="success")filtered=all.filter(function(r){return r.success;});else if(window._recordsFilter==="failed")filtered=all.filter(function(r){return !r.success;});var r=filtered[idx];if(!r)return;var t=new Date(r.created_at*1000).toLocaleString("zh-CN");var h="<div style=\\"background:rgba(255,255,255,0.05);border-radius:8px;padding:12px;margin-bottom:12px\\">";h+="<div style=\\"margin-bottom:8px\\"><span style=\\"color:#888;font-size:11px\\">时间</span><br>"+escapeHtml(t)+"</div>";h+="<div style=\\"margin-bottom:8px\\"><span style=\\"color:#888;font-size:11px\\">链接</span><br><span style=\\"word-break:break-all\\">"+escapeHtml(r.url)+"</span></div>";if(r.pwd)h+="<div style=\\"margin-bottom:8px\\"><span style=\\"color:#888;font-size:11px\\">密码</span><br>"+escapeHtml(r.pwd)+"</div>";h+="<div style=\\"margin-bottom:8px\\"><span style=\\"color:#888;font-size:11px\\">类型</span><br>"+escapeHtml(r.type)+"</div>";if(r.file_name)h+="<div style=\\"margin-bottom:8px\\"><span style=\\"color:#888;font-size:11px\\">文件名</span><br>"+escapeHtml(r.file_name)+"</div>";if(r.file_size)h+="<div style=\\"margin-bottom:8px\\"><span style=\\"color:#888;font-size:11px\\">文件大小</span><br>"+escapeHtml(r.file_size)+"</div>";if(r.download_url)h+="<div style=\\"margin-bottom:8px\\"><span style=\\"color:#888;font-size:11px\\">下载链接</span><br><span style=\\"word-break:break-all\\">"+escapeHtml(r.download_url)+"</span></div>";h+="<div style=\\"margin-bottom:8px\\"><span style=\\"color:#888;font-size:11px\\">返回类型</span><br>"+(r.from_cache?"缓存":"解析")+"</div>";h+="<div style=\\"margin-bottom:8px\\"><span style=\\"color:#888;font-size:11px\\">状态</span><br>"+(r.success?"<span style=\\"color:#66bb6a\\">成功</span>":"<span style=\\"color:#ef5350\\">失败</span>")+"</div>";if(r.msg)h+="<div style=\\"margin-bottom:8px\\"><span style=\\"color:#888;font-size:11px\\">原因</span><br><span style=\\"color:#ef5350\\">"+escapeHtml(r.msg)+"</span></div>";h+="</div>";h+="<div><span style=\\"color:#888;font-size:11px\\">JSON</span><br><pre style=\\"background:rgba(0,0,0,0.3);border-radius:6px;padding:10px;font-size:11px;overflow-x:auto;color:#aaa;white-space:pre-wrap;word-break:break-all\\">"+escapeHtml(JSON.stringify(r,null,2))+"</pre></div>";document.getElementById("recordDetail").innerHTML=h;document.getElementById("recordModal").style.display="flex";};',
        'window.goRecordsPage=function(p){window._recordsPage=p;renderRecords();};',
        'function loadRecords(){apiGet("/api/admin/records").then(function(d){if(!d.success)return;window._recordsAll=d.data||[];window._recordsPage=1;renderRecords();}).catch(function(){});}',
        'window.deleteRecord=function(id){if(!confirm("确定要删除此记录吗？"))return;apiPost("/api/admin/delete-record",{id:id}).then(function(resp){if(resp.success){showMsg(document.getElementById("adminMsg"),"\\u2705 删除成功","success");loadRecords();loadStats();}else{showMsg(document.getElementById("adminMsg"),"\\u274c "+(resp.msg||"删除失败"),"error");}}).catch(function(){showMsg(document.getElementById("adminMsg"),"\\u274c 网络错误","error");});};',
        'document.getElementById("clearStatsBtn").addEventListener("click",function(){if(!confirm("确定要重置所有统计数据吗？此操作不可恢复！"))return;apiPost("/api/admin/clear-stats").then(function(resp){if(resp.success){showMsg(document.getElementById("adminMsg"),"\\u2705 统计已重置","success");loadStats();}else{showMsg(document.getElementById("adminMsg"),"\\u274c "+(resp.msg||"重置失败"),"error");}}).catch(function(){showMsg(document.getElementById("adminMsg"),"\\u274c 网络错误","error");});});',
        'document.getElementById("clearRecordsBtn").addEventListener("click",function(){if(!confirm("确定要清空所有解析记录吗？此操作不可恢复！"))return;apiPost("/api/admin/clear-records").then(function(resp){if(resp.success){showMsg(document.getElementById("adminMsg"),"\\u2705 记录已清空","success");loadRecords();loadStats();}else{showMsg(document.getElementById("adminMsg"),"\\u274c "+(resp.msg||"清空失败"),"error");}}).catch(function(){showMsg(document.getElementById("adminMsg"),"\\u274c 网络错误","error");});});',
        'document.getElementById("logoutBtn").addEventListener("click",function(){adminToken="";document.cookie="admin_token=;path=/;max-age=0";document.getElementById("adminPage").style.display="none";document.getElementById("loginPage").style.display="block";});',
        'document.getElementById("closeRecordModal").addEventListener("click",function(){document.getElementById("recordModal").style.display="none";});',
        'document.getElementById("recordModal").addEventListener("click",function(e){if(e.target===this)this.style.display="none";});',
        'var _adminRefreshTimer=null;',
        'function startAdminRefresh(){if(_adminRefreshTimer)clearInterval(_adminRefreshTimer);_adminRefreshTimer=setInterval(function(){if(document.getElementById("adminPage").style.display!=="none"){loadStats();loadRecords();}},5000);}',
        'function stopAdminRefresh(){if(_adminRefreshTimer){clearInterval(_adminRefreshTimer);_adminRefreshTimer=null;}}',
        'var _origShowAdmin=showAdminPage;showAdminPage=function(){_origShowAdmin();startAdminRefresh();};',
        'document.getElementById("logoutBtn").addEventListener("click",stopAdminRefresh);',
        'if(adminToken){apiGet("/api/admin/stats").then(function(d){if(d.success)showAdminPage();}).catch(function(){});}',
        '</' + 'script>',
        '</body></html>'
    ];
    return S.join('\n');
}

export default {
    async fetch(request, env, ctx) {
        const db = env[DB_NAME];
        if (db) {
            try { await dbInit(db); } catch (e) { console.log('[DB] 初始化失败:', e.message); }
        }

        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,POST,HEAD,OPTIONS', 'Access-Control-Allow-Headers':'*', 'Access-Control-Max-Age':'2592000' }
            });
        }

        const url = new URL(request.url);

        if (url.pathname === '/admin') {
            return htmlResponse(getAdminHtml());
        }

        if (url.pathname === '/api/admin/login') {
            let params = {};
            if (request.method === 'POST') {
                const fd = await request.formData();
                for (const [k, v] of fd) params[k] = v;
            }
            const username = params.username || '';
            const password = params.password || '';
            const envAdmin = env.admin || '';
            const envPass = env.pass || '';
            if (!envAdmin || !envPass) return jsonResponse({ success: false, msg: '后台未配置管理员账号' });
            if (username !== envAdmin || password !== envPass) return jsonResponse({ success: false, msg: '用户名或密码错误' });
            const token = generateAdminToken(envAdmin, envPass);
            return jsonResponse({ success: true, token });
        }

        if (url.pathname.startsWith('/api/admin/')) {
            const tokenHeader = request.headers.get('X-Admin-Token') || '';
            const tokenCookie = getAdminCookie(request);
            const token = tokenHeader || tokenCookie;
            if (!token || !verifyAdminToken(token, env)) return jsonResponse({ success: false, msg: '未授权，请重新登录' }, 401);

            if (url.pathname === '/api/admin/stats') {
                if (!db) return jsonResponse({ success: false, msg: '数据库未配置' });
                const stats = await statsGet(db);
                return jsonResponse({ success: true, data: stats });
            }

            if (url.pathname === '/api/admin/records') {
                if (!db) return jsonResponse({ success: false, msg: '数据库未配置' });
                const records = await recordsGet(db);
                return jsonResponse({ success: true, data: records });
            }

            if (url.pathname === '/api/admin/delete-record') {
                if (!db) return jsonResponse({ success: false, msg: '数据库未配置' });
                let params = {};
                if (request.method === 'POST') {
                    const fd = await request.formData();
                    for (const [k, v] of fd) params[k] = v;
                }
                const id = params.id || '';
                if (!id) return jsonResponse({ success: false, msg: '缺少记录ID' });
                try {
                    await db.prepare('DELETE FROM parse_records WHERE id = ?').bind(id).run();
                    return jsonResponse({ success: true, msg: '删除成功' });
                } catch (e) {
                    return jsonResponse({ success: false, msg: '删除失败: ' + e.message });
                }
            }

            if (url.pathname === '/api/admin/clear-stats') {
                if (!db) return jsonResponse({ success: false, msg: '数据库未配置' });
                try {
                    await db.prepare('UPDATE parse_stats SET total = 0, success = 0, failed = 0, cached = 0 WHERE id = 1').run();
                    return jsonResponse({ success: true, msg: '统计已重置' });
                } catch (e) {
                    return jsonResponse({ success: false, msg: '重置失败: ' + e.message });
                }
            }

            if (url.pathname === '/api/admin/clear-records') {
                if (!db) return jsonResponse({ success: false, msg: '数据库未配置' });
                try {
                    await db.prepare('DELETE FROM parse_records').run();
                    return jsonResponse({ success: true, msg: '记录已清空' });
                } catch (e) {
                    return jsonResponse({ success: false, msg: '清空失败: ' + e.message });
                }
            }

            return jsonResponse({ success: false, msg: '未知管理接口' }, 404);
        }

        if (url.pathname === '/api/login') {
            let params = {};
            if (request.method === 'POST') {
                const fd = await request.formData();
                for (const [k, v] of fd) params[k] = v;
            }
            const username = params.username || '';
            const password = params.password || '';
            if (!username || !password) return jsonResponse({ success: false, msg: '请输入账号和密码' });
            try {
                const result = await login(username, password);
                return jsonResponse(result);
            } catch (e) {
                return jsonResponse({ success: false, msg: '登录异常: ' + e.message });
            }
        }

        if (url.pathname === '/api/dirs') {
            let params = {};
            if (request.method === 'POST') {
                const fd = await request.formData();
                for (const [k, v] of fd) params[k] = v;
            }
            const phpsessid = params.PHPSESSID || '';
            const ylogin = params.ylogin || '';
            const phpdiskInfo = params.phpdisk_info || '';
            const folderId = params.folder_id || '-1';
            if (!phpsessid || !ylogin || !phpdiskInfo) return jsonResponse({ success: false, msg: '请填写完整的 Cookie 信息' });
            try {
                const cookie = buildCookieStr(phpsessid, ylogin, phpdiskInfo);
                const checkResp = await fetch('https://pc.woozooo.com/mydisk.php', {
                    method: 'GET',
                    headers: { ...lanzouHeaders(cookie), 'Accept': 'text/html' },
                    redirect: 'manual'
                });
                if (checkResp.status === 302 || checkResp.status === 301 || checkResp.status === 0) {
                    return jsonResponse({ success: false, msg: 'Cookie 无效或已过期，请重新获取' });
                }
                const dirs = await getDirList(phpsessid, ylogin, phpdiskInfo, parseInt(folderId));
                if (dirs === null) return jsonResponse({ success: false, msg: 'Cookie 无效或已过期，请重新获取' });
                return jsonResponse({ success: true, dirs });
            } catch (e) {
                return jsonResponse({ success: false, msg: 'Cookie 无效或已过期: ' + e.message });
            }
        }

        if (url.pathname === '/api/files') {
            let params = {};
            if (request.method === 'POST') {
                const fd = await request.formData();
                for (const [k, v] of fd) params[k] = v;
            }
            const phpsessid = params.PHPSESSID || '';
            const ylogin = params.ylogin || '';
            const phpdiskInfo = params.phpdisk_info || '';
            const folderId = params.folder_id || '-1';
            if (!phpsessid || !ylogin || !phpdiskInfo) return jsonResponse({ success: false, msg: '请填写完整的 Cookie 信息' });
            try {
                const files = await getFileList(phpsessid, ylogin, phpdiskInfo, parseInt(folderId));
                return jsonResponse({ success: true, files });
            } catch (e) {
                return jsonResponse({ success: false, msg: '获取文件列表失败: ' + e.message });
            }
        }

        if (url.pathname === '/api/upload') {
            let params = {};
            let uploadFile = null;
            if (request.method === 'POST') {
                const fd = await request.formData();
                for (const [k, v] of fd) {
                    if (k === 'file' && v instanceof File) { uploadFile = v; }
                    else { params[k] = v; }
                }
            }
            const phpsessid = params.PHPSESSID || '';
            const ylogin = params.ylogin || '';
            const phpdiskInfo = params.phpdisk_info || '';
            const folderId = params.folder_id || '-1';
            if (!phpsessid || !ylogin || !phpdiskInfo) return jsonResponse({ success: false, msg: '请填写完整的 Cookie 信息' });
            if (!uploadFile) return jsonResponse({ success: false, msg: '请选择要上传的文件' });
            try {
                const result = await uploadFileAndShare(phpsessid, ylogin, phpdiskInfo, uploadFile, parseInt(folderId));
                return jsonResponse(result);
            } catch (e) {
                return jsonResponse({ success: false, msg: '上传失败: ' + e.message });
            }
        }

        if (url.pathname === '/api/share') {
            let params = {};
            if (request.method === 'POST') {
                const fd = await request.formData();
                for (const [k, v] of fd) params[k] = v;
            }
            const phpsessid = params.PHPSESSID || '';
            const ylogin = params.ylogin || '';
            const phpdiskInfo = params.phpdisk_info || '';
            const fid = params.fid || '';
            const isFile = (params.is_file || '1') === '1';
            if (!phpsessid || !ylogin || !phpdiskInfo) return jsonResponse({ success: false, msg: '请填写完整的 Cookie 信息' });
            if (!fid) return jsonResponse({ success: false, msg: '请填写文件ID' });
            try {
                const result = await getShareInfo(phpsessid, ylogin, phpdiskInfo, fid, isFile);
                return jsonResponse(result);
            } catch (e) {
                return jsonResponse({ success: false, msg: '获取分享信息失败: ' + e.message });
            }
        }

        if (url.pathname === '/api/delete') {
            let params = {};
            if (request.method === 'POST') {
                const fd = await request.formData();
                for (const [k, v] of fd) params[k] = v;
            }
            const phpsessid = params.PHPSESSID || '';
            const ylogin = params.ylogin || '';
            const phpdiskInfo = params.phpdisk_info || '';
            const fid = params.fid || '';
            const isFile = (params.is_file || '1') === '1';
            if (!phpsessid || !ylogin || !phpdiskInfo) return jsonResponse({ success: false, msg: '请填写完整的 Cookie 信息' });
            if (!fid) return jsonResponse({ success: false, msg: '请填写文件ID' });
            try {
                const result = await deleteFileOrFolder(phpsessid, ylogin, phpdiskInfo, fid, isFile);
                return jsonResponse({ success: result, msg: result ? '删除成功' : '删除失败' });
            } catch (e) {
                return jsonResponse({ success: false, msg: '删除失败: ' + e.message });
            }
        }

        if (url.pathname === '/api/parse' || (url.searchParams.get('action') === 'parse')) {
            let params = {};
            if (request.method === 'POST') {
                const fd = await request.formData();
                for (const [k, v] of fd) params[k] = v;
            }
            const targetUrl = params.url || url.searchParams.get('url') || '';
            const pwd = params.pwd || url.searchParams.get('pwd') || '';

            if (!targetUrl) return jsonResponse({ success: false, msg: '请输入分享链接' });

            const isIlanzou = /ilanzou\.com/i.test(targetUrl);
            const isLanzou = /lanzou[a-z]{0,2}\.com/i.test(targetUrl);
            if (!isIlanzou && !isLanzou) return jsonResponse({ success: false, msg: '无法识别的链接' });

            if (db) {
                const cached = await cacheGet(db, targetUrl, pwd);
                if (cached) {
                    await statsUpdate(db, 'cached');
                    cached.from_cache = true;
                    const now = Math.floor(Date.now() / 1000);
                    const expiresAt = cached._expires_at || 0;
                    delete cached._expires_at;
                    cached.expires_in = expiresAt > now ? expiresAt - now : 0;
                    await recordAdd(db, targetUrl, pwd, isIlanzou ? 'ilanzou' : 'lanzou', cached.success, cached.file_name || '', cached.download_url || '', cached.file_size || '', true, cached.msg || '');
                    return jsonResponse(cached);
                }
            }

            let result;
            try {
                result = isIlanzou ? await parseIlanzou(targetUrl, pwd) : await parseLanzou(targetUrl, pwd);
            } catch (e) {
                result = { success: false, msg: '解析异常: ' + e.message };
            }

            if (db) {
                if (result.success) {
                    await statsUpdate(db, 'success');
                    result.expires_in = CACHE_TTL;
                    await cacheSet(db, targetUrl, pwd, result);
                } else {
                    await statsUpdate(db, 'failed');
                }
                await recordAdd(db, targetUrl, pwd, isIlanzou ? 'ilanzou' : 'lanzou', result.success, result.file_name || '', result.download_url || '', result.file_size || '', result.from_cache ? true : false, result.msg || '');
                try { ctx.waitUntil(cacheCleanup(db)); } catch (e) {}
            } else {
                if (result.success) result.expires_in = CACHE_TTL;
            }

            return jsonResponse(result);
        }

        if (url.pathname === '/api/parse_folder_file') {
            let params = {};
            if (request.method === 'POST') {
                const fd = await request.formData();
                for (const [k, v] of fd) params[k] = v;
            }
            const fileId = params.file_id || '';
            const domain = params.domain || 'www.lanzoui.com';

            if (!fileId) return jsonResponse({ success: false, msg: '缺少文件ID' });

            if (db) {
                const cacheKey = `folder_file:${fileId}`;
                const cached = await cacheGet(db, cacheKey, '');
                if (cached) {
                    cached.from_cache = true;
                    const now = Math.floor(Date.now() / 1000);
                    const expiresAt = cached._expires_at || 0;
                    delete cached._expires_at;
                    cached.expires_in = expiresAt > now ? expiresAt - now : 0;
                    await recordAdd(db, `https://${domain}/${fileId}`, '', 'lanzou', cached.success, cached.file_name || '', cached.download_url || '', cached.file_size || '', true, cached.msg || '');
                    return jsonResponse(cached);
                }
            }

            let result;
            try {
                const shareUrl = `https://${domain}/${fileId}`;
                result = await parseLanzou(shareUrl, '');
            } catch (e) {
                result = { success: false, msg: '解析异常: ' + e.message };
            }

            if (result.success) {
                result.expires_in = CACHE_TTL;
                if (db) {
                    const cacheKey = `folder_file:${fileId}`;
                    await cacheSet(db, cacheKey, '', result);
                }
            }

            return jsonResponse(result);
        }

        if (url.pathname === '/api/stats' || url.searchParams.get('action') === 'stats') {
            if (!db) return jsonResponse({ success: false, msg: '数据库未配置' });
            const stats = await statsGet(db);
            return jsonResponse({ success: true, data: stats });
        }

        if (url.pathname === '/api/records' || url.searchParams.get('action') === 'records') {
            if (!db) return jsonResponse({ success: false, msg: '数据库未配置' });
            const records = await recordsGet(db);
            return jsonResponse({ success: true, data: records });
        }

        if (url.pathname === '/' || url.pathname === '') {
            const qUrl = url.searchParams.get('url') || '';
            const qPwd = url.searchParams.get('pwd') || '';
            const qType = url.searchParams.get('type') || '';

            if (qUrl) {
                const isIlanzou = /ilanzou\.com/i.test(qUrl);
                const isLanzou = /lanzou[a-z]{0,2}\.com/i.test(qUrl);
                if (!isIlanzou && !isLanzou) return jsonResponse({ success: false, msg: '无法识别的链接' });

                if (db) {
                    const cached = await cacheGet(db, qUrl, qPwd);
                    if (cached) {
                        await statsUpdate(db, 'cached');
                        cached.from_cache = true;
                        const now = Math.floor(Date.now() / 1000);
                        const expiresAt = cached._expires_at || 0;
                        delete cached._expires_at;
                        cached.expires_in = expiresAt > now ? expiresAt - now : 0;
                        await recordAdd(db, qUrl, qPwd, isIlanzou ? 'ilanzou' : 'lanzou', cached.success, cached.file_name || '', cached.download_url || '', cached.file_size || '', true, cached.msg || '');
                        if (qType === 'json') return jsonResponse(cached);
                        if (cached.download_url) return Response.redirect(cached.download_url, 302);
                        return jsonResponse({ success: false, msg: '未获取到下载链接，无法跳转' });
                    }
                }

                let result;
                try {
                    result = isIlanzou ? await parseIlanzou(qUrl, qPwd) : await parseLanzou(qUrl, qPwd);
                } catch (e) {
                    result = { success: false, msg: '解析异常: ' + e.message };
                }

                if (db) {
                    if (result.success) {
                        await statsUpdate(db, 'success');
                        result.expires_in = CACHE_TTL;
                        await cacheSet(db, qUrl, qPwd, result);
                    } else {
                        await statsUpdate(db, 'failed');
                    }
                    await recordAdd(db, qUrl, qPwd, isIlanzou ? 'ilanzou' : 'lanzou', result.success, result.file_name || '', result.download_url || '', result.file_size || '', result.from_cache ? true : false, result.msg || '');
                    try { ctx.waitUntil(cacheCleanup(db)); } catch (e) {}
                } else {
                    if (result.success) result.expires_in = CACHE_TTL;
                }

                if (qType === 'json') return jsonResponse(result);
                if (result.success && result.download_url) return Response.redirect(result.download_url, 302);
                return jsonResponse(result);
            }

            const stats = db ? await statsGet(db) : { total: 0, success: 0, failed: 0, cached: 0 };
            return htmlResponse(getFrontendHtml(stats));
        }

        return jsonResponse({ success: false, msg: '未知路由' }, 404);
    }
};
