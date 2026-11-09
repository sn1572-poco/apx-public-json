'use strict';
const get=async u=>{const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw Error('取得失敗');return r.json()};
const el=id=>document.getElementById(id);
Promise.all([get('../operations/latest.json'),get('../operations/calendar.json')]).then(async([o,c])=>{
 const j=new Date(Date.now()+9*3600000);j.setUTCDate(j.getUTCDate()-1);let expected;
 for(;;){expected=j.toISOString().slice(0,10);if(j.getUTCDay()>0&&j.getUTCDay()<6&&!c.closed_dates.includes(expected))break;j.setUTCDate(j.getUTCDate()-1)}
 const fresh=expected===o.evaluationDate&&expected>=c.first_date&&expected<=c.last_date;
 el('fresh').textContent=(fresh?'日次評価 FRESH':'日次評価 STALE')+' ／ 期待日 '+expected+' ／ 実データ '+o.evaluationDate;
 if(fresh)el('fresh').className='ok';
 const q=o.coverage;el('state').textContent='配信 '+o.publicationMode+' ／ 品質率 '+(q.highConfidenceRatio*100).toFixed(4)+'% ('+q.highConfidenceCount+'/'+q.includedCount+') ／ conflicts '+q.unresolvedConflicts+' ／ 正式最終日 '+o.formalState.evaluationDate+' ／ 正式未達理由 '+(o.formalEligibility.reasons.join('、')||'なし');
 el('clock').textContent='価格日 '+o.priceAsOf+' ／ 開示締切 '+o.disclosureCutoff+' ／ 更新08:45・再試行09:15・外部検査09:37 JST。朝スキャン推奨09:40。';
 const r=await get('../'+o.artifacts.ranking);if(r.sourceRunId!==o.sourceRunId)throw Error('run ID不一致');
 const show=()=>{const t=el('query').value.toLowerCase();el('rows').replaceChildren();for(const s of r.stocks.filter(s=>(s.code+' '+s.name).toLowerCase().includes(t))){const tr=document.createElement('tr');for(const v of [s.rank,s.code+' '+s.name,(s.score??s.coreScore).toFixed(2),(s.confidence*100).toFixed(0)+'%']){const td=document.createElement('td');td.textContent=v;tr.append(td)}el('rows').append(tr)}};el('query').oninput=show;show();
 try{const h=await get('https://raw.githubusercontent.com/sn1572-poco/apx-public-json/apx-monitor-state/health.json');const age=Date.now()-Date.parse(h.checkedAt);const matching=h.sourceRunId===o.sourceRunId&&h.evaluationDate===expected;el('monitor').textContent='外部監視 '+(age>90*60000?'STALE（監視未実行の可能性）':!matching?'PENDING / STALE（当該runは未確認）':h.status)+' ／ '+h.checkedAt+' ／ '+(h.issues||[]).join('、')}
 catch{el('monitor').textContent='外部監視 UNAVAILABLE：更新・監視の正常性を確認できません'}
}).catch(()=>{el('fresh').className='';el('fresh').textContent='STALE / UNAVAILABLE：データ取得または整合性検証に失敗。最新ランキングとして利用できません';el('rows').replaceChildren()});
