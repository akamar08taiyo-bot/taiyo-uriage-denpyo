// 業務日は必ず日本時間（Asia/Tokyo）で判定する。
//
// new Date().toISOString() は UTC を返すため、日本時間の 0:00〜8:59 に使うと
// 前日の日付になる。伝票日付・帳票・集計・ファイル名がすべて1日ずれるため、
// 業務上の「今日」「今月」はこのモジュールからのみ取得すること。
//
// 指示書 COMMON-01 に対応。全アプリで同一内容を配置している。URI-01。

const TOKYO_TIME_ZONE = 'Asia/Tokyo'

const tokyoFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TOKYO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const pad2 = (value) => String(value).padStart(2, '0')
const pad4 = (value) => String(value).padStart(4, '0')

/** 指定時刻を日本時間で見たときの年・月・日を返す。month は 1〜12。 */
export function tokyoParts(date = new Date()) {
  const parts = tokyoFormatter.formatToParts(date)
  const pick = (type) => Number(parts.find((part) => part.type === type)?.value)
  return { year: pick('year'), month: pick('month'), day: pick('day') }
}

/** 年月日から 'YYYY-MM-DD' を作る。 */
export function formatDateString(year, month, day) {
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`
}

/** 任意の Date を日本時間で見た 'YYYY-MM-DD' に変換する。無効な Date は null。 */
export function formatDateInTokyo(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null
  const { year, month, day } = tokyoParts(date)
  return formatDateString(year, month, day)
}

/** 日本時間での業務日を 'YYYY-MM-DD' で返す。 */
export function todayInTokyo(now = new Date()) {
  return formatDateInTokyo(now)
}

/** 日本時間での業務月を 'YYYY-MM' で返す。 */
export function currentBusinessMonth(now = new Date()) {
  const { year, month } = tokyoParts(now)
  return `${pad4(year)}-${pad2(month)}`
}

/**
 * 'YYYY-MM-DD' が実在する日付かを、年月日を生成して往復一致するかで判定する。
 * 2026-02-31 のような存在しない日付、非うるう年の 2月29日 を拒否する。
 */
export function isValidDateString(value) {
  if (typeof value !== 'string') return false
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!matched) return false
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  // Date.UTC は 0〜99 年を 1900 年代に丸めるため、setUTCFullYear で明示的に設定する。
  const probe = new Date(0)
  probe.setUTCFullYear(year, month - 1, day)
  probe.setUTCHours(0, 0, 0, 0)
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() + 1 === month &&
    probe.getUTCDate() === day
  )
}
