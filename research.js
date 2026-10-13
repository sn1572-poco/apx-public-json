'use strict';
// Static read-only companion. All text uses textContent; no server/order API.
const el = id => document.getElementById(id);
const pct = v => typeof v === 'number' ? (v * 100).toFixed(2) + '%' : '検証不能';
const num = v => typeof v === 'number' ? v.toFixed(2) : '—';
let data, model = 'Core';
function text(tag, value, css) { const node = document.createElement(tag); node.textContent = value; if (css) node.className = css; return node; }
function cell(tr, value, css) { tr.append(text('td', value, css)); }
const labels = {Core:'Core（既存）', Aggressive:'Aggressive（実験）', LeadingCandidate:'急上昇・先行検知候補（実験）'};
function freshness(value, now = new Date()) { return apxStaleMessage(value, now); }
function ranking() {
  const m = data.models?.[model]; el('ranking').replaceChildren();
  el('model-note').textContent = m ? `${m.modelVersion} ｜記録 ${m.predictedAt} ｜公開確認 ${m.publishedAt || '未確認（成績評価不可）'} ｜最初の売買可能時刻の下限 ${m.firstTradableAt || '未確定'} ｜独立順位 ${m.rankedCount}件 ｜${m.sourceStatusReason || '同一FORMAL runの保存済み原本から算出'} ｜先頭100件表示` : 'このrunの実験データは利用できません。';
  const query = el('search').value.toLowerCase();
  for (const s of m?.stocks || []) {
    if (!`${s.code} ${s.name}`.toLowerCase().includes(query)) continue;
    const row = document.createElement('tr');
    cell(row,s.rank ?? '—'); cell(row,`${s.code} ${s.name}`); cell(row,num(s.score)); cell(row,pct(s.confidence));
    cell(row,s.rankChange1 == null ? '履歴不足' : (s.rankChange1 > 0 ? '+' : '') + s.rankChange1);
    cell(row,s.rankChange5 == null ? '履歴不足' : (s.rankChange5 > 0 ? '+' : '') + s.rankChange5);
    cell(row,s.executionDecision,s.executionDecision);
    const td = document.createElement('td'), details = document.createElement('details');
    details.append(text('summary',(s.executionReasons || []).join(' / ') || '—'));
    details.append(text('p','構成: ' + Object.entries(s.components || {}).map(([k,v]) => `${k}=${num(v)}`).join(' / ')));
    if (s.missingComponents?.length) details.append(text('p','欠損: ' + s.missingComponents.join(', ')));
    td.append(details); row.append(td); el('ranking').append(row);
  }
  for (const button of el('tabs').children) button.classList.toggle('active',button.dataset.model === model);
}
function performance() {
  el('performance').replaceChildren();
  for (const m of Object.keys(labels)) for (const horizon of [5,10,20]) {
    const s = data.performance?.summaries?.[`${el('origin').value}/${m}/${el('group').value}/${horizon}`];
    if (!s) continue;
    const tr = document.createElement('tr');
    for (const value of [labels[m],horizon + '営業日',`${s.selected}/${s.mature}`,`${s.pending}/${s.unavailable}`,pct(s.meanReturn),pct(s.medianReturn),pct(s.winRate),pct(s.meanTopixExcess),pct(s.worstAdverseExcursion)]) cell(tr,value);
    el('performance').append(tr);
  }
}
async function main() {
  const [r,l] = await Promise.all([fetch('./data/research/validation.json',{cache:'no-cache'}),fetch('./latest.json',{cache:'no-cache'})]);
  if (!r.ok || !l.ok) throw new Error('公開検証データを取得できません。');
  data = await r.json(); const latest = await l.json();
  if (latest.status !== 'FORMAL' || data.status !== 'EXPERIMENTAL' || data.sourceRunId !== latest.sourceRunId || data.evaluationDate !== latest.evaluationDate || data.liveOrderAuthorized !== false) throw new Error('FORMAL runと検証データが一致しないため表示を停止しました。');
  el('metadata').replaceChildren();
  el('freshness').textContent = freshness(data);
  setInterval(()=>{el('freshness').textContent=freshness(data);},60000);
  for (const [k,v] of [['データ基準日',data.evaluationDate],['予測記録日時',data.predictedAt],['公表情報cutoff',data.disclosureCutoff],['成績用価格の最終日',data.outcomePriceAsOf],['成績レポート更新日時',data.generatedAt],['検証ステータス',data.validationStatus],['run ID',data.sourceRunId]]) el('metadata').append(text('p',`${k}: ${v || '不明'}`));
  for (const m of Object.keys(labels)) { const b = text('button',labels[m]); b.dataset.model = m; b.onclick=()=>{model=m;ranking();}; el('tabs').append(b); }
  el('search').oninput=ranking; el('origin').onchange=performance; el('group').onchange=performance;
  const ul = document.createElement('ul');
  for (const s of data.performance?.pairedComparisons || []) ul.append(text('li',`${labels[s.model]} ${s.horizon}営業日: Core差 ${pct(s.meanDeltaVersusCore)} / 同時比較日 ${s.matchedSignalDates} / ${s.status}`));
  el('comparison').append(ul);
  el('quality').append(text('p',`${data.performance?.adoption || '改善不明'}：${data.validationStatus}。本番モデルの置換・注文は無効です。`,'warning'));
  el('quality').append(text('p','TOPIX: ' + (data.performance?.topix?.status || 'UNAVAILABLE')));
  const unavailable = (data.performance?.cohortAvailability || []).filter(c=>c.inputStatus !== 'VERIFIED');
  el('quality').append(text('p',`時点原本を再現できないモデル・評価日: ${unavailable.length}件（欠損を補完していません）`));
  for (const reason of data.performance?.limitations || []) el('quality').append(text('p',reason,'muted'));
  ranking(); performance();
}
main().catch(error=>{el('error').textContent=error.message;el('metadata').textContent='表示停止';});
