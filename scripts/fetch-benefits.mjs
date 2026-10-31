// 매일 아침 공공데이터에서 지원금 목록을 받아 data/benefits.json으로 저장해요.
// 사용법: DATA_GO_KR_KEY=인증키 node scripts/fetch-benefits.mjs
//        (키가 없으면 test/fixtures/sample.json 샘플 데이터로 만들어요)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isoDate, parseDeadline, parseAgency, sidoOf, SIDO } from '../lib/match.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'benefits.json');
const BASE = 'https://api.odcloud.kr/api/gov24/v3';
const PER_PAGE = 1000;

const cut = (s, n) => {
  if (!s) return '';
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

function regDate(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 8);
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
}

// 4xx는 다시 해도 안 되니까 바로 알려줘요
function clientError(status, body) {
  const msg = {
    401: '인증키가 올바르지 않아요. GitHub Secrets의 DATA_GO_KR_KEY 값(Decoding 키)을 다시 확인해 주세요.',
    403: '이 API를 쓸 권한이 없어요. 공공데이터포털에서 활용신청이 승인됐는지 확인해 주세요.',
    429: '오늘 쓸 수 있는 요청 횟수를 다 썼어요. 내일 다시 시도해 주세요.',
  }[status] || `요청이 거절됐어요 (HTTP ${status}).`;
  const e = new Error(`${msg} ${String(body || '').slice(0, 200)}`.trim());
  e.client = true;
  return e;
}

async function fetchAll(endpoint, key) {
  const k = key.includes('%') ? key : encodeURIComponent(key);
  const all = [];
  for (let page = 1; page <= 100; page++) {
    const url = `${BASE}/${endpoint}?page=${page}&perPage=${PER_PAGE}&returnType=JSON&serviceKey=${k}`;
    let res;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let why;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (res.ok) break;
        if (res.status >= 400 && res.status < 500) throw clientError(res.status, await res.text());
        why = `HTTP ${res.status}`;
      } catch (e) {
        if (e.client) throw e;
        why = `네트워크 오류 (${e.message})`;
      }
      if (attempt === 3) throw new Error(`${endpoint} ${page}쪽 요청 실패: ${why}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    const json = await res.json();
    const rows = json.data || [];
    all.push(...rows);
    const total = json.matchCount ?? json.totalCount ?? 0;
    if (rows.length < PER_PAGE || all.length >= total) break;
  }
  return all;
}

export function buildItems(list, conditions, prevFirstSeen, today) {
  const condById = new Map();
  for (const c of conditions) {
    const codes = Object.keys(c).filter((k) => /^JA\d{4}$/.test(k) && c[k] === 'Y');
    const min = Number(c.JA0110) || 0;
    const max = Number(c.JA0111) || 0;
    condById.set(String(c['서비스ID']), { codes, age: min || max ? [min, max] : null });
  }
  const firstRun = prevFirstSeen.size === 0;
  const items = [];
  for (const s of list) {
    const who = String(s['사용자구분'] || '');
    if (who && !/개인|가구/.test(who)) continue; // 법인·단체 전용은 빼요
    const id = String(s['서비스ID']);
    const cond = condById.get(id) || { codes: [], age: null };
    const fs = prevFirstSeen.get(id) || (firstRun ? regDate(s['등록일시']) || today : today);
    const url = String(s['상세조회URL'] || '').trim();
    items.push(compact({
      id,
      n: cut(s['서비스명'], 80),
      s: cut(s['서비스목적요약'], 100),
      t: cut(s['지원유형'], 30),
      tg: cut(s['지원대상'], 100),
      ct: cut(s['지원내용'], 120),
      ap: cut(s['신청방법'], 30),
      due: cut(s['신청기한'], 80),
      dd: parseDeadline(s['신청기한']), // 자르기 전 원문에서 마감일을 찾아요
      url: url === defaultUrl(id) ? '' : url, // 기본 주소는 앱이 만들어요
      org: cut(s['소관기관명'], 40),
      ot: cut(s['소관기관유형'], 20),
      f: cut(s['서비스분야'], 20),
      views: Number(s['조회수']) || 0,
      fs,
      c: cond.codes,
      a: cond.age,
    }));
  }
  tagLocalAgencies(items);
  return items;
}

// 지방공기업·출연기관은 이름에서 지역을 찾아 rg: [시·도, 시군구]로 저장해요.
// 실제 시군구 이름 목록은 같은 데이터의 '시군구' 기관에서 모아요 (예: '서울특별시서대문구도시관리공단' → ['서울', '서대문구'])
export function tagLocalAgencies(items) {
  const known = new Map(); // 시군구 이름 → 시·도 목록
  for (const it of items) {
    if (!/시군구/.test(it.ot || '')) continue;
    const ag = parseAgency(it.org);
    for (const g of ag.sigungu) {
      if (!known.has(g)) known.set(g, new Set());
      known.get(g).add(ag.sido);
    }
  }
  const names = [...known.keys()].sort((a, b) => b.length - a.length); // 긴 이름 먼저 ('강서구'가 '서구'보다 먼저)
  for (const it of items) {
    if (!/지방공기업|지방출자|출연기관/.test(it.ot || '')) continue;
    const org = String(it.org || '').replace(/^재단법인|^\(재\)|^사단법인/, '').trim();
    let sido = sidoOf(org);
    const fits = (n) => !sido || known.get(n).has(sido);
    // 시·도 이름을 뗀 나머지가 '춘천도시공사'처럼 시군구 이름(끝 글자 빼고)으로 시작하는 경우도 찾아요
    const alias = sido ? SIDO.find((s) => s.name === sido).aliases.find((a) => org.startsWith(a)) : '';
    const rest = org.slice(alias.length).trim();
    const gu = names.find((n) => org.includes(n) && fits(n))
      || names.find((n) => n.length >= 3 && rest.startsWith(n.slice(0, -1)) && fits(n)) || null;
    if (!sido && gu && known.get(gu).size === 1) sido = [...known.get(gu)][0];
    if (sido) it.rg = gu ? [sido, gu] : [sido];
  }
}

const defaultUrl = (id) => `https://www.gov.kr/portal/rcvfvrSvc/dtlEx/${id}`;

// 용량을 줄이려고 빈 값은 빼요
function compact(o) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v === '' || v == null || v === 0 || (Array.isArray(v) && !v.length)) delete o[k];
  }
  return o;
}

async function loadPrev() {
  try {
    const prev = JSON.parse(await readFile(OUT, 'utf8'));
    if (prev.source !== 'api') return new Map(); // 샘플 데이터 기록은 무시해요
    return new Map(prev.items.map((i) => [i.id, i.fs]));
  } catch {
    return new Map();
  }
}

async function main() {
  const key = (process.env.DATA_GO_KR_KEY || '').trim();
  const today = isoDate();
  let list, conditions, source;
  if (key) {
    console.log('공공데이터 API에서 받는 중...');
    list = await fetchAll('serviceList', key);
    conditions = await fetchAll('supportConditions', key);
    source = 'api';
    if (!list.length) throw new Error('서비스 목록이 비어 있어요. 인증키나 활용신청 상태를 확인해 주세요.');
  } else {
    console.log('인증키(DATA_GO_KR_KEY)가 없어서 샘플 데이터로 만들어요.');
    const sample = JSON.parse(await readFile(path.join(ROOT, 'test', 'fixtures', 'sample.json'), 'utf8'));
    list = sample.serviceList;
    conditions = sample.supportConditions;
    source = 'sample';
  }
  const prev = source === 'api' ? await loadPrev() : new Map();
  const items = buildItems(list, conditions, prev, today);
  await mkdir(path.dirname(OUT), { recursive: true });
  const out = { updatedAt: new Date().toISOString(), source, count: items.length, items };
  const json = JSON.stringify(out);
  await writeFile(OUT, json);
  const kb = Buffer.byteLength(json) / 1024;
  console.log(`완료: ${items.length}개 저장 (${source}), 파일 크기 ${kb >= 1024 ? (kb / 1024).toFixed(1) + 'MB' : kb.toFixed(1) + 'KB'}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error('실패:', e.message);
    process.exit(1);
  });
}
