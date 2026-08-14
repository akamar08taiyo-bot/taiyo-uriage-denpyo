// 金額の共通パーサと、出力（印刷・PDF・共有・メール）前の共通バリデータ。
//
// 指示書 COMMON-02 / URI-02 / URI-03 に対応。
// - 負数・小数円・非数・無限大を状態に入れない
// - 有効な明細が無い、合計が0以下の伝票を出力させない
// - 印刷・PDF・共有・メールで同じ検証結果を使う

/** 円の入力値を「非負の有限整数」に正規化する。解釈できない値は 0。 */
export function parseYen(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return 0
    return Math.max(0, Math.round(input))
  }
  if (typeof input !== 'string') return 0
  const trimmed = input.trim()
  if (trimmed === '') return 0
  // 全角数字・全角マイナス・桁区切りを吸収する
  const normalized = trimmed
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[，,]/g, '')
    .replace(/[－ー−]/g, '-')
  const value = Number(normalized)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value))
}

/** 金額として妥当か（非負の有限整数か）。表示中の値の検査に使う。 */
export function isValidYen(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isInteger(value)
}

/**
 * 伝票を出力してよいかを判定する。副作用は持たない。
 * 戻り値の errors は利用者にそのまま見せる日本語の文言。
 */
export function validateDenpyoForOutput({ staff, customerName, items, total, remaining }) {
  const errors = []

  if (!String(staff || '').trim()) errors.push('担当者')
  if (!String(customerName || '').trim()) errors.push('顧客名')

  const list = Array.isArray(items) ? items : []
  if (list.some((item) => !isValidYen(item?.amount))) {
    errors.push('金額に使えない値（マイナス・小数など）が入っています')
  }
  if (list.some((item) => item?.cost != null && !isValidYen(item.cost))) {
    errors.push('仕切りに使えない値（マイナス・小数など）が入っています')
  }
  if (!list.some((item) => isValidYen(item?.amount) && item.amount > 0)) {
    errors.push('金額が入った明細が1件も入力されていません')
  }
  if (!isValidYen(total) || total <= 0) {
    errors.push('売上金額の合計が0円です')
  }

  const hasRemaining = remaining !== '' && remaining !== null && remaining !== undefined
  if (hasRemaining && !isValidYen(parseYenStrict(remaining))) {
    errors.push('介護保険残高に使えない値が入っています')
  }

  return { ok: errors.length === 0, errors }
}

// 残高は「未入力」と「0」を区別する必要があるため、丸めずにそのまま検査する。
function parseYenStrict(input) {
  const value = typeof input === 'number' ? input : Number(String(input).trim())
  if (!Number.isFinite(value)) return -1
  return Number.isInteger(value) ? value : -1
}
