#!/usr/bin/env node
/**
 * AI 桌面工具每日自动签到（统一入口）
 * ------------------------------------------------------------------
 * 整合 Trae CN / TRAE SOLO CN 与 WorkBuddy 两个平台的每日积分签到：
 *   - 各平台模块独立（src/trae.js、src/workbuddy.js），共享通用能力（src/common.js）
 *   - 全部零依赖（仅 Node.js 内置模块），零配置，幂等安全
 *   - 连续签到统计按平台分开记录，兼容旧版单平台项目的历史数据
 *
 * 用法：
 *   node checkin.js                # 全部平台签到（默认）
 *   node checkin.js trae           # 只签 Trae CN / TRAE SOLO CN
 *   node checkin.js workbuddy      # 只签 WorkBuddy
 *   node checkin.js trae --check   # 自检：发现账号并解密，不联网
 *   node checkin.js --status       # 签到并查询状态/积分
 *   node checkin.js --json         # 机器可读输出
 *   node checkin.js --no-stats     # 关闭连续天数统计
 *
 * 统一退出码：0=全部成功/已签；1=部分或全部失败；2=无任何登录态。
 */

'use strict';

const common = require('./src/common');
const trae = require('./src/trae');
const workbuddy = require('./src/workbuddy');

const PLATFORMS = { trae, workbuddy };
const { log } = common;

// ------------------------------------------------------------------
// 参数解析
// ------------------------------------------------------------------
function parseArgs(argv) {
  const a = argv || process.argv.slice(2);
  const opts = {
    platform: 'all',
    status: a.includes('--status') || a.includes('-s'),
    json: a.includes('--json') || a.includes('-j'),
    noStats: a.includes('--no-stats') || a.includes('-S') || process.env.TRAE_NO_STATS === '1',
    check: a.includes('--check'),
  };
  const positional = a.filter((x) => !x.startsWith('-'));
  if (positional.length > 0) {
    const p = positional[0].toLowerCase();
    if (p !== 'all' && !PLATFORMS[p]) {
      console.error(`未知平台「${p}」，可选：all | ${Object.keys(PLATFORMS).join(' | ')}`);
      process.exit(2);
    }
    opts.platform = p;
  }
  return opts;
}

// ------------------------------------------------------------------
// 主流程
// ------------------------------------------------------------------
async function run(opts) {
  const targets = opts.platform === 'all'
    ? Object.values(PLATFORMS)
    : [PLATFORMS[opts.platform]];

  log(`=== AI 每日签到开始（${targets.map((m) => m.name).join(' + ')}）===`);

  const all = []; // { platform, results, streak }
  let anyResults = false;
  let anyFail = false;

  for (const mod of targets) {
    let results = [];
    try {
      results = await mod.runCheckin({ status: opts.status, check: opts.check });
    } catch (e) {
      log(`[${mod.label}] [FAIL] ${e.message}`);
      results = [{ name: mod.label, ok: false, message: e.message, code: e.code }];
    }

    const platformSigned = results.some((r) => r.ok);
    if (results.length > 0) anyResults = true;
    if (!platformSigned) anyFail = true;

    const entry = { platform: mod.name, results };
    if (!opts.noStats && results.length > 0) {
      try {
        entry.streak = common.recordStreak(mod.name, platformSigned);
        const s = entry.streak;
        log(`[${mod.label}] [成长中心] 累计签到 ${s.total} 天 ｜ 当前连续 ${s.current} 天 ｜ 最长连续 ${s.longest} 天`);
      } catch (_) { /* 统计失败不影响签到结果 */ }
    }
    all.push(entry);
  }

  log(`=== 签到结束（${all.filter((e) => e.results.some((r) => r.ok)).length}/${all.length} 个平台正常）===`);

  if (opts.json) {
    console.log(JSON.stringify({
      ok: anyResults && !anyFail,
      platforms: all,
      logFile: common.LOG_FILE,
      historyFile: common.HISTORY_FILE,
    }, null, 2));
  }

  if (!anyResults) {
    log('[FAIL] 未找到任何平台的登录态，请先在本机登录对应客户端');
    return 2;
  }
  return anyFail ? 1 : 0;
}

if (require.main === module) {
  run(parseArgs()).then((code) => process.exit(code));
}

module.exports = { run, parseArgs, PLATFORMS };
