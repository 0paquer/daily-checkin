'use strict';

/**
 * trae.js — Trae CN / TRAE SOLO CN 每日签到模块
 * ------------------------------------------------------------------
 * 自动扫描本机 Trae 客户端数据目录，读取并解密加密登录态
 * （storage.json 中的 iCubeAuthInfo 字段），拿到 accessToken 后
 * 直接调用官方签到接口 POST /trae/api/v2/ug/checkin_credits。
 *
 * 特点：零依赖 / 零抓包 / 零配置 / 多账号 / 9074 风控自愈 / 幂等。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { log, mask } = require('./common');

// ------------------------------------------------------------------
// 退出码
// ------------------------------------------------------------------
const EXIT = {
  OK: 0,
  BUSINESS: 1,
  NO_AUTH: 2,
  NETWORK: 3,
  CALL: 4,
};

// ------------------------------------------------------------------
// 配置
// ------------------------------------------------------------------
const API_BASE = process.env.TRAE_API_BASE || 'https://api.trae.cn';
const STATUS_PATH = '/trae/api/v2/ug/checkin_credits/status';
const CLAIM_PATH = '/trae/api/v2/ug/checkin_credits';
const CREDITS_PATH = '/trae/api/v2/pay/user_current_entitlement_list';
const REQ_SOURCE = parseInt(process.env.TRAE_REQ_SOURCE || '1', 10); // 1=Trae CN IDE

// 登录态字段前缀（storage.json 顶层 key）
const AUTH_KEY_PREFIX = 'iCubeAuthInfo://';

// iCube 登录态解密常量（与 Trae 客户端加密格式对应）
const HDR_LEN = 6;
const KEY_LEN = 32;
const HMAC_LEN = 64;
const URE = Buffer.from([82,9,106,213,48,54,165,56,191,64,163,158,129,243,215,251,124,227,57,130,155,47,255,135,52,142,67,68,196,222,233,203,84,123,148,50,166,194,35,61,238,76,149,11,66,250,195,78,8,46,161,102,40,217,36,178,118,91,162,73,109,139,209,37]);
const DRE = Buffer.from([31,221,168,51,136,7,199,49,177,18,16,89,39,128,236,95,96,81,127,169,25,181,74,13,45,229,122,159,147,201,156,239,160,224,59,77,174,42,245,176,200,235,187,60,131,83,153,97,23,43,4,126,186,119,214,38,225,105,20,99,85,33,12,125]);

// 各平台的客户端数据目录名（按顺序扫描）
const APP_DIRS = ['Trae CN', 'TRAE SOLO CN'];
const DATA_ROOTS = (function () {
  const roots = [];
  if (process.env.TRAE_APP_HOME) roots.push(process.env.TRAE_APP_HOME);
  if (process.env.APPDATA) roots.push(process.env.APPDATA);
  if (process.env.HOME) {
    roots.push(path.join(process.env.HOME, 'Library', 'Application Support')); // macOS
    roots.push(path.join(process.env.HOME, '.config')); // Linux
  }
  return [...new Set(roots)];
})();

// 附加目录（分号分隔，可为 storage.json 全路径或应用目录）
const EXTRA_PATHS = (process.env.TRAE_EXTRA_PATHS || '').split(';').filter(Boolean);

// ------------------------------------------------------------------
// 客户端目录与登录态发现
// ------------------------------------------------------------------
function* candidateAppDirs() {
  for (const root of DATA_ROOTS) {
    for (const name of APP_DIRS) yield { name, dir: path.join(root, name) };
  }
  for (const raw of EXTRA_PATHS) {
    const p = path.resolve(raw.replace(/^%APPDATA%/, process.env.APPDATA || ''));
    yield { name: path.basename(p), dir: p };
  }
}

/** 扫描所有客户端 storage.json，返回 [{name, storagePath, appDir}]，按路径去重。 */
function scanStorages() {
  const seen = new Set();
  const out = [];
  for (const { name, dir } of candidateAppDirs()) {
    const storagePath = path.join(dir, 'User', 'globalStorage', 'storage.json');
    const k = storagePath.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    if (fs.existsSync(storagePath)) out.push({ name, storagePath, appDir: dir });
  }
  return out;
}

/** 从 storage.json 顶层找出所有 iCubeAuthInfo 加密串。 */
function extractAuthPayloads(storagePath) {
  const storage = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
  const payloads = [];
  for (const [k, v] of Object.entries(storage)) {
    if (k.startsWith(AUTH_KEY_PREFIX) && typeof v === 'string' && v.length > 32) {
      payloads.push({ key: k, value: v });
    }
  }
  return payloads;
}

/**
 * 解密 iCubeAuthInfo 加密串，返回登录态 JSON（含 token / userRegion）。
 * 加密格式：base64( 6字节头 + 32字节key + AES-128-CBC(HMAC64 + JSON) )
 */
function decryptAuth(b64) {
  const t = Buffer.from(b64, 'base64');
  if (t.length < HDR_LEN + KEY_LEN + 16) throw new Error('加密串长度异常');
  const key = t.subarray(HDR_LEN, HDR_LEN + KEY_LEN);
  const sha = crypto.createHash('sha512').update(key).digest();
  const xor = Buffer.alloc(URE.length);
  for (let i = 0; i < URE.length; i++) xor[i] = URE[i] ^ DRE[i];
  const h = crypto.createHash('sha512').update(Buffer.concat([sha, xor])).digest();
  const decipher = crypto.createDecipheriv('aes-128-cbc', h.subarray(0, 16), h.subarray(16, 32));
  const plain = Buffer.concat([decipher.update(t.subarray(HDR_LEN + KEY_LEN)), decipher.final()]);
  return JSON.parse(plain.subarray(HMAC_LEN).toString('utf8'));
}

/** 从本机收集账号（多客户端扫描、按 token 去重）。 */
function loadAccounts() {
  const accounts = [];
  const seenToken = new Set();
  for (const { name, storagePath, appDir } of scanStorages()) {
    try {
      for (const p of extractAuthPayloads(storagePath)) {
        let auth;
        try { auth = decryptAuth(p.value); }
        catch (e) { log(`[Trae] [跳过] [${name}] 解密 ${p.key} 失败：${e.message}`); continue; }
        if (!auth || !auth.token) continue;
        if (seenToken.has(auth.token)) continue;
        seenToken.add(auth.token);
        const region = (auth.userRegion && auth.userRegion.region) || '';
        accounts.push({ name, token: auth.token, region, appDir });
      }
    } catch (e) {
      log(`[Trae] [跳过] [${name}] 读取 storage.json 失败：${e.message}`);
    }
  }
  return accounts;
}

// ------------------------------------------------------------------
// 设备号发现
// ------------------------------------------------------------------
function deviceIdFromConfig(appDir) {
  try {
    const p = path.join(appDir, 'ahanet', 'tt_net_config.config');
    const m = fs.readFileSync(p, 'utf8').match(/device_id&#\*(\d+)/);
    return m && m[1];
  } catch (_) { return null; }
}

function deviceIdFromLogs(appDir) {
  try {
    const logsDir = path.join(appDir, 'logs');
    const files = fs.readdirSync(logsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(logsDir, d.name, 'main.log'))
      .filter((f) => fs.existsSync(f))
      .map((f) => ({ f, m: fs.statSync(f).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .slice(0, 5);
    for (const { f } of files) {
      const m = fs.readFileSync(f, 'utf8').match(/\[ICDRS\].*?did: (\d+)/);
      if (m) return m[1];
    }
  } catch (_) { /* ignore */ }
  return null;
}

/** 兜底：由 token 派生一个稳定 16 位数字设备号（同一 token 恒定不变）。 */
function stableDeviceId(token) {
  const h = crypto.createHash('sha256').update(`trae-device:${token}`).digest('hex');
  let digits = '';
  for (const ch of h) { if (/[0-9]/.test(ch)) digits += ch; if (digits.length >= 16) break; }
  return digits.padEnd(16, '0').slice(0, 16);
}

function resolveDeviceId(account) {
  return deviceIdFromConfig(account.appDir) ||
    deviceIdFromLogs(account.appDir) ||
    stableDeviceId(account.token);
}

// ------------------------------------------------------------------
// HTTP（Node 内置 https，零依赖）
// ------------------------------------------------------------------
function httpRequest(urlPath, { token, region, deviceId, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(API_BASE + urlPath);
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {
      'Authorization': `Cloud-IDE-JWT ${token}`,
      'Content-Type': 'application/json',
      'x-device-id': deviceId,
      'User-Agent': 'TraeCheckin/1.0',
    };
    if (region) headers['X-User-Region'] = region;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers,
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch (_) { /* 非 JSON 返回 */ }
        resolve({ status: res.statusCode, raw, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时（30s）')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** 兼容 {checked_in:...} 与 {code:0, data:{checked_in:...}} 两种返回格式。 */
function unwrap(resp) {
  if (resp && typeof resp === 'object' && !('checked_in' in resp) &&
      resp.data && typeof resp.data === 'object' && 'checked_in' in resp.data) {
    return resp.data;
  }
  return resp;
}

// ------------------------------------------------------------------
// 签到核心（库友好：返回结果对象）
// ------------------------------------------------------------------
async function checkinAccount(account) {
  const deviceId = resolveDeviceId(account);
  const ctx = { token: account.token, region: account.region, deviceId };
  const base = { name: account.name, deviceId };

  // 1) 查询今日状态（失败不阻断，继续尝试领取）
  let status = null;
  try {
    const st = await httpRequest(STATUS_PATH, { ...ctx, body: { req_source: REQ_SOURCE } });
    if (st.json) status = unwrap(st.json);
    if (status && status.checked_in === true) {
      return { ...base, ok: true, already: true, message: '今日已签到', status };
    }
  } catch (_) { /* 状态查询失败，继续领取 */ }

  // 2) 领取签到（9074 = 设备号风控 → 换稳定派生设备号重试一次）
  const doClaim = async (devId) => httpRequest(CLAIM_PATH, {
    token: account.token, region: account.region, deviceId: devId,
    body: { req_source: REQ_SOURCE },
  });

  let res = await doClaim(deviceId);
  if (res.json && res.json.code === 9074) {
    const fallback = stableDeviceId(account.token);
    if (fallback !== deviceId) {
      log(`[Trae] [${account.name}] 命中设备号风控(9074)，切换派生设备号重试`);
      res = await doClaim(fallback);
    }
  }

  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`接口异常 HTTP ${res.status}`);
    err.code = EXIT.BUSINESS; err.detail = res.raw.slice(0, 500);
    throw err;
  }
  const body = res.json;
  const data = body && body.data && typeof body.data === 'object' ? body.data : body;

  const alreadyMarked = data && (data.checked_in === true ||
    /already|已签/i.test(JSON.stringify(body).slice(0, 300)));
  if (body && (body.code === 0 || body.code === undefined) && !alreadyMarked) {
    return { ...base, ok: true, already: false, message: '签到成功', body };
  }
  if (alreadyMarked) {
    return { ...base, ok: true, already: true, message: '今日已签到', body };
  }
  const err = new Error(`签到失败 code=${body && body.code} msg=${(body && (body.msg || body.message)) || '未知'}`);
  err.code = EXIT.BUSINESS; err.detail = res.raw.slice(0, 500);
  throw err;
}

/** 查询积分余额（尽力而为，失败不影响签到）。 */
async function fetchCredits(account) {
  try {
    const res = await httpRequest(CREDITS_PATH, {
      token: account.token, region: account.region,
      deviceId: resolveDeviceId(account), body: {},
    });
    if (res.status === 200 && res.json) return res.json.data !== undefined ? res.json.data : res.json;
  } catch (_) { /* ignore */ }
  return null;
}

// ------------------------------------------------------------------
// 主流程（模块入口）
// ------------------------------------------------------------------
async function runCheckin(opts = {}) {
  const accounts = loadAccounts();
  if (accounts.length === 0) {
    const err = new Error('未找到任何 Trae 登录态，请先打开 Trae CN / TRAE SOLO CN 登录一次');
    err.code = EXIT.NO_AUTH;
    throw err;
  }

  log(`[Trae] 发现 ${accounts.length} 个账号：${accounts.map((a) => a.name).join(', ')}`);

  if (opts.check) {
    for (const a of accounts) {
      console.log(`- ${a.name} ｜ region: ${a.region || '(空)'} ｜ token: ${mask(a.token)} ｜ 设备号: ${resolveDeviceId(a)}`);
    }
    log('[Trae] [自检] 登录态解密正常（未发起任何网络请求）✅');
    return accounts.map((a) => ({ name: a.name, ok: true, already: true, message: '自检通过' }));
  }

  const results = [];
  for (const account of accounts) {
    try {
      const r = await checkinAccount(account);
      log(`[Trae] [${account.name}] ${r.message} ✅`);
      if (opts.status) {
        const credits = await fetchCredits(account);
        if (credits !== null) {
          log(`[Trae] [${account.name}] [积分] ${JSON.stringify(credits)}`);
          r.credits = credits;
        }
      }
      results.push(r);
    } catch (e) {
      log(`[Trae] [${account.name}] [FAIL] ${e.message}`);
      results.push({ name: account.name, ok: false, message: e.message, detail: e.detail });
    }
  }

  return results;
}

module.exports = {
  name: 'trae',
  label: 'Trae CN / TRAE SOLO CN',
  runCheckin,
  loadAccounts,
  decryptAuth,
  scanStorages,
  resolveDeviceId,
  EXIT,
  API_BASE,
  STATUS_PATH,
  CLAIM_PATH,
};
