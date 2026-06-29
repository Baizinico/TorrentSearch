/**
 * Provider 公共工具
 * 对应原 Kotlin：TorrentUtils + FileSizeUtils + TorrentDateParser
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { isCategoryNSFW, type Category } from '../types.js';

dayjs.extend(utc);
dayjs.extend(customParseFormat);

/** 公共 tracker 列表（来自 ngosang/trackerslist trackers_best） */
export const PUBLIC_TRACKERS: readonly string[] = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonoid.ch:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker2.dler.org:80/announce',
  'udp://tracker.qu.ax:6969/announce',
  'udp://tracker.filemail.com:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://tracker.0x7c0.com:6969/announce',
  'udp://tracker-udp.gbitt.info:80/announce',
  'udp://run.publictracker.xyz:6969/announce',
  'udp://retracker01-msk-virt.corbina.net:80/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'udp://opentracker.io:6969/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://leet-tracker.moe:1337/announce',
];

const MAGNET_URI_PREFIX = 'magnet:?xt=urn:btih:';

/** 从 magnet URI 提取 info hash（小写） */
export function parseInfoHashFromMagnet(magnetUri: string): string {
  if (!magnetUri.startsWith(MAGNET_URI_PREFIX)) {
    throw new Error(`Can't extract info hash from '${magnetUri}'`);
  }
  const rest = magnetUri.slice(MAGNET_URI_PREFIX.length);
  const end = rest.indexOf('&');
  return (end === -1 ? rest : rest.slice(0, end)).toLowerCase().trim();
}

/** 用 info hash + 公共 trackers 构造 magnet URI */
export function createMagnetUri(infoHash: string): string {
  const trParams = PUBLIC_TRACKERS.map((t) => `tr=${t}`).join('&');
  return `${MAGNET_URI_PREFIX}${infoHash}&${trParams}`;
}

/**
 * 将相对 URL 解析为绝对 URL（替代 Jsoup 的 abs:href 语义）。
 * href 为空或已是绝对 URL 时原样返回（解析失败也回退原值）。
 */
export function resolveUrl(href: string | undefined | null, baseUrl: string): string {
  if (!href) return '';
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

// ============== 文件大小工具 ==============

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const TB = GB * 1024;
const PB = TB * 1024;

/** 在数字与字母间插入空格：`1.2MB` → `1.2 MB` */
export function normalizeSize(size: string): string {
  let out = '';
  for (let i = 0; i < size.length; i++) {
    out += size[i];
    if (i < size.length - 1 && /\d/.test(size[i]) && /[a-zA-Z]/.test(size[i + 1])) {
      out += ' ';
    }
  }
  return out;
}

/** 字节数 → pretty 字符串：formatBytes(1610612736) → "1.50 GB" */
export function formatBytes(bytes: number): string {
  let value: number;
  let unit: string;
  if (bytes >= PB) {
    value = bytes / PB;
    unit = 'PB';
  } else if (bytes >= TB) {
    value = bytes / TB;
    unit = 'TB';
  } else if (bytes >= GB) {
    value = bytes / GB;
    unit = 'GB';
  } else if (bytes >= MB) {
    value = bytes / MB;
    unit = 'MB';
  } else if (bytes >= KB) {
    value = bytes / KB;
    unit = 'KB';
  } else {
    return `0.00 B`;
  }
  return `${value.toFixed(2)} ${unit}`;
}

/** pretty 字符串 → 字节数：parseBytes("1.2 GB") → 1288490188.8 */
export function parseBytes(formattedSize: string): number {
  const [value, unit] = getSizeValueAndUnit(formattedSize);
  const valueNum = parseFloat(value);
  if (Number.isNaN(valueNum)) return 0;
  switch (unit) {
    case 'PB':
    case 'PiB':
      return valueNum * PB;
    case 'TB':
    case 'TiB':
      return valueNum * TB;
    case 'GB':
    case 'GiB':
      return valueNum * GB;
    case 'MB':
    case 'MiB':
      return valueNum * MB;
    case 'KB':
    case 'KiB':
      return valueNum * KB;
    default:
      return 0;
  }
}

function getSizeValueAndUnit(formattedSize: string): [string, string] {
  // 含空格：直接 split
  if (formattedSize.includes(' ')) {
    const parts = formattedSize.split(' ');
    return [parts[0], parts.slice(1).join(' ')];
  }
  // 不含空格（如 1.2MB）：找首个字母位置
  let unitStartIndex = -1;
  for (let i = 0; i < formattedSize.length; i++) {
    if (/[a-zA-Z]/.test(formattedSize[i])) {
      unitStartIndex = i;
      break;
    }
  }
  if (unitStartIndex === -1) {
    // 无单位，回退 KB
    return [formattedSize, 'KB'];
  }
  return [formattedSize.slice(0, unitStartIndex), formattedSize.slice(unitStartIndex)];
}

// ============== 日期解析工具 ==============

const RELATIVE_TIME_PATTERN =
  /(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months|y|yr|yrs|year|years)\b\s*(ago)?\b/i;

const RUSSIAN_MONTH_MAP: Record<string, string> = {
  Янв: 'Jan',
  Фев: 'Feb',
  Мар: 'Mar',
  Апр: 'Apr',
  Май: 'May',
  Июн: 'Jun',
  Июл: 'Jul',
  Авг: 'Aug',
  Сен: 'Sep',
  Окт: 'Oct',
  Ноя: 'Nov',
  Дек: 'Dec',
};

/** 俄文月份 → 英文：`"02 Окт 26"` → `"02 Oct 26"` */
export function convertRussianMonthToEnglish(date: string): string {
  const parts = date.split(' ');
  if (parts.length < 3) return date;
  const [day, russianMonth, ...rest] = parts;
  const englishMonth = RUSSIAN_MONTH_MAP[russianMonth] ?? russianMonth;
  return [day, englishMonth, ...rest].join(' ');
}

/**
 * 通用日期解析：按指定格式（dayjs token）解析，返回 ISO 字符串。
 * 失败返回 null。先按含时间解析，失败回退纯日期。
 */
export function parseDate(date: string, format: string): string | null {
  // 尝试含时间解析
  const dt = dayjs.utc(date, format, true);
  if (dt.isValid()) return dt.toISOString();
  // 回退：纯日期，时间补 00:00
  const d = dayjs.utc(date, format, true);
  if (d.isValid()) return d.startOf('day').toISOString();
  return null;
}

/** 解析相对时间：`"5 minutes ago"` / `"2 days ago"` / `"today"` / `"yesterday"` */
export function tryParseRelative(date: string): string | null {
  // 去除尾部 "+"
  const cleaned = date.replace(/\+$/, '').trim();

  const special = tryParseSpecialRelative(cleaned);
  if (special) return special;

  const match = cleaned.match(RELATIVE_TIME_PATTERN);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  if (Number.isNaN(value)) return null;
  const unit = match[2].toLowerCase();

  let durationMs = 0;
  const sec = 1000;
  const min = sec * 60;
  const hour = min * 60;
  const day = hour * 24;
  switch (unit) {
    case 's':
    case 'sec':
    case 'secs':
    case 'second':
    case 'seconds':
      durationMs = value * sec;
      break;
    case 'm':
    case 'min':
    case 'mins':
    case 'minute':
    case 'minutes':
      durationMs = value * min;
      break;
    case 'h':
    case 'hr':
    case 'hrs':
    case 'hour':
    case 'hours':
      durationMs = value * hour;
      break;
    case 'd':
    case 'day':
    case 'days':
      durationMs = value * day;
      break;
    case 'w':
    case 'wk':
    case 'wks':
    case 'week':
    case 'weeks':
      durationMs = value * day * 7;
      break;
    case 'mo':
    case 'mos':
    case 'month':
    case 'months':
      durationMs = value * day * 30;
      break;
    case 'y':
    case 'yr':
    case 'yrs':
    case 'year':
    case 'years':
      durationMs = value * day * 365;
      break;
    default:
      return null;
  }
  return new Date(Date.now() - durationMs).toISOString();
}

/** 特殊相对词：today / just now / yesterday / last week 等 */
export function tryParseSpecialRelative(date: string): string | null {
  switch (date.toLowerCase()) {
    case 'today':
    case 'just now':
    case 'moments ago':
      return new Date().toISOString();
    case 'yesterday': {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString();
    }
    case 'last week':
      return new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    case 'last month':
      return new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    case 'last year':
      return new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    default:
      return null;
  }
}

/** 解析时间格式 `h:m a`（如 `12:45 PM`），用当天日期补全 */
export function tryParseTime(time: string): string | null {
  const dt = dayjs.utc(time, 'h:m a', true);
  if (!dt.isValid()) return null;
  const today = dayjs.utc().startOf('day');
  return today
    .hour(dt.hour())
    .minute(dt.minute())
    .second(0)
    .millisecond(0)
    .toISOString();
}

/** Unix 秒 → ISO 字符串 */
export function epochSecondToISO(second: number): string {
  return new Date(second * 1000).toISOString();
}

/** ISO 8601 字符串解析（如 `2025-06-11T06:13:57+00:00`） */
export function parseIso(date: string): string {
  return new Date(date).toISOString();
}

/** RFC 1123 字符串解析（如 `Wed, 02 Oct 2002 ...`），取当天 0 点 UTC */
export function parseRFC1123(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** 今天 UTC 0 点 ISO */
export function getTodayDate(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** 昨天 UTC 0 点 ISO */
export function getYesterdayDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** 当前 UTC 年份 */
export function getCurrentYear(): number {
  return new Date().getUTCFullYear();
}

// ============== Torrent 构造辅助 ==============

/**
 * 构造一个 Torrent 对象，自动填充 isNSFW 派生字段。
 * 提供给 provider 调用，避免重复样板代码。
 */
export function makeTorrent(input: {
  infoHash: string;
  name: string;
  size: string;
  seeders: number;
  peers: number;
  providerName: string;
  providerId: string;
  uploadDate: string | null;
  category: Category | null;
  descriptionPageUrl: string;
  magnetUri?: string | null;
  fileDownloadLink?: string | null;
}): import('../types.js').Torrent {
  return {
    infoHash: input.infoHash,
    name: input.name,
    size: input.size,
    seeders: input.seeders,
    peers: input.peers,
    providerName: input.providerName,
    providerId: input.providerId,
    uploadDate: input.uploadDate,
    category: input.category,
    descriptionPageUrl: input.descriptionPageUrl,
    magnetUri: input.magnetUri ?? null,
    fileDownloadLink: input.fileDownloadLink ?? null,
    isNSFW: isCategoryNSFW(input.category),
  };
}

/** 判断 torrent 是否死种（seeders==0 && peers==0） */
export function isDeadTorrent(t: { seeders: number; peers: number }): boolean {
  return t.seeders === 0 && t.peers === 0;
}
