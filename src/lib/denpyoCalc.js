// 売上伝票の負担額の計算。画面・印刷・PDF で同じ結果を使う。
//
// 1円未満：利用者負担は切り上げ、保険者負担は「保険対象金額 − 利用者負担」（切り下げと同じ）。
// 負担割合は 0.1 のような小数をかけず、1・2・3 の整数で計算する
// （前は Math.floor(対象 × (1 − 0.3)) で、3割のとき 90円 → 62円 のように1円少なくなることがあった。
//   申請書・見積書作成の特定福祉用具の calc.ts と同じ計算にそろえる）。
//
// 生活保護（介護扶助）：利用者の自己負担は出さない。負担割合の分は「介護扶助」として別に出す
// （ユーザーの指示「生活保護にチェックしたら自己負担は出さない」2026-10-27）。

/** 0.1・0.2・0.3（や 1・2・3）を 1・2・3 の整数にする */
export function ratioTenths(userRatio) {
  const n = Number(userRatio)
  if (!Number.isFinite(n) || n <= 0) return 0
  const tenths = n < 1 ? Math.round(n * 10) : Math.round(n)
  return Math.min(10, Math.max(0, tenths))
}

export function calculate({ items, total, remaining, userRatio, miyako, isSelfPay, welfare = false }) {
  const r = ratioTenths(userRatio)
  // 介護保険残高が未入力（空欄）のときは支給限度額の超過なしとして計算する。
  // 超過しそうな場合だけ残高を入力してもらう運用に合わせている。
  const hasRemaining = remaining !== '' && remaining !== null && remaining !== undefined
  const effRemaining = isSelfPay ? 0 : (hasRemaining ? Number(remaining) || 0 : total)
  const insuranceCovered = Math.max(0, Math.min(total, effRemaining))
  const excess = Math.max(0, total - insuranceCovered)
  let share
  if (miyako) {
    // 個別切り上げ（明細ごとに切り上げて足す）
    share = (items || []).reduce((s, it) => s + Math.ceil(((Number(it.amount) || 0) * r) / 10), 0)
    share = Math.min(share, insuranceCovered)
  } else {
    share = Math.ceil((insuranceCovered * r) / 10)
  }
  const insurerBurden = Math.max(0, insuranceCovered - share)
  const userBurden = welfare ? 0 : share
  const aid = welfare ? share : 0
  return { total, insuranceCovered, excess, userBurden, aid, insurerBurden, totalUserBurden: userBurden + excess }
}
