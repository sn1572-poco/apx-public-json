"""Public, standard-library-only daily health and dead-man checks."""
from __future__ import annotations
from datetime import datetime,timedelta,time,timezone
from zoneinfo import ZoneInfo
import argparse,hashlib,json,os,sys
from urllib.request import Request,urlopen
from urllib.error import HTTPError

REPO='sn1572-poco/apx-public-json'
API='https://api.github.com/repos/'+REPO
RAW='https://raw.githubusercontent.com/'+REPO+'/'
PAGES='https://sn1572-poco.github.io/apx-public-json/'
JST=ZoneInfo('Asia/Tokyo')

def get(url,*,auth=False):
 headers={'Accept':'application/vnd.github+json','User-Agent':'AP-X-Daily-Health','Cache-Control':'no-cache'}
 if auth and os.environ.get('GITHUB_TOKEN'):headers['Authorization']='Bearer '+os.environ['GITHUB_TOKEN']
 with urlopen(Request(url,headers=headers),timeout=25)as r:return json.load(r)

def expected(now,calendar):
 local=now.astimezone(JST);day=local.date()-timedelta(days=1)
 if not calendar['first_date']<=local.date().isoformat()<=calendar['last_date']:raise ValueError('CALENDAR_OUT_OF_COVERAGE')
 while day.weekday()>4 or day.isoformat()in calendar['closed_dates']:day-=timedelta(days=1)
 return day.isoformat(),(local.date()-timedelta(days=1)).isoformat()+'T23:59:59+09:00'

def validate(ops,latest,ranking,history,*,now,calendar):
 errors=[];target,cutoff=expected(now,calendar)
 rid=ops.get('sourceRunId');mode=ops.get('publicationMode')
 if ops.get('evaluationDate')!=target:errors.append('DAILY_EVALUATION_STALE')
 if any(v.get('sourceRunId')!=rid for v in (latest,ranking,history)):errors.append('MIXED_RUN_IDS')
 if any(v.get('evaluationDate',v.get('asOf'))!=target for v in (latest,ranking,history)):errors.append('MIXED_EVALUATION_DATES')
 if ops.get('priceAsOf')!=target or any(v!=target for v in ops.get('dataDates',{}).values()):errors.append('INPUT_DATE_MISMATCH')
 if ops.get('disclosureCutoff')!=cutoff:errors.append('DISCLOSURE_CUTOFF_MISMATCH')
 c=ops.get('coverage',{});n=c.get('includedCount',0);h=c.get('highConfidenceCount',-1);ratio=c.get('highConfidenceRatio',-1)
 if n<=0 or not 0<=h<=n or abs(ratio-h/n)>1e-12:errors.append('CONFIDENCE_COUNT_MISMATCH')
 if c.get('unresolvedConflicts')!=0:errors.append('UNRESOLVED_CONFLICTS')
 if mode=='FORMAL':
  if ops.get('formalEligibility',{}).get('allowed')is not True or ratio<.95 or latest.get('status')!='FORMAL':errors.append('FORMAL_WITHOUT_ELIGIBILITY')
  if len(ranking.get('stocks',[]))!=n or sum(s.get('confidence',0)>=.85 for s in ranking.get('stocks',[]))!=h:errors.append('FORMAL_POPULATION_MISMATCH')
  if ops.get('forecastPrepared')is not True:errors.append('FORMAL_FORECAST_NOT_PREPARED')
 elif mode=='PROVISIONAL':
  if latest.get('status')!='PROVISIONAL' or not ops.get('formalEligibility',{}).get('reasons'):errors.append('UNEXPLAINED_PROVISIONAL')
 else:errors.append('NO_PUBLIC_DAILY_EVALUATION')
 for name in ('Aggressive','LeadingCandidate'):
  model=history.get('models',{}).get(name,{})
  if model.get('status')!='VERIFIED' or model.get('sourceRunId')!=rid or model.get('evaluationDate')!=target or model.get('count',0)<=0:errors.append(name.upper()+'_HISTORY_NOT_SAVED')
 if ops.get('formalState',{}).get('evaluationDate')!=target and not ops.get('formalEligibility',{}).get('reasons'):errors.append('FORMAL_STALE_WITHOUT_REASON')
 return sorted(set(errors))

def inspect(*,now=None,fetch=get,commit=None):
 now=now or datetime.now(timezone.utc);head=commit or fetch(API+'/commits/main')['sha']
 calendar=fetch(RAW+head+'/operations/calendar.json');local=now.astimezone(JST)
 result={'schemaVersion':'apx-health-2','checkedAt':now.isoformat(),'monitoredCommit':head,'issues':[],
  'runUrl':os.environ.get('APX_MONITOR_RUN_URL'),'status':'FAILED','liveOrderAuthorized':False}
 if local.weekday()>4 or local.date().isoformat()in calendar['closed_dates']:
  return {**result,'status':'NON_TRADING_DAY','expectedEvaluationDate':expected(now,calendar)[0]}
 ops=fetch(RAW+head+'/operations/latest.json');paths=ops['artifacts'];data={}
 for name,path in {'operations':'operations/latest.json',**paths}.items():
  if not isinstance(path,str)or not path.startswith(('operations/','formal/','provisional/'))or '..'in path.split('/'):raise ValueError('MONITOR_PATH_NOT_ALLOWED')
  github=ops if name=='operations' else fetch(RAW+head+'/'+path)
  public=fetch(PAGES+path+'?apx_health='+str(int(now.timestamp())))
  if github!=public:result['issues'].append('PAGES_COMMIT_MISMATCH_'+name.upper())
  data[name]=github
 result['issues']+=validate(ops,data['latest'],data['ranking'],data['history'],now=now,calendar=calendar)
 if os.environ.get('APX_DEPLOY_CONCLUSION') not in (None,'','success'):
  result['issues'].append('PAGES_DEPLOYMENT_FAILED')
 if ops['publicationMode']=='FORMAL':
  validation=data.get('validation',{})
  for name in ('Core','Aggressive','LeadingCandidate'):
   model=validation.get('models',{}).get(name,{})
   if not model.get('predictedAt') or model.get('inputSnapshotStatus','VERIFIED')!='VERIFIED':result['issues'].append('FORECAST_MODEL_NOT_VERIFIED_'+name.upper())
 result.update(status='FAILED'if result['issues']else'HEALTHY',expectedEvaluationDate=expected(now,calendar)[0],
  evaluationDate=ops['evaluationDate'],sourceRunId=ops['sourceRunId'],publicationMode=ops['publicationMode'],
  formalState=ops['formalState'],formalReasons=ops['formalEligibility']['reasons'],coverage=ops['coverage'],
  httpsObservedAt=now.isoformat(),artifactDigest=hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False).encode()).hexdigest())
 if not result['issues'] and ops['publicationMode']=='FORMAL':
  result['publicationReceipt']={'status':'HTTPS_VERIFIED','sourceRunId':ops['sourceRunId'],
   'verifiedCommit':head,'publishedAt':now.isoformat(),'publicContentSha256':result['artifactDigest']}
 return result

def watchdog(*,now=None,fetch=get):
 now=now or datetime.now(timezone.utc);calendar=fetch(RAW+'main/operations/calendar.json');local=now.astimezone(JST)
 if local.weekday()>4 or local.date().isoformat()in calendar['closed_dates']:return {'status':'NON_TRADING_DAY','checkedAt':now.isoformat(),'issues':[]}
 value=fetch(RAW+'apx-monitor-state/health.json');checked=datetime.fromisoformat(value['checkedAt']).astimezone(JST)
 issues=[]
 if checked.date()!=local.date()or checked.time()<time(9,30):issues.append('PRIMARY_MONITOR_DID_NOT_RUN')
 if value.get('status')!='HEALTHY':issues.append('PRIMARY_MONITOR_UNHEALTHY')
 return {'schemaVersion':'apx-watchdog-1','status':'FAILED'if issues else'HEALTHY','checkedAt':now.isoformat(),'issues':issues,'primaryCheckedAt':value.get('checkedAt')}

def save_remote(value,name):
 """Separate branch. Normal descendant updates; never touches main data."""
 token=os.environ.get('GITHUB_TOKEN')
 if not token:raise ValueError('MONITOR_TOKEN_UNAVAILABLE')
 def request(method,path,body):
  req=Request(API+path,data=json.dumps(body).encode(),method=method,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','User-Agent':'AP-X-Health'})
  with urlopen(req,timeout=25)as r:return json.load(r)
 try:ref=get(API+'/git/ref/heads/apx-monitor-state',auth=True);parent=ref['object']['sha'];base=get(API+'/git/commits/'+parent,auth=True)['tree']['sha']
 except HTTPError as e:
  if e.code!=404:raise
  parent=base=None
 tree=request('POST','/git/trees',{'tree':[{'path':name,'mode':'100644','type':'blob','content':json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n'}],**({'base_tree':base}if base else{})})
 commit=request('POST','/git/commits',{'message':'AP-X external health '+value['status'],'tree':tree['sha'],'parents':[parent]if parent else[]})
 if parent:request('PATCH','/git/refs/heads/apx-monitor-state',{'sha':commit['sha'],'force':False})
 else:request('POST','/git/refs',{'ref':'refs/heads/apx-monitor-state','sha':commit['sha']})

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--watchdog',action='store_true');p.add_argument('--write-state',action='store_true');p.add_argument('--simulate-stale',action='store_true');a=p.parse_args()
 try:value=watchdog()if a.watchdog else inspect()
 except Exception as e:value={'status':'FAILED','checkedAt':datetime.now(timezone.utc).isoformat(),'issues':['MONITOR_FETCH_OR_SCHEMA_FAILURE'],'errorType':type(e).__name__}
 if a.simulate_stale:value={**value,'status':'FAILED','issues':['DRILL_STALE_EVALUATION'],'drill':True}
 if a.write_state and not a.simulate_stale:
  try:save_remote(value,'watchdog.json'if a.watchdog else'health.json')
  except Exception:value={**value,'status':'FAILED','issues':value.get('issues',[])+['MONITOR_HEARTBEAT_WRITE_FAILED']}
 with open('apx-monitor-result.json','w',encoding='utf-8')as f:json.dump(value,f,ensure_ascii=False,indent=2)
 print(json.dumps(value,ensure_ascii=False));sys.exit(1 if value['status']=='FAILED'else 0)
