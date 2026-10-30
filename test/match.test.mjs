import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchItem, rankBenefits, parseDeadline, parseAgency, sidoOf, isNew, daysLeft } from '../lib/match.js';
import { buildItems } from '../scripts/fetch-benefits.mjs';

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
