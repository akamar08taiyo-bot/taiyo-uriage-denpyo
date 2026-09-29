// 総合計・介護保険残高・負担割合から、利用者負担額・保険者負担額・超過分を計算する。
// 画面・印刷・PDF・共有で同じ結果を使う。
// reimbursement（償還払い）のときは、窓口でいったん全額をお支払いいただくため
// ご利用者お支払い合計＝総合計（保険者負担分は後日払い戻し）とする。
export function calculate({ items, total, remaining, userRatio, miyako, isSelfPay, reimbursement }) {
  // 負担割合は「割」（1〜3）の整数で計算する。0.7 などの小数を掛けると
  // 44,000 × 0.7 = 30799.999… となり、切り下げで保険者負担額が1円少なくなっていた。
  const burdenTenths = Math.round(userRatio * 10)
  const insuranceTenths = 10 - burdenTenths
  // 介護保険残高が未入力（空欄）のときは支給限度額の超過なしとして計算する。
  // 超過しそうな場合だけ残高を入力してもらう運用に合わせている。
  const hasRemaining = remaining !== '' && remaining !== null && remaining !== undefined
  const effRemaining = isSelfPay ? 0 : (hasRemaining ? Number(remaining) || 0 : total)
  const insuranceCovered = Math.min(total, effRemaining)
  const excess = Math.max(0, total - effRemaining)
  let userBurden, insurerBurden
  if (miyako) {
    // 個別切り上げ：保険対象になる部分だけを明細の上から順に割り当て、明細ごとに切り上げる。
    // （限度額を超えた部分は超過分として別に全額負担になるため、ここに含めると二重に計上される）
    let capLeft = insuranceCovered
    userBurden = items.reduce((s, it) => {
      const covered = Math.max(0, Math.min(Number(it.amount) || 0, capLeft))
      capLeft -= covered
      return s + Math.ceil((covered * burdenTenths) / 10)
    }, 0)
    insurerBurden = Math.max(0, insuranceCovered - userBurden)
  } else {
    userBurden = Math.ceil((insuranceCovered * burdenTenths) / 10)
    insurerBurden = Math.floor((insuranceCovered * insuranceTenths) / 10)
  }
  const totalUserBurden = reimbursement && !isSelfPay ? total : userBurden + excess
  const refund = reimbursement && !isSelfPay ? insurerBurden : 0
  return { total, insuranceCovered, excess, userBurden, insurerBurden, totalUserBurden, refund }
}
