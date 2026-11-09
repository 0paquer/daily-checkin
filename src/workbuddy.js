'use strict';

/**
 * workbuddy.js — WorkBuddy 每日签到模块
 * ------------------------------------------------------------------
 * 读取本机 WorkBuddy 登录态票据（endpoint.json），通过 wbipc 命名管道完成
 * 带认证的会话，再用受控 HTTP 代理（wb.request/http.fetch，host 自动注入登录态）
 * 调用后端签到接口 POST /v2/billing/meter/daily-checkin。
 *
 * 特点：零依赖 / 零配置 / 不提取不重放任何 token / 幂等 / 可移植。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { connect } = require('./wbipc');
const { log } = require('./common');

// ------------------------------------------------------------------
// 退出码
// ------------------------------------------------------------------
const EXIT = {
  OK: 0,
  BUSINESS: 1,
  NO_AUTH: 2,
  CONNECT: 3,
  CALL: 4,
};

const CHECKIN_PATH = '/v2/billing/meter/daily-checkin';
const STATUS_PATH = '/v2/billing/meter/checkin-activity-status'; // 可选；部分版本 404，不影响签到

// ------------------------------------------------------------------
// 配置与发现
// ------------------------------------------------------------------
function findEndpointFile() {
  if (process.env.WBIP_ENDPOINT_FILE) return process.env.WBIP_ENDPOINT_FILE;
  const candidates = [];
  if (process.env.WORKBUDDY_HOME) {
    candidates.push(path.join(process.env.WORKBUDDY_HOME, 'wbipc', 'endpoint.json'));
  }
  candidates.push(path.join(os.homedir(), '.workbuddy', 'wbipc', 'endpoint.json'));
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, '.workbuddy', 'wbipc', 'endpoint.json'));
  }
  candidates.push(path.join(os.homedir(), 'AppData', 'Roaming', '.workbuddy', 'wbipc', 'endpoint.json'));
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (_) { /* ignore */ }
  }
  return candidates[0];
}

// 直连模式：同时提供管道与票据，跳过读取 endpoint.json
const RAW_ENDPOINT = process.env.WBIP_ENDPOINT || null;
const RAW_TICKET = process.env.WBIP_TICKET || null;

/** 给错误附加 code 字段（供 CLI 决定退出码）。 */
function withCode(err, code) {
  err.code = code;
  return err;
}

// ------------------------------------------------------------------
// 核心签到流程（库友好：返回结果对象，不直接退出进程）
// ------------------------------------------------------------------
async function runCheckin(opts = {}) {
  let endpoint, ticket;

  if (RAW_ENDPOINT && RAW_TICKET) {
    endpoint = RAW_ENDPOINT; ticket = RAW_TICKET;
  } else {
    const file = opts.endpointFile || findEndpointFile();
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) {
      throw withCode(new Error(`无法读取登录态文件 ${file}：${e.message}`), EXIT.NO_AUTH);
    }
    endpoint = raw.endpoint; ticket = raw.ticket;
    if (!endpoint || !ticket) {
      throw withCode(new Error('endpoint.json 缺少 endpoint 或 ticket 字段'), EXIT.NO_AUTH);
    }
  }

  if (opts.check) {
    log(`[WorkBuddy] [自检] 登录态文件有效（endpoint: ${endpoint}，ticket: ${ticket.slice(0, 6)}...，未发起连接）✅`);
    return [{ name: 'WorkBuddy', ok: true, already: true, message: '自检通过' }];
  }

  const session = await connect(endpoint, ticket).catch((e) =>
    Promise.reject(withCode(e, EXIT.CONNECT)));

  try {
    // 查询活动状态：--status 时打印；成长中心也复用同一请求，失败则忽略。
    let activity = null;
    if (opts.status) {
      try {
        const st = await session.httpFetch('GET', STATUS_PATH);
        log(`[WorkBuddy] [状态] HTTP ${st.status} ${JSON.stringify(st.body)}`);
        if (st.status === 200 && st.body) activity = st.body;
      } catch (e) {
        log(`[WorkBuddy] [状态] 查询失败（忽略）: ${e.message}`);
      }
    }

    const res = await session.httpFetch('POST', CHECKIN_PATH);
    const { status: httpStatus, body } = res;

    let result;
    if (httpStatus === 200 && (body === null || body.code === 0 || body.code === undefined)) {
      result = { ok: true, code: EXIT.OK, message: '签到成功', status: httpStatus, body };
    } else if (body && body.code === 10001) {
      result = { ok: true, code: EXIT.OK, message: '今日已签到', status: httpStatus, body };
    } else if (httpStatus >= 200 && httpStatus < 300) {
      result = { ok: true, code: EXIT.OK, message: `HTTP ${httpStatus}`, status: httpStatus, body };
    } else {
      const err = withCode(new Error(`接口异常 HTTP ${httpStatus}`), EXIT.BUSINESS);
      err.detail = body;
      throw err;
    }

    if (activity) result.activity = activity;
    log(`[WorkBuddy] [OK] ${result.message} ✅ ${(result.body && (result.body.msg || (result.body.data && JSON.stringify(result.body.data)))) || ''}`);
    return [{ name: 'WorkBuddy', ...result }];
  } finally {
    session.close();
  }
}

module.exports = {
  name: 'workbuddy',
  label: 'WorkBuddy',
  runCheckin,
  findEndpointFile,
  EXIT,
  CHECKIN_PATH,
  STATUS_PATH,
};
