'use strict';
// Read-only client clock: a sleeping PC cannot suppress this stale warning.
function apxStaleMessage(value, now = new Date()) {
  const c = value.tradingCalendar;
  if (!c) return '警告：取引日カレンダーがなく、ランキングの鮮度を検証できません。';
  const today = new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
  if (today < c.first_date || today > c.last_date) return '警告：取引日カレンダーの検証範囲外です。';
  let d = new Date(today+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()-1);
  while (d.toISOString().slice(0,10) >= c.first_date) {
    const day = d.toISOString().slice(0,10);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !c.closed_dates.includes(day)) {
      return value.evaluationDate < day ? `警告：公開ランキングは ${value.evaluationDate} 基準です。直近の完了済み取引日 ${day} へ更新されていません。最後のFORMALを表示しています。` : '';
    }
    d.setUTCDate(d.getUTCDate()-1);
  }
  return '警告：直近取引日を検証できません。';
}
async function apxPublicHealth() {
  const banner = document.getElementById('apx-data-health');
  if (!banner) return;
  try {
    const responses = await Promise.all([fetch('./latest.json',{cache:'no-cache'}),fetch('./data/research/validation.json',{cache:'no-cache'})]);
    if (responses.some(r=>!r.ok)) throw new Error('HTTP_FAILED');
    const [latest, research] = await Promise.all(responses.map(r=>r.json()));
    if (latest.status !== 'FORMAL' || latest.sourceRunId !== research.sourceRunId || latest.evaluationDate !== research.evaluationDate) throw new Error('RUN_MISMATCH');
    const refresh = ()=>{banner.textContent = apxStaleMessage(research);banner.hidden=!banner.textContent;};
    refresh();setInterval(refresh,60000);
  } catch (_) {banner.hidden=false;banner.textContent='警告：最新データの整合性・鮮度を確認できません。';}
}
apxPublicHealth();
