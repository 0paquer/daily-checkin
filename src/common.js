'use strict';

/**
 * common.js — 各平台签到共享的通用能力
 *   日志（统一写入一个文件，自动脱敏）、日期工具、
 *   按平台分开记录的连续签到统计（含旧版单平台历史文件迁移）。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = process.env.CHECKIN_DIR || path.join(os.homedir(), '.daily-checkin');
const LOG_FILE = process.env.CHECKIN_LOG || path.join(DATA_DIR, 'checkin.log');
const HISTORY_FILE = process.env.CHECKIN_HISTORY || path.join(DATA_DIR, 'checkin-history.json');

// 旧版单平台项目的历史文件位置（迁移用）
const LEGACY_HISTORY_FILES = {
  trae: process.env.TRAE_CHECKIN_HISTORY || path.join(os.homedir(), '.trae-checkin', 'checkin-history.json'),
  workbuddy: process.env.WBIP_CHECKIN_HISTORY || path.join(os.homedir(), '.workbuddy', 'wbipc', 'checkin-history.json'),
};

// ------------------------------------------------------------------
// 日志
// ------------------------------------------------------------------
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) { /* 忽略日志写入失败 */ }
  console.log(line);
}

/** token 脱敏展示（仅供日志），绝不输出完整 token。 */
function mask(token) {
  return token ? `${token.slice(0, 6)}...${token.slice(-4)}` : '(empty)';
}

// ------------------------------------------------------------------
// 日期工具
// ------------------------------------------------------------------
function ymd(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function dayDiff(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000);
}

// ------------------------------------------------------------------
// 连续签到统计（按平台分开记录）
// ------------------------------------------------------------------
function loadPlatformDates(platform) {
  const dates = new Set();
  // 统一历史文件：{ "trae": {"dates": [...]}, "workbuddy": {"dates": [...]} }
  try {
    const j = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    const p = j && j[platform];
    if (p && Array.isArray(p.dates)) p.dates.forEach((d) => dates.add(d));
  } catch (_) { /* ignore */ }
  // 兼容旧版单平台历史文件（首次迁移，旧数据不丢）
  try {
    const legacy = LEGACY_HISTORY_FILES[platform];
    if (legacy) {
      const j = JSON.parse(fs.readFileSync(legacy, 'utf8'));
      if (j && Array.isArray(j.dates)) j.dates.forEach((d) => dates.add(d));
    }
  } catch (_) { /* ignore */ }
  return dates;
}

function savePlatformDates(platform, set) {
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) || {};
  } catch (_) { /* ignore */ }
  all[platform] = { dates: [...set].sort() };
  try {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(all, null, 2));
  } catch (_) { /* ignore */ }
}

function computeStreak(dates) {
  const arr = [...dates].sort();
  const today = ymd(new Date());
  const valid = arr.filter((d) => dayDiff(d, today) >= 0);
  const total = valid.length;
  if (total === 0) return { total: 0, current: 0, longest: 0 };
  let longest = 1, run = 1;
  for (let i = 1; i < valid.length; i++) {
    const diff = dayDiff(valid[i - 1], valid[i]);
    if (diff === 1) { run++; if (run > longest) longest = run; }
    else if (diff > 1) { run = 1; }
  }
  let current = 0;
  const last = valid[valid.length - 1];
  if (dayDiff(last, today) <= 1) {
    current = 1;
    const idx = arr.indexOf(last);
    for (let i = idx; i > 0; i--) {
      if (dayDiff(arr[i - 1], arr[i]) === 1) current++;
      else break;
    }
  }
  return { total, current, longest };
}

/** 记录当天签到并返回成长中心统计。 */
function recordStreak(platform, signedToday) {
  const dates = loadPlatformDates(platform);
  if (signedToday) {
    dates.add(ymd(new Date()));
    savePlatformDates(platform, dates);
  }
  return computeStreak(dates);
}

module.exports = {
  DATA_DIR, LOG_FILE, HISTORY_FILE,
  log, mask, ymd, dayDiff,
  loadPlatformDates, savePlatformDates, computeStreak, recordStreak,
};
