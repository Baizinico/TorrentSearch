/**
 * 种子排序与过滤工具
 */

import type { SortCriteria, SortOrder, Torrent } from '../types';

/** 比较函数：按排序字段+方向 */
export function compareTorrents(
  a: Torrent,
  b: Torrent,
  criteria: SortCriteria,
  order: SortOrder,
): number {
  const dir = order === 'Ascending' ? 1 : -1;
  let cmp = 0;
  switch (criteria) {
    case 'Name':
      cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      break;
    case 'Seeders':
      cmp = a.seeders - b.seeders;
      break;
    case 'Peers':
      cmp = a.peers - b.peers;
      break;
    case 'FileSize': {
      cmp = parseBytesToNumber(a.size) - parseBytesToNumber(b.size);
      break;
    }
    case 'Date': {
      const ta = a.uploadDate ? Date.parse(a.uploadDate) : 0;
      const tb = b.uploadDate ? Date.parse(b.uploadDate) : 0;
      cmp = ta - tb;
      break;
    }
  }
  // 主键相等时按 seeders 降序作为稳定 tiebreaker
  if (cmp === 0) cmp = b.seeders - a.seeders;
  return cmp * dir;
}

/** 排序数组（不修改原数组） */
export function sortTorrents(
  torrents: readonly Torrent[],
  criteria: SortCriteria,
  order: SortOrder,
): Torrent[] {
  return [...torrents].sort((a, b) => compareTorrents(a, b, criteria, order));
}

/** 过滤选项 */
export interface FilterOptions {
  /** 隐藏死种（seeders === 0 && peers === 0） */
  hideDead?: boolean;
  /** 隐藏已浏览（按 infoHash） */
  hideViewed?: boolean;
  /** 已浏览的 infoHash 集合 */
  viewedIds?: ReadonlySet<string>;
  /** 名称过滤（子串，大小写不敏感） */
  nameFilter?: string;
  /** provider id 过滤（白名单，空表示不过滤） */
  providerIds?: ReadonlySet<string>;
  /** 类别过滤（白名单，空表示不过滤） */
  categories?: ReadonlySet<string>;
}

/** 应用过滤 */
export function filterTorrents(
  torrents: readonly Torrent[],
  opts: FilterOptions,
): Torrent[] {
  const nameLower = opts.nameFilter?.trim().toLowerCase();
  return torrents.filter((t) => {
    if (opts.hideDead && t.seeders === 0 && t.peers === 0) return false;
    if (opts.hideViewed && opts.viewedIds?.has(t.infoHash)) return false;
    if (nameLower && !t.name.toLowerCase().includes(nameLower)) return false;
    if (opts.providerIds && opts.providerIds.size > 0 && !opts.providerIds.has(t.providerId))
      return false;
    if (opts.categories && opts.categories.size > 0) {
      if (!t.category || !opts.categories.has(t.category)) return false;
    }
    return true;
  });
}

/** "1.2 GB" → bytes (number)，用于排序 */
function parseBytesToNumber(size: string): number {
  const match = /^([\d.]+)\s*([KMGTP]?B)?/i.exec(size);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  if (Number.isNaN(value)) return 0;
  const unit = (match[2] ?? 'B').toUpperCase();
  const mult =
    unit === 'PB' ? 1024 ** 5 :
    unit === 'TB' ? 1024 ** 4 :
    unit === 'GB' ? 1024 ** 3 :
    unit === 'MB' ? 1024 ** 2 :
    unit === 'KB' ? 1024 :
    1;
  return value * mult;
}

/** 判断是否死种 */
export function isDeadTorrent(t: Torrent): boolean {
  return t.seeders === 0 && t.peers === 0;
}

/** 格式化相对时间（基于 ISO 字符串） */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return '未知';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '未知';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon} 个月前`;
  const yr = Math.floor(mon / 12);
  return `${yr} 年前`;
}
