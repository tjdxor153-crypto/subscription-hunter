// 지원금 매칭 로직 (브라우저와 Node가 함께 쓰는 순수 함수 모음)
// 공공데이터 "대한민국 공공서비스(혜택) 정보" supportConditions의 JA 코드 기준

export const SIDO = [
  { name: '서울', aliases: ['서울특별시', '서울'] },
  { name: '부산', aliases: ['부산광역시', '부산'] },
  { name: '대구', aliases: ['대구광역시', '대구'] },
  { name: '인천', aliases: ['인천광역시', '인천'] },
  { name: '광주', aliases: ['광주광역시', '광주'] },
  { name: '대전', aliases: ['대전광역시', '대전'] },
  { name: '울산', aliases: ['울산광역시', '울산'] },
  { name: '세종', aliases: ['세종특별자치시', '세종'] },
  { name: '경기', aliases: ['경기도', '경기'] },
  { name: '강원', aliases: ['강원특별자치도', '강원도', '강원'] },
  { name: '충북', aliases: ['충청북도', '충북'] },
  { name: '충남', aliases: ['충청남도', '충남'] },
  { name: '전북', aliases: ['전북특별자치도', '전라북도', '전북'] },
  { name: '전남', aliases: ['전라남도', '전남'] },
  { name: '경북', aliases: ['경상북도', '경북'] },
  { name: '경남', aliases: ['경상남도', '경남'] },
  { name: '제주', aliases: ['제주특별자치도', '제주도', '제주'] },
];

// 화면에서 고르는 항목 → JA 코드
export const JOBS = {
  worker: { label: '직장인', codes: ['JA0326'] },
  jobseeker: { label: '구직자·실업자', codes: ['JA0327'] },
  univ: { label: '대학(원)생', codes: ['JA0320'] },
  highschool: { label: '고등학생', codes: ['JA0319'] },
  business: { label: '자영업·창업', codes: ['JA1101', 'JA1102', 'JA1103'] },
  farmer: { label: '농·어·축·임업', codes: ['JA0313', 'JA0314', 'JA0315', 'JA0316'] },
};

export const FAMILY = {
  single: { label: '1인 가구', codes: ['JA0404'] },
  manykids: { label: '다자녀 가구', codes: ['JA0411'] },
  nohouse: { label: '무주택', codes: ['JA0412'] },
  newmove: { label: '최근 전입', codes: ['JA0413'] },
  singleparent: { label: '한부모·조손', codes: ['JA0403'] },
  multicultural: { label: '다문화 가족', codes: ['JA0401'] },
  defector: { label: '북한이탈주민', codes: ['JA0402'] },
  parenting: { label: '임신·출산·육아', codes: ['JA0301', 'JA0302', 'JA0303'] },
};

export const SPECIAL = {
  disabled: { label: '장애인', codes: ['JA0328'] },
  veteran: { label: '국가보훈대상자', codes: ['JA0329'] },
  patient: { label: '질병·질환자', codes: ['JA0330'] },
};

// 기준 중위소득 구간
export const INCOME = [
  { value: '', label: '모름 / 입력 안 함' },
  { value: 'JA0201', label: '중위소득 50% 이하' },
  { value: 'JA0202', label: '중위소득 51~75%' },
  { value: 'JA0203', label: '중위소득 76~100%' },
  { value: 'JA0204', label: '중위소득 101~200%' },
  { value: 'JA0205', label: '중위소득 200% 초과' },
];

const INCOME_CODES = INCOME.map((i) => i.value).filter(Boolean);
const JOB_CODES = Object.values(JOBS).flatMap((j) => j.codes).concat(['JA0317', 'JA0318']);
const TARGET_CODES = [...Object.values(FAMILY), ...Object.values(SPECIAL)].flatMap((f) => f.codes);

export function defaultProfile() {
  return { birthYear: '', gender: '', sido: '', sigungu: '', income: '', jobs: [], family: [], special: [] };
}

export function sidoOf(text) {
  if (!text) return null;
  const t = String(text).trim();
  for (const s of SIDO) {
    if (s.aliases.some((a) => t.startsWith(a))) return s.name;
  }
  return null;
}

// "경기도 수원시 영통구" → { sido: '경기', sigungu: ['수원시', '영통구'] }
export function parseAgency(name) {
  const sido = sidoOf(name);
  if (!sido) return { sido: null, sigungu: [] };
  const rest = String(name).trim().split(/\s+/).slice(1);
  return { sido, sigungu: rest.filter((w) => /[시군구]$/.test(w)) };
}

// 정식 시·도 이름 (예: 서울특별시, 강원도). '서울대학교병원' 같은 기관은 지역으로 보지 않아요
const SIDO_FULL = SIDO.flatMap((s) => s.aliases.filter((a) => a.length >= 3));

// 지역 한정 서비스인지 판단해요. item.ot: 소관기관유형
// 실제 값: 중앙행정기관, 공공기관, 시군구, 광역시도, 교육청, 지방공기업, 지방출자_출연기관
export function regionOf(item) {
  const org = String(item.org || '').trim();
  const ot = String(item.ot || '');
  const none = { sido: null, sigungu: [] };
  if (ot) {
    if (/시군구|광역시도|지방자치단체|지자체|교육청/.test(ot)) return parseAgency(org);
    // '동해시시설관리공단'처럼 이름에 지역이 붙어 있는 지역 기관
    if (/지방공기업|지방출자|출연기관/.test(ot)) {
      if (item.rg) return { sido: item.rg[0], sigungu: item.rg.slice(1) }; // 수집할 때 찾아둔 지역
      return { ...none, localName: org };
    }
    return none;
  }
  const full = SIDO_FULL.some((a) => org === a || org.startsWith(a + ' ') || org.startsWith(a + '교육청'));
  return full ? parseAgency(org) : none;
}

// 구가 있는 일반시: '영통구'만 적어도 '수원시' 서비스를 받을 수 있게 해요
const CITY_GU = [
  ['경기', '수원시', '장안구 권선구 팔달구 영통구'],
  ['경기', '성남시', '수정구 중원구 분당구'],
  ['경기', '고양시', '덕양구 일산동구 일산서구'],
  ['경기', '용인시', '처인구 기흥구 수지구'],
  ['경기', '안산시', '상록구 단원구'],
  ['경기', '안양시', '만안구 동안구'],
  ['경기', '부천시', '원미구 소사구 오정구'],
  ['경기', '화성시', '만세구 효행구 병점구 동탄구'],
  ['충북', '청주시', '상당구 서원구 흥덕구 청원구'],
  ['충남', '천안시', '동남구 서북구'],
  ['전북', '전주시', '완산구 덕진구'],
  ['경북', '포항시', '남구 북구'],
  ['경남', '창원시', '의창구 성산구 마산합포구 마산회원구 진해구'],
];
// '남구'처럼 광역시에도 있는 이름이 있어서 시·도까지 같이 기억해요
export const GU_PARENT = {};
for (const [sido, city, gus] of CITY_GU) {
  for (const gu of gus.split(' ')) (GU_PARENT[gu] ||= []).push({ sido, city });
}

// 내가 적은 시군구('강남', '영통구', '수원시 영통구')와 정확히 같은 기관 시군구를 돌려줘요
export function sigunguMatch(agencyTokens, userText, userSido = '') {
  const mine = String(userText || '').trim().split(/\s+/).filter(Boolean)
    .flatMap((u) => (/[시군구]$/.test(u) ? [u] : [u + '구', u + '시', u + '군']));
  const parents = mine.flatMap((u) => (GU_PARENT[u] || []).filter((x) => x.sido === userSido).map((x) => x.city));
  // 상위 시로 맞추는 건 시 단위 서비스일 때만 (구 단위 서비스는 구가 같아야 해요)
  const cityLevel = !agencyTokens.some((t) => t.endsWith('구'));
  return agencyTokens.find((t) => mine.includes(t) || (cityLevel && parents.includes(t))) || null;
}

// 신청기한 문구에서 마지막 날짜를 찾아요. "상시" 등은 null
export function parseDeadline(text) {
  if (!text) return null;
  const re = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g;
  let m;
  let last = null;
  while ((m = re.exec(text))) last = m;
  if (!last) return null;
  const [, y, mo, d] = last;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function ageOf(birthYear, today = new Date()) {
  const y = Number(birthYear);
  if (!y) return null;
  return today.getFullYear() - y; // 연 나이
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);
}

export function isoDate(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600000); // 한국 시간 기준 날짜
  return k.toISOString().slice(0, 10);
}

/**
 * 한 개의 지원금 항목을 내 조건과 비교해요.
 * item.c: 켜져 있는 JA 코드 배열, item.a: [최소나이, 최대나이] (둘 다 없으면 생략돼요)
 * 반환: { ok, score, reasons[], excluded? }
 */
export function matchItem(item, profile, today = new Date()) {
  const p = { ...defaultProfile(), ...profile };
  const codes = new Set(item.c || []);
  const reasons = [];
  let score = 0;

  // 1) 지역
  const ag = regionOf(item);
  if (ag.sido) {
    if (!p.sido) return { ok: false, score: 0, reasons, excluded: '지역 미입력' };
    if (ag.sido !== p.sido) return { ok: false, score: 0, reasons, excluded: '다른 지역' };
    if (ag.sigungu.length) {
      if (p.sigungu) {
        const hit = sigunguMatch(ag.sigungu, p.sigungu, p.sido);
        if (!hit) return { ok: false, score: 0, reasons, excluded: '다른 시군구' };
        score += 30; reasons.push(`${hit} 거주`);
      } else { score += 5; reasons.push(`${ag.sido} 지역 (시군구 확인 필요)`); }
    } else {
      score += 20; reasons.push(`${ag.sido} 거주`);
    }
  } else if (ag.localName) {
    // 지역 공기업·재단: 이름에 내 시군구나 시·도가 들어 있을 때만 보여줘요
    const mine = String(p.sigungu || '').trim().split(/\s+/).filter(Boolean)
      .flatMap((u) => (/[시군구]$/.test(u) ? [u] : [u + '구', u + '시', u + '군']));
    const sidoAliases = (SIDO.find((s) => s.name === p.sido) || { aliases: [] }).aliases;
    // '고성교육재단'처럼 '군/시/구' 없이 쓴 이름도 찾아요 (두 글자 이상일 때만)
    const hit = mine.find((u) => ag.localName.includes(u) || (u.length >= 3 && ag.localName.includes(u.slice(0, -1))))
      || sidoAliases.find((a) => ag.localName.startsWith(a));
    if (!hit) return { ok: false, score: 0, reasons, excluded: '지역 기관' };
    score += mine.includes(hit) ? 30 : 15; reasons.push(`${hit} 지역 기관`);
  } else {
    reasons.push('전국');
  }

  // 2) 성별
  const male = codes.has('JA0101');
  const female = codes.has('JA0102');
  if (male !== female && p.gender) {
    if ((male && p.gender !== 'M') || (female && p.gender !== 'F')) {
      return { ok: false, score: 0, reasons, excluded: '성별' };
    }
    score += 5;
  }

  // 3) 나이: 태어난 해만 알아서 만 나이는 (연 나이 - 1) 또는 연 나이예요
  const age = ageOf(p.birthYear, today);
  if (item.a && age != null) {
    const [min, max] = item.a;
    const lo = Number(min) || 0;
    const hi = Number(max) >= 100 || !Number(max) ? 999 : Number(max);
    if (hi < age - 1 || lo > age) return { ok: false, score: 0, reasons, excluded: '나이' };
    if (lo > age - 1 || hi < age) { score += 3; reasons.push('나이 확인 필요'); }
    else if (lo > 0 || hi < 999) { score += 15; reasons.push('나이 조건 충족'); }
  }

  // 4) 소득
  const incomeOn = INCOME_CODES.filter((c) => codes.has(c));
  if (incomeOn.length && incomeOn.length < INCOME_CODES.length) {
    if (p.income) {
      if (!incomeOn.includes(p.income)) return { ok: false, score: 0, reasons, excluded: '소득' };
      score += 10; reasons.push('소득 조건 충족');
    } else {
      score -= 5; reasons.push('소득 조건 확인 필요');
    }
  }

  // 5) 직업·신분
  // JA0322(대상특성 해당사항없음)이면 직업 제한이 없어요
  const jobOn = JOB_CODES.filter((c) => codes.has(c));
  if (jobOn.length && !codes.has('JA0322')) {
    const mine = p.jobs.filter((k) => JOBS[k] && JOBS[k].codes.some((c) => codes.has(c)));
    if (!mine.length) return { ok: false, score: 0, reasons, excluded: '직업' };
    score += 15; reasons.push(mine.map((k) => JOBS[k].label).join('·'));
  }

  // 6) 가구·특수 대상: 대상이 정해진 서비스면 내가 해당돼야 해요
  // JA0410(가구유형 해당사항없음)이면 가구 제한이 없어요
  const targetOn = TARGET_CODES.filter((c) => codes.has(c));
  if (targetOn.length && !codes.has('JA0410')) {
    const groups = { ...FAMILY, ...SPECIAL };
    const mineKeys = [...p.family, ...p.special].filter((k) => groups[k] && groups[k].codes.some((c) => codes.has(c)));
    if (!mineKeys.length) return { ok: false, score: 0, reasons, excluded: '대상 가구' };
    score += 20; reasons.push(mineKeys.map((k) => groups[k].label).join('·'));
  }

  // 7) 신규·마감 보너스
  const todayIso = isoDate(today);
  if (item.fs && daysBetween(item.fs, todayIso) <= 3) score += 8;
  const dl = deadlineOf(item);
  if (dl) {
    const left = daysBetween(todayIso, dl);
    if (left < 0) return { ok: false, score: 0, reasons, excluded: '마감 지남' };
    if (left <= 14) score += 6;
  }

  return { ok: true, score, reasons };
}

export function isNew(item, today = new Date(), days = 3) {
  return !!item.fs && daysBetween(item.fs, isoDate(today)) <= days;
}

// 잘리지 않은 신청기한에서 미리 계산한 dd를 먼저 써요
export function deadlineOf(item) {
  return item.dd || parseDeadline(item.due);
}

export function daysLeft(item, today = new Date()) {
  const dl = deadlineOf(item);
  return dl ? daysBetween(isoDate(today), dl) : null;
}

export function rankBenefits(items, profile, today = new Date()) {
  const out = [];
  for (const it of items) {
    const r = matchItem(it, profile, today);
    if (r.ok) out.push({ item: it, score: r.score, reasons: r.reasons });
  }
  out.sort((a, b) => b.score - a.score || (b.item.views || 0) - (a.item.views || 0));
  return out;
}

export function profileFilled(p) {
  return !!(p && p.birthYear && p.sido);
}
