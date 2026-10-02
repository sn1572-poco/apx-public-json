"""Add read-only lightweight projections without changing published ranking/UI.

Standalone standard-library generator, also usable by the public Pages workflow.
Only FORMAL input can generate a new site. All numeric fields are copied.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import re
import shutil

FACTORS = ('revision', 'acceleration', 'relativeStrength', 'liquidity', 'quality', 'margin', 'valuation')
TECHNICAL = ('relativeStrength', 'liquidity', 'margin')


def execution_projection(stock):
    if stock.get('executionDecision') not in ('BUY', 'WAIT', 'AVOID', 'UNAVAILABLE'):
        return {'executionDecision': 'UNAVAILABLE', 'executionReasons': ['日次Execution判定が未生成'],
                'entryZone': None, 'stopLossReference': None, 'positionSizeReference': None}
    result = {k: stock[k] for k in ('executionDecision', 'executionReasons')}
    for key, fields in {
        'entryZone': ('lowerJpy', 'upperJpy', 'basis', 'referenceOnly'),
        'stopLossReference': ('priceJpy', 'distanceFraction', 'basis', 'relativeTo', 'referenceOnly'),
        'positionSizeReference': ('riskBudgetFraction', 'maxPortfolioWeight', 'maxOrderValueJpy', 'formula', 'shares', 'referenceOnly'),
    }.items():
        value = stock.get(key)
        result[key] = {k: value[k] for k in fields if k in value} if isinstance(value, dict) else None
    for key in ('executionRuleVersion', 'executionLabel', 'executionReasonCodes', 'liveOrderAuthorized'):
        if key in stock:
            result[key] = stock[key]
    return result


def project(ranking: dict) -> dict[str, dict]:
    if ranking.get('status') != 'FORMAL':
        raise ValueError('FORMAL_REQUIRED')
    stocks = ranking['stocks']
    if len(stocks) != ranking['eligibleCount'] or len(stocks) < 100:
        raise ValueError('COMPLETE_RANKING_REQUIRED')
    metadata = {'schemaVersion': 'apx-lightweight-json-1', 'status': 'FORMAL',
                'sourceRunId': ranking['sourceRunId'], 'evaluationDate': ranking['asOf']}
    if not isinstance(metadata['sourceRunId'], str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', metadata['evaluationDate']):
        raise ValueError('INVALID_RUN_METADATA')
    public, seen = [], set()
    for rank, s in enumerate(stocks, 1):
        code = s['code']
        if not isinstance(code, str) or not re.fullmatch(r'(?:\d{4}|\d{3}[A-Z])', code) or code in seen or s['rank'] != rank:
            raise ValueError('INVALID_CODE_OR_RANK')
        seen.add(code)
        factors = {k: s['factors'][k] for k in FACTORS}
        technical = {k: s['technicalComponents'][k] for k in TECHNICAL}
        values = [s['confidence'], s['score'], s['penalty'], *factors.values(), *technical.values()]
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
            raise ValueError('INVALID_NUMERIC_VALUE')
        if any(k not in FACTORS for k in s['missingFactors']):
            raise ValueError('INVALID_MISSING_FACTOR')
        public.append({'rank': rank, 'code': code, 'name': s['name'], 'market': s['market'],
                       'confidence': s['confidence'], 'coreScore': s['score'],
                       'overheatPenalty': s['penalty'], 'factors': factors,
                       'technicalComponents': technical, 'missingFactors': list(s['missingFactors']),
                       **execution_projection(s)})
    result = {
        'data/top100.json': {**metadata, 'count': 100, 'stocks': public[:100]},
        'data/index.json': {**metadata, 'count': len(public), 'stocks': [
            {k: s[k] for k in ('code', 'name', 'rank', 'coreScore', 'confidence')} for s in public]},
    }
    result.update({f"data/stocks/{s['code']}.json": {**metadata, **s} for s in public})
    return result


def build_site(source: Path, output: Path) -> dict:
    ranking = json.loads((source / 'data/ranking.json').read_text(encoding='utf-8'))
    if ranking.get('status') != 'FORMAL':
        return {'status': 'SKIP_NONFORMAL'}
    payloads = project(ranking)  # validate everything before touching any output
    latest = json.loads((source / 'latest.json').read_text(encoding='utf-8'))
    if latest.get('status') != 'FORMAL' or latest['run']['id'] != ranking['sourceRunId'] or latest['run']['evaluationDate'] != ranking['asOf']:
        raise ValueError('PUBLISHED_RUN_MISMATCH')
    # Explicit asset list: never publish git metadata, credentials, or tools.
    assets = ('index.html', 'index.css', 'viewer.js', '.nojekyll', 'latest.json',
              'ranking-top20.json', 'data/ranking.json', 'data/execution.json')
    for name in assets:
        if not (source / name).is_file():
            raise ValueError('PUBLIC_ASSET_MISSING')
    if source.resolve() == output.resolve() or output.exists():
        raise ValueError('FRESH_OUTPUT_REQUIRED')
    output.mkdir(parents=True)
    for name in assets:
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / name, target)  # original bytes, no UI/data rebuild
    for name, value in payloads.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n', encoding='utf-8')
    return {'status': 'FORMAL', 'sourceRunId': ranking['sourceRunId'], 'evaluationDate': ranking['asOf'],
            'stockCount': len(ranking['stocks']), 'generatedFiles': len(payloads)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build_site(args.source, args.output)))
