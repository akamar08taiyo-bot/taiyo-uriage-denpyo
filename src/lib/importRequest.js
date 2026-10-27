// 「申請書・見積書作成」（太陽ポータルの jutaku-mitsumori/・tokutei/）の見積書のタブの「🧾 売上伝票」から受け取る口。
//
// 同じサイト（akamar08taiyo-bot.github.io）なので、送り手はこの端末の localStorage に置いてから
// このアプリを ?from=shinsei で開く。お客様の情報を URL に載せないため（共有リンクと違って、履歴にも残らない）。
// 受け取ったらすぐ消す。古いもの（10分より前）は読まずに消す。
//
// 送る形（送り手：特定福祉用具の src/tokutei/uriage.ts・住宅改修の src/sasaoka/uriage.ts）：
//   { kind: 'taiyo-uriage-request', v: 1, createdAt: ミリ秒, sales: { 共有リンクの sales と同じ項目 ＋ welfare } }
// 形を変えるときは、受け取る側（このアプリ）を先に公開する。

import { isValidDateString } from './businessDate.js'

export const IMPORT_KEY = 'taiyo-uriage-import-v1'
export const IMPORT_KIND = 'taiyo-uriage-request'
export const IMPORT_MAX_AGE = 10 * 60 * 1000

/** ?from=shinsei で開いたか */
export function openedFromShinsei(search) {
  return new URLSearchParams(search || '').get('from') === 'shinsei'
}

/**
 * 置いてある依頼を取り出して消す。使えるものなら sales（項目を確かめたもの）、なければ null。
 * store は localStorage（テストでは代わりのもの）
 */
export function takeImportRequest(store, now = Date.now()) {
  let raw = null
  try {
    raw = store.getItem(IMPORT_KEY)
    if (raw !== null) store.removeItem(IMPORT_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || data.kind !== IMPORT_KIND || data.v !== 1 || !data.sales || typeof data.sales !== 'object') return null
  const age = now - Number(data.createdAt)
  if (!Number.isFinite(age) || age < -60 * 1000 || age > IMPORT_MAX_AGE) return null
  return cleanSales(data.sales)
}

const CARE_LEVELS = ['支援１', '支援２', '介護１', '介護２', '介護３', '介護４', '介護５']
const str = (v) => (typeof v === 'string' ? v : '')
const yen = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0
}

/** 受け取った sales の項目を、このアプリの形にそろえる（知らない項目・おかしな値は捨てる） */
export function cleanSales(s) {
  const out = {}
  if (s.serviceType === 'housing' || s.serviceType === 'specific') out.serviceType = s.serviceType
  if (isValidDateString(s.issueDate)) out.issueDate = s.issueDate
  for (const k of ['salesOffice', 'staff', 'customerName', 'customerAddress', 'officeName', 'careManager', 'contractor']) {
    if (typeof s[k] === 'string') out[k] = s[k].trim()
  }
  if (s.customerType === 'new' || s.customerType === 'existing') out.customerType = s.customerType
  if (s.billingType === 'receipt' || s.billingType === 'reimbursement') out.billingType = s.billingType
  if (CARE_LEVELS.includes(s.careLevel)) out.careLevel = s.careLevel
  if ([0.1, 0.2, 0.3].includes(s.userRatio)) out.userRatio = s.userRatio
  if (typeof s.remaining === 'number' && Number.isFinite(s.remaining) && s.remaining >= 0) out.remaining = Math.round(s.remaining)
  if (Array.isArray(s.items)) {
    const items = s.items
      .filter((it) => it && typeof it === 'object')
      .map((it) => ({ amount: yen(it.amount), cost: yen(it.cost), productName: str(it.productName).trim(), color: str(it.color).trim() }))
      .filter((it) => it.amount > 0)
    if (items.length) out.items = items
  }
  for (const k of ['miyakoChecked', 'showDetail', 'isSelfPay', 'welfare']) {
    if (typeof s[k] === 'boolean') out[k] = s[k]
  }
  if (Array.isArray(s.categories)) out.categories = s.categories.filter((c) => typeof c === 'string' && c.trim())
  return out
}
