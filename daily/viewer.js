'use strict';
const get=async u=>{const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw Error('取得失敗');return r.json()};
const el=id=>document.getElementById(id);
const labels={Core:'AP-X Core',Aggressive:'AP-X Aggressive',LeadingCandidate:'LeadingCandidate'};
const models={};
const selected=()=>Object.hasOwn(labels,location.hash.slice(1))?location.hash.slice(1):'Core';
const number=(v,d=2)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(d):'—';
const append=(parent,tag,text)=>{const node=document.createElement(tag);node.textContent=text;parent.append(node);return node};

function show(){
 const model=selected(),data=models[model];
 for(const name of Object.keys(labels)){
  const button=el('tab-'+name);button.className=name===model?'active':'';
  button.setAttribute('aria-selected',String(name===model));
 }
 el('rows').replaceChildren();
 if(!data){el('model-note').textContent=labels[model]+'：保存済みデータを確認中…';return}
 if(data.error){el('model-note').textContent=labels[model]+' UNAVAILABLE：'+data.error;return}
 const query=el('query').value.toLowerCase();
 const rows=data.rows.filter(s=>(s.code+' '+s.name).toLowerCase().includes(query));
 el('model-note').textContent=labels[model]+' ／ 評価日 '+data.day+' ／ '+data.label+
  ' ／ '+(model==='Core'?'全公開銘柄':'上位'+data.rows.length+'銘柄（順位対象'+data.rankedCount+'銘柄）')+
  ' ／ 表示 '+rows.length+'件'+(data.predictedAt?' ／ 予測保存 '+data.predictedAt:'')+
  (data.otherDay?' ／ 日次Coreとは評価日が異なる保存済み予測です':'');
 for(const s of rows){
  const tr=document.createElement('tr');
  for(const value of [s.rank??'—',s.code+' '+s.name,number(s.score??s.coreScore),
   typeof s.confidence==='number'?number(s.confidence*100,1)+'%':'—'])append(tr,'td',value);
  const decision=append(tr,'td',s.executionDecision||'—');
  if(['BUY','WAIT','AVOID','UNAVAILABLE'].includes(s.executionDecision))decision.className=s.executionDecision;
  const cell=document.createElement('td');
  const reasons=Array.isArray(s.executionReasons)?s.executionReasons:[];
  const components=s.components&&typeof s.components==='object'?s.components:null;
  if(reasons.length||components){
   const details=document.createElement('details');append(details,'summary','理由・因子');
   for(const reason of reasons)append(details,'p',String(reason));
   if(components)append(details,'pre',JSON.stringify(components,null,2));
   cell.append(details);
  }else cell.textContent='—';
  tr.append(cell);el('rows').append(tr);
 }
}
for(const name of Object.keys(labels))el('tab-'+name).onclick=()=>{location.hash=name;show()};
el('query').oninput=show;
window.addEventListener('hashchange',show);
show();

async function experiments(o){
 try{
  let reference=o;
  if(o.publicationMode!=='FORMAL'){
   const formal=await get('../formal/latest.json');
   if(formal.status!=='FORMAL'||!formal.evaluationDate||formal.evaluationDate>o.evaluationDate||
      !/^[A-Za-z0-9_.-]+$/.test(formal.sourceRunId))throw Error('正式予測の参照先を確認できません');
   reference={sourceRunId:formal.sourceRunId,evaluationDate:formal.evaluationDate,
    artifacts:{validation:'formal/runs/'+formal.sourceRunId+'/validation.json'}};
  }
  if(!reference.artifacts.validation)throw Error('保存済み予測の参照先がありません');
  const v=await get('../'+reference.artifacts.validation);
  if(v.sourceRunId!==reference.sourceRunId||v.evaluationDate!==reference.evaluationDate||
     v.liveOrderAuthorized!==false)throw Error('保存済み予測の評価日・run IDが一致しません');
  for(const name of ['Aggressive','LeadingCandidate']){
   const m=v.models?.[name];
   models[name]=m&&Array.isArray(m.stocks)?{rows:m.stocks,rankedCount:m.rankedCount,day:v.evaluationDate,
    predictedAt:m.predictedAt,label:'EXPERIMENTAL・保存済み予測',otherDay:v.evaluationDate!==o.evaluationDate}:
    {error:'この評価日のモデル出力がありません'};
  }
 }catch(error){
  for(const name of ['Aggressive','LeadingCandidate'])models[name]={error:'保存済みランキングを取得・検証できません'};
 }
 show();
}

Promise.all([get('../operations/latest.json'),get('../operations/calendar.json')]).then(async([o,c])=>{
 const j=new Date(Date.now()+9*3600000);j.setUTCDate(j.getUTCDate()-1);let expected;
 for(;;){expected=j.toISOString().slice(0,10);if(j.getUTCDay()>0&&j.getUTCDay()<6&&!c.closed_dates.includes(expected))break;j.setUTCDate(j.getUTCDate()-1)}
 const fresh=expected===o.evaluationDate&&expected>=c.first_date&&expected<=c.last_date;
 el('fresh').textContent=(fresh?'日次評価 FRESH':'日次評価 STALE')+' ／ 期待日 '+expected+' ／ 実データ '+o.evaluationDate;
 if(fresh)el('fresh').className='ok';
 const q=o.coverage;el('state').textContent='配信 '+o.publicationMode+' ／ 品質率 '+(q.highConfidenceRatio*100).toFixed(4)+'% ('+q.highConfidenceCount+'/'+q.includedCount+') ／ conflicts '+q.unresolvedConflicts+' ／ 正式最終日 '+o.formalState.evaluationDate+' ／ 正式未達理由 '+(o.formalEligibility.reasons.join('、')||'なし');
 el('clock').textContent='価格日 '+o.priceAsOf+' ／ 開示締切 '+o.disclosureCutoff+' ／ 更新08:45・再試行09:15・外部検査09:37 JST。朝スキャン推奨09:40。';
 const r=await get('../'+o.artifacts.ranking);
 if(r.sourceRunId!==o.sourceRunId||(r.asOf??r.evaluationDate)!==o.evaluationDate||!Array.isArray(r.stocks))throw Error('ランキングの評価日・run ID不一致');
 models.Core={rows:r.stocks,day:o.evaluationDate,label:'配信 '+o.publicationMode};show();
 await experiments(o);
 try{
  const h=await get('https://raw.githubusercontent.com/sn1572-poco/apx-public-json/apx-monitor-state/health.json');
  const age=Date.now()-Date.parse(h.checkedAt),matching=h.sourceRunId===o.sourceRunId&&h.evaluationDate===expected;
  el('monitor').textContent='外部監視 '+(age>90*60000?'STALE（監視未実行の可能性）':!matching?'PENDING / STALE（当該runは未確認）':h.status)+' ／ '+h.checkedAt+' ／ '+(h.issues||[]).join('、');
 }catch{el('monitor').textContent='外部監視 UNAVAILABLE：更新・監視の正常性を確認できません'}
}).catch(()=>{
 el('fresh').className='';el('fresh').textContent='STALE / UNAVAILABLE：データ取得または整合性検証に失敗。最新ランキングとして利用できません';
 for(const name of Object.keys(labels))models[name]={error:'日次評価の整合性を確認できません'};
 show();
});
