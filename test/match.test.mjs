import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { matchItem, rankBenefits, parseDeadline, parseAgency, sidoOf, isNew, daysLeft, SIDO } from '../lib/match.js';
import { buildItems, tagLocalAgencies, saveData, serializeData } from '../scripts/fetch-benefits.mjs';

const TODAY = new Date('2026-10-31T09:00:00+09:00');
const sample = JSON.parse(readFileSync(new URL('./fixtures/sample.json', import.meta.url), 'utf8'));
const items = buildItems(sample.serviceList, sample.supportConditions, new Map(), '2026-10-31');
const ids = (ranked) => ranked.map((r) => r.item.id).sort();

const seoulWorker = {
  birthYear: '1998', gender: 'M', sido: '서울', sigungu: '강남구',
  income: '', jobs: ['worker'], family: ['single', 'nohouse'], special: [],
};
const busanJobseeker = {
  birthYear: '1995', gender: 'F', sido: '부산', sigungu: '',
  income: 'JA0203', jobs: ['jobseeker'], family: [], special: [],
};

test('법인 전용 서비스는 목록에서 빠져요', () => {
  assert.ok(!items.some((i) => i.id === 'S007'));
  assert.equal(items.length, 13);
});

test('처음 실행 때 firstSeen은 등록일이에요', () => {
  assert.equal(items.find((i) => i.id === 'S003').fs, '2026-10-29');
  assert.equal(items.find((i) => i.id === 'S002').fs, '2020-01-01');
});

test('이전 기록이 있으면 새 항목만 오늘 날짜가 돼요', () => {
  const prev = new Map([['S001', '2026-01-01']]);
  const again = buildItems(sample.serviceList, sample.supportConditions, prev, '2026-10-31');
  assert.equal(again.find((i) => i.id === 'S001').fs, '2026-01-01');
  assert.equal(again.find((i) => i.id === 'S002').fs, '2026-10-31');
});

test('서울 강남구 28세 직장인 1인 무주택', () => {
  const r = rankBenefits(items, seoulWorker, TODAY);
  assert.deepEqual(ids(r), ['S001', 'S003', 'S005', 'S009', 'S013']);
  // 65세 이상, 다른 지역, 여성 전용, 마감 지난 것은 없어야 해요
  for (const bad of ['S002', 'S004', 'S006', 'S012', 'S014', 'S010', 'S011', 'S008']) {
    assert.ok(!ids(r).includes(bad), `${bad}가 섞이면 안 돼요`);
  }
  // 강남구 전용(시군구 일치)이 가장 위쪽
  assert.equal(r[0].item.id, 'S005');
});

test('부산 31세 여성 구직자', () => {
  const r = rankBenefits(items, busanJobseeker, TODAY);
  assert.deepEqual(ids(r), ['S004', 'S010']);
});

test('소득을 모르면 소득조건 항목은 "확인 필요"로 남아요', () => {
  const r = matchItem(items.find((i) => i.id === 'S009'), seoulWorker, TODAY);
  assert.ok(r.ok);
  assert.ok(r.reasons.includes('소득 조건 확인 필요'));
  const r2 = matchItem(items.find((i) => i.id === 'S009'), { ...seoulWorker, income: 'JA0204' }, TODAY);
  assert.equal(r2.ok, false);
});

test('지역을 입력하지 않으면 지역 한정 서비스는 빠져요', () => {
  const r = rankBenefits(items, { birthYear: '1998' }, TODAY);
  assert.ok(!ids(r).includes('S003'));
  assert.ok(!ids(r).includes('S005'));
});

test('날짜/기관 해석', () => {
  assert.equal(parseDeadline('2026.10.01 ~ 2026.11.7'), '2026-11-07');
  assert.equal(parseDeadline('2026년 3월 2일부터 2026년 12월 31일까지'), '2026-12-31');
  assert.equal(parseDeadline('상시신청'), null);
  assert.deepEqual(parseAgency('서울특별시 강남구'), { sido: '서울', sigungu: ['강남구'] });
  assert.deepEqual(parseAgency('경기도 수원시'), { sido: '경기', sigungu: ['수원시'] });
  assert.deepEqual(parseAgency('경기도 수원시 영통구'), { sido: '경기', sigungu: ['수원시', '영통구'] });
  assert.deepEqual(parseAgency('보건복지부'), { sido: null, sigungu: [] });
  assert.equal(sidoOf('강원특별자치도'), '강원');
  assert.equal(sidoOf('서울특별시교육청'), '서울');
});

test('새 항목/남은 날짜', () => {
  assert.ok(isNew(items.find((i) => i.id === 'S003'), TODAY));
  assert.ok(!isNew(items.find((i) => i.id === 'S001'), TODAY));
  assert.equal(daysLeft(items.find((i) => i.id === 'S005'), TODAY), 7);
});

// 테스트용 항목 만들기 (조건 없는 전국 서비스가 기본)
const mk = (extra) => ({ id: 'X', n: '테스트', fs: '2020-01-01', ...extra });
const ok = (item, profile) => matchItem(item, profile, TODAY);

test('시군구는 정확히 같은 이름만 맞아요', () => {
  const yeongtong = mk({ org: '경기도 수원시 영통구' });
  const gyeonggi = { birthYear: '1990', sido: '경기' };
  assert.ok(ok(yeongtong, { ...gyeonggi, sigungu: '영통구' }).ok);
  assert.ok(ok(yeongtong, { ...gyeonggi, sigungu: '수원시 영통구' }).ok);
  assert.ok(ok(yeongtong, { ...gyeonggi, sigungu: '수원' }).ok);
  assert.ok(ok(yeongtong, { ...gyeonggi, sigungu: '수원시' }).reasons.includes('수원시 거주'));
  assert.equal(ok(yeongtong, { ...gyeonggi, sigungu: '팔달구' }).ok, false);

  // 일반시의 구만 적어도 시 단위 서비스는 받아요 (같은 시·도일 때만)
  const suwon = mk({ org: '경기도 수원시' });
  const r = ok(suwon, { ...gyeonggi, sigungu: '영통구' });
  assert.ok(r.ok);
  assert.ok(r.reasons.includes('수원시 거주'));
  const pohang = mk({ org: '경상북도 포항시' });
  assert.equal(ok(pohang, { birthYear: '1990', sido: '부산', sigungu: '남구' }).ok, false);
  assert.ok(ok(pohang, { birthYear: '1990', sido: '경북', sigungu: '남구' }).ok);

  const seogu = mk({ org: '대구광역시 서구' });
  const daegu = { birthYear: '1990', sido: '대구' };
  assert.equal(ok(seogu, { ...daegu, sigungu: '달서구' }).ok, false);
  assert.ok(ok(seogu, { ...daegu, sigungu: '서구' }).ok);
  assert.equal(ok(mk({ org: '서울특별시 강서구' }), { birthYear: '1990', sido: '서울', sigungu: '서구' }).ok, false);
  const gangnam = ok(mk({ org: '서울특별시 강남구' }), { birthYear: '1990', sido: '서울', sigungu: '강남' });
  assert.ok(gangnam.ok);
  assert.ok(gangnam.reasons.includes('강남구 거주'));
});

test('나이는 만 나이 두 가지 경우를 모두 생각해요', () => {
  // 2026년 기준 1992년생 → 연 나이 34, 만 33 또는 34
  const p = { birthYear: '1992' };
  const youth = mk({ a: [19, 34] });
  const r = ok(youth, p);
  assert.ok(r.ok);
  assert.ok(r.reasons.includes('나이 조건 충족'));
  // 만 33세까지: 생일이 지났으면 안 되고, 안 지났으면 돼요
  const r33 = ok(mk({ a: [19, 33] }), p);
  assert.ok(r33.ok);
  assert.ok(r33.reasons.includes('나이 확인 필요'));
  assert.ok(r33.score < r.score);
  assert.equal(ok(mk({ a: [19, 32] }), p).ok, false);
  // 만 34세부터: 생일이 지났으면 돼요
  const r34 = ok(mk({ a: [34, 0] }), p);
  assert.ok(r34.ok);
  assert.ok(r34.reasons.includes('나이 확인 필요'));
  assert.equal(ok(mk({ a: [35, 0] }), p).ok, false);
  // 0과 100 이상은 제한 없음
  assert.ok(ok(mk({ a: [0, 120] }), p).ok);
});

test('해당사항없음 코드가 있으면 직업·가구 제한을 건너뛰어요', () => {
  const p = { birthYear: '1990', jobs: [], family: [] };
  assert.equal(ok(mk({ c: ['JA0326'] }), p).ok, false);
  assert.ok(ok(mk({ c: ['JA0326', 'JA0322'] }), p).ok);
  assert.equal(ok(mk({ c: ['JA0404'] }), p).ok, false);
  assert.ok(ok(mk({ c: ['JA0404', 'JA0410'] }), p).ok);
});

test('공사·대학병원 같은 기관은 지역 한정으로 보지 않아요', () => {
  const p = { birthYear: '1990', sido: '서울' };
  for (const org of ['부산항만공사', '서울대학교병원', '인천국제공항공사']) {
    assert.ok(ok(mk({ org }), p).ok, org);
    assert.ok(ok(mk({ org }), p).reasons.includes('전국'), org);
  }
  // 소관기관유형이 있으면 그걸 따라요
  assert.ok(ok(mk({ org: '부산항만공사', ot: '공공기관' }), p).ok);
  assert.equal(ok(mk({ org: '부산광역시', ot: '지방자치단체' }), p).ok, false);
  assert.equal(ok(mk({ org: '부산광역시교육청', ot: '교육청' }), p).ok, false);
  // 유형이 없으면 정식 시·도 이름으로 시작할 때만 지역 한정이에요
  assert.equal(ok(mk({ org: '부산광역시' }), p).ok, false);
  assert.equal(ok(mk({ org: '부산광역시교육청' }), p).ok, false);
  assert.equal(ok(mk({ org: '강원특별자치도 춘천시' }), p).ok, false);
});

test('마감일은 잘리기 전 원문(dd)을 먼저 써요', () => {
  const long = '공고일부터 예산 소진 시까지 '.repeat(5) + '2026.12.31';
  const [it] = buildItems([{ 서비스ID: 'L1', 서비스명: '긴 기한', 신청기한: long, 사용자구분: '개인' }], [], new Map(), '2026-10-31');
  assert.equal(it.dd, '2026-12-31');
  assert.equal(daysLeft(it, TODAY), 61);
  assert.equal(daysLeft({ due: '~ 2026.11.07' }, TODAY), 7);
});

test('데이터 용량 줄이기: 빈 값과 기본 주소는 빼요', () => {
  const s002 = items.find((i) => i.id === 'S002');
  assert.equal(s002.url, undefined);
  assert.equal(s002.c, undefined);
  assert.ok(!('dd' in s002));
  assert.equal(items.find((i) => i.id === 'S001').url, undefined); // 기본 주소와 같아요
  const [x] = buildItems([{ 서비스ID: 'Z', 서비스명: 'z', 지원대상: '가'.repeat(300), 사용자구분: '개인' }], [], new Map(), '2026-10-31');
  assert.ok(x.tg.length <= 101);
  assert.ok(matchItem(x, {}, TODAY).ok);
});

test('실제 소관기관유형(시군구·광역시도·교육청)은 지역 한정이에요', () => {
  const seoul = { birthYear: '1990', sido: '서울', sigungu: '강남구' };
  assert.equal(ok(mk({ org: '부산광역시 해운대구', ot: '시군구' }), seoul).ok, false);
  assert.equal(ok(mk({ org: '서울특별시 종로구', ot: '시군구' }), seoul).ok, false);
  assert.ok(ok(mk({ org: '서울특별시 강남구', ot: '시군구' }), seoul).ok);
  assert.equal(ok(mk({ org: '세종특별자치시', ot: '광역시도' }), seoul).ok, false);
  assert.ok(ok(mk({ org: '서울특별시', ot: '광역시도' }), seoul).ok);
  assert.equal(ok(mk({ org: '경기도교육청', ot: '교육청' }), seoul).ok, false);
  assert.ok(ok(mk({ org: '국세청', ot: '중앙행정기관' }), seoul).ok);
});

test('지방공기업·재단은 이름에서 시군구를 찾아 구분해요', () => {
  const items = [
    mk({ id: 'g1', org: '서울특별시 강남구', ot: '시군구' }),
    mk({ id: 'g2', org: '서울특별시 서대문구', ot: '시군구' }),
    mk({ id: 'g3', org: '강원특별자치도 춘천시', ot: '시군구' }),
    mk({ id: 'g4', org: '대구광역시 달성군', ot: '시군구' }),
    mk({ id: 'g5', org: '부산광역시 강서구', ot: '시군구' }),
    mk({ id: 'g6', org: '부산광역시 서구', ot: '시군구' }),
    mk({ id: 'l1', org: '서울특별시서대문구도시관리공단', ot: '지방공기업' }),
    mk({ id: 'l2', org: '춘천도시공사', ot: '지방공기업' }),
    mk({ id: 'l3', org: '(재)달성교육재단', ot: '지방출자_출연기관' }),
    mk({ id: 'l4', org: '서울시설공단', ot: '지방공기업' }),
    mk({ id: 'l5', org: '부산광역시강서구시설관리공단', ot: '지방공기업' }),
  ];
  tagLocalAgencies(items);
  const rg = Object.fromEntries(items.filter((i) => i.rg).map((i) => [i.id, i.rg]));
  assert.deepEqual(rg.l1, ['서울', '서대문구']);
  assert.deepEqual(rg.l2, ['강원', '춘천시']);
  assert.deepEqual(rg.l3, ['대구', '달성군']);
  assert.deepEqual(rg.l4, ['서울']);
  assert.deepEqual(rg.l5, ['부산', '강서구']); // '서구'가 아니라 '강서구'
  const gangnam = { birthYear: '1990', sido: '서울', sigungu: '강남구' };
  const byId = (id) => items.find((i) => i.id === id);
  assert.equal(ok(byId('l1'), gangnam).ok, false); // 다른 구의 공단은 빠져요
  assert.ok(ok(byId('l4'), gangnam).ok); // 서울시 전체 공단은 나와요
  assert.equal(ok(byId('l2'), gangnam).ok, false);
});

test('지역을 못 찾은 지역 기관은 이름에 내 지역이 있을 때만 보여요', () => {
  const p = { birthYear: '1990', sido: '경남', sigungu: '고성군' };
  assert.ok(ok(mk({ org: '재단법인고성교육재단', ot: '지방출자_출연기관' }), p).ok);
  assert.equal(ok(mk({ org: '재단법인고성교육재단', ot: '지방출자_출연기관' }), { birthYear: '1990', sido: '서울', sigungu: '강남구' }).ok, false);
});

test('전남광주통합특별시: 광주·전남 사용자가 모두 받을 수 있어요', () => {
  assert.equal(sidoOf('전남광주통합특별시 광산구'), '전남광주');
  assert.equal(sidoOf('전남광주통합특별시교육청'), '전남광주');
  assert.equal(sidoOf('전라남도'), '전남');
  assert.equal(sidoOf('전남개발공사'), '전남');
  assert.ok(!SIDO.some((s) => s.name === '전남광주'), '내 조건 고르는 칸에는 없어야 해요');
  assert.ok(SIDO.some((s) => s.name === '광주') && SIDO.some((s) => s.name === '전남'));

  const gwangsan = mk({ org: '전남광주통합특별시 광산구', ot: '시군구' });
  const yeosu = mk({ org: '전남광주통합특별시 여수시', ot: '시군구' });
  const base = { birthYear: '1990' };
  const r = ok(gwangsan, { ...base, sido: '광주', sigungu: '광산구' });
  assert.ok(r.ok);
  assert.ok(r.reasons.includes('광산구 거주'));
  assert.equal(ok(yeosu, { ...base, sido: '광주', sigungu: '광산구' }).ok, false);
  assert.equal(ok(yeosu, { ...base, sido: '광주' }).ok, false); // 시군구를 안 적어도 빠져요
  assert.ok(ok(yeosu, { ...base, sido: '전남', sigungu: '여수시' }).ok);
  assert.ok(ok(yeosu, { ...base, sido: '전남' }).ok);
  assert.equal(ok(gwangsan, { ...base, sido: '전남' }).ok, false);
  assert.equal(ok(yeosu, { ...base, sido: '부산' }).ok, false);

  for (const org of ['전남광주통합특별시', '전남광주통합특별시교육청']) {
    const it = mk({ org, ot: org.endsWith('교육청') ? '교육청' : '광역시도' });
    for (const sido of ['광주', '전남']) {
      const m = ok(it, { ...base, sido });
      assert.ok(m.ok, org + sido);
      assert.ok(m.reasons.includes(sido + ' 거주'));
    }
    assert.equal(ok(it, { ...base, sido: '부산' }).ok, false);
    assert.equal(ok(it, base).ok, false); // 지역 미입력
  }
  // 유형이 없는 항목도 정식 이름으로 알아봐요
  assert.ok(ok(mk({ org: '전남광주통합특별시' }), { ...base, sido: '광주' }).ok);
  // 이름으로만 찾는 지역 기관
  const local = mk({ org: '전남광주통합특별시도시공사', ot: '지방공기업' });
  assert.ok(ok(local, { ...base, sido: '광주' }).ok);
  assert.ok(ok(local, { ...base, sido: '전남' }).ok);
  assert.equal(ok(local, { ...base, sido: '부산' }).ok, false);
});

test('통합 기관으로만 알려진 시군구도 광주·전남 기관에서 찾아요', () => {
  const items = [
    mk({ id: 'k1', org: '전남광주통합특별시 광산구', ot: '시군구' }),
    mk({ id: 'k2', org: '전남광주통합특별시 순천시', ot: '시군구' }),
    mk({ id: 'k3', org: '경기도 광주시', ot: '시군구' }),
    mk({ id: 'a', org: '광주광역시광산구시설관리공단', ot: '지방공기업' }),
    mk({ id: 'b', org: '전남순천복지재단', ot: '지방출자_출연기관' }),
    mk({ id: 'c', org: '전남광주통합특별시광산구시설관리공단', ot: '지방공기업' }),
    mk({ id: 'd', org: '전남광주통합특별시순천의료원', ot: '지방공기업' }),
    mk({ id: 'e', org: '전남광주통합특별시도시공사', ot: '지방공기업' }),
    mk({ id: 'f', org: '광주환경공단', ot: '지방공기업' }),
    mk({ id: 'g', org: '광주순천공단', ot: '지방공기업' }), // 광주에는 순천이 없어요
    mk({ id: 'x1', org: '광주도시관리공사', ot: '지방공기업' }),
    mk({ id: 'x2', org: '재단법인광주시민장학회', ot: '지방출자_출연기관' }),
  ];
  tagLocalAgencies(items);
  const rg = Object.fromEntries(items.filter((i) => i.rg).map((i) => [i.id, i.rg]));
  assert.deepEqual(rg.a, ['광주', '광산구']);
  assert.deepEqual(rg.b, ['전남', '순천시']);
  assert.deepEqual(rg.c, ['전남광주', '광산구']);
  assert.deepEqual(rg.d, ['전남광주', '순천시']);
  assert.deepEqual(rg.e, ['전남광주']);
  assert.deepEqual(rg.f, ['광주']);
  assert.deepEqual(rg.g, ['광주']);
  // 경기도 광주시 기관은 광주광역시 사람에게 보이면 안 돼요
  assert.deepEqual(rg.x1, ['경기', '광주시']);
  assert.deepEqual(rg.x2, ['경기', '광주시']);
  const byId = (id) => items.find((i) => i.id === id);
  assert.equal(ok(byId('x1'), { birthYear: '1990', sido: '광주' }).ok, false);
  assert.ok(ok(byId('x1'), { birthYear: '1990', sido: '경기', sigungu: '광주시' }).ok);
  assert.ok(ok(byId('c'), { birthYear: '1990', sido: '광주', sigungu: '광산구' }).ok);
  assert.equal(ok(byId('c'), { birthYear: '1990', sido: '전남', sigungu: '여수시' }).ok, false);
});

test('마감일: 기준일 문구는 빼고, 연도 없는 끝 날짜를 읽어요', () => {
  assert.equal(parseDeadline('2026. 2. 2.~11. 30.'), '2026-11-30');
  assert.equal(parseDeadline('2026.11.1~2.28'), '2027-02-28');
  assert.equal(parseDeadline('2026년 3월 2일 ~ 11월 30일'), '2026-11-30');
  assert.equal(parseDeadline('2026.3.2.(월) ~ 4.3.(금)'), '2026-04-03');
  assert.equal(parseDeadline('장해판정일로부터 3년 이내(2021.2.1. 이후)'), null);
  assert.equal(parseDeadline('2026. 3. 2. ~ 2027. 3. 1. 기간 중 사고발생일로부터 3년 이내 청구'), null);
  assert.equal(parseDeadline('2026.10.01 ~ 2026.11.7'), '2026-11-07');
  assert.equal(parseDeadline('2026.10.01 ~ 13.40'), '2026-10-01'); // 말이 안 되는 날짜는 무시
  assert.equal(parseDeadline('2026.3.2 14:00까지'), '2026-03-02');
  // 잘린 문구에 날짜만 남아도 원문 기준(마감일 없음)을 따라요
  const long = '2026. 3. 2. ~ 2026. 3. 9. 기간 중 ' + '발생한 사고에 대하여 '.repeat(8) + '사고일로부터 3년 이내 청구';
  const [it] = buildItems([{ 서비스ID: 'L2', 서비스명: '긴 기한', 신청기한: long, 사용자구분: '개인' }], [], new Map(), '2026-10-31');
  assert.equal(it.dd, null);
  assert.equal(daysLeft(it, TODAY), null);
  assert.ok(ok(it, {}).ok);
});

test('데이터 저장: 내용이 같으면 benefits.json을 건드리지 않고 meta.json만 바꿔요', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hunt-'));
  try {
    const a = { id: 'A', n: '가', fs: '2020-01-01' };
    const b = { id: 'B', n: '나', fs: '2020-01-01' };
    const c = { id: 'C', n: '다', fs: '2026-11-03' };
    const T1 = new Date('2026-11-01T00:00:00Z');
    const T2 = new Date('2026-11-02T00:00:00Z');
    const T3 = new Date('2026-11-03T00:00:00Z');
    const meta = () => JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const body = () => readFileSync(path.join(dir, 'benefits.json'), 'utf8');

    // 옛 형식 파일에서 시작: 항목이 같으면 '변경 없음'이지만 새 형식으로 한 번 다시 써요
    writeFileSync(path.join(dir, 'benefits.json'), JSON.stringify({ updatedAt: '2026-10-01T00:00:00.000Z', source: 'api', count: 2, items: [b, a] }));
    const r0 = await saveData(dir, 'api', [b, a], T1);
    assert.equal(r0.changed, false);
    assert.equal(r0.rewrite, true);
    assert.equal(meta().changedAt, '2026-10-01T00:00:00.000Z');
    const parsed = JSON.parse(body());
    assert.deepEqual(Object.keys(parsed), ['source', 'count', 'items']);
    assert.deepEqual(parsed.items.map((i) => i.id), ['A', 'B']); // id 순서
    assert.equal(body().trim().split('\n').length, 4); // 머리 + 항목 2줄 + 꼬리

    // 순서만 달라져도 변경이 아니에요
    const r1 = await saveData(dir, 'api', [a, b], T2);
    assert.deepEqual([r1.changed, r1.rewrite, r1.added, r1.removed, r1.modified], [false, false, 0, 0, 0]);
    assert.equal(meta().updatedAt, T2.toISOString());
    assert.equal(meta().changedAt, '2026-10-01T00:00:00.000Z');

    // 항목 추가·삭제·수정
    const r2 = await saveData(dir, 'api', [{ ...a, n: '가가' }, c], T3);
    assert.deepEqual([r2.changed, r2.rewrite, r2.added, r2.removed, r2.modified], [true, true, 1, 1, 1]);
    assert.deepEqual(meta(), { updatedAt: T3.toISOString(), changedAt: T3.toISOString(), added: 1, removed: 1, source: 'api', count: 2 });

    // 다음 실행에서 변경이 없으면 added는 마지막 변경 때 값을 유지해요
    const T4 = new Date('2026-11-04T00:00:00Z');
    await saveData(dir, 'api', [{ ...a, n: '가가' }, c], T4);
    assert.deepEqual(meta(), { updatedAt: T4.toISOString(), changedAt: T3.toISOString(), added: 1, removed: 1, source: 'api', count: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(JSON.parse(serializeData('sample', [])).items, []);
});

test('사용자구분: 법인·단체와 같이 쓰는 서비스는 점수만 낮아져요', () => {
  const [it] = buildItems([{ 서비스ID: 'U', 서비스명: 'u', 사용자구분: '개인||법인/시설/단체', 등록일시: '20200101000000' }], [], new Map(), '2026-10-31');
  assert.equal(it.u, '개인||법인/시설/단체');
  const base = ok(mk({ u: '개인' }), {});
  const mixed = ok(mk({ u: '개인||소상공인' }), {});
  assert.ok(mixed.ok);
  assert.equal(mixed.score, base.score - 10);
  assert.equal(ok(mk({}), {}).score, base.score); // 옛 데이터(u 없음)는 그대로
  assert.equal(ok(it, {}).score, base.score - 10);
});
