import {
  JOBS, FAMILY, SPECIAL, INCOME, SIDO,
  defaultProfile, rankBenefits, isNew, daysLeft, isoDate, profileFilled,
} from './lib/match.js';

const STORE_KEY = 'hunt.v1';
const naver = (q) => `https://m.search.naver.com/search.naver?query=${encodeURIComponent(q)}`;

const DEFAULT_ATTEND = [
  { id: 'a1', name: '네이버페이 포인트 출석·적립', url: naver('네이버페이 포인트 출석체크'), checks: [] },
  { id: 'a2', name: '삼성닷컴 출석체크 (예시)', url: naver('삼성닷컴 출석체크 이벤트'), checks: [] },
];
const DEFAULT_CAMP = [
  { id: 'c1', name: '넾다세일 (네이버플러스 스토어)', cat: '쇼핑혜택', url: naver('넾다세일 네이버플러스 스토어'), note: '네이버플러스 스토어의 큰 할인 행사예요. 앱 전용 쿠폰을 확인하세요.', checks: [] },
  { id: 'c2', name: '쿠팡 체험단', cat: '체험단', url: naver('쿠팡 체험단'), note: '쿠팡이 초대한 사람만 참여할 수 있어요. 초대 소식을 확인하세요.', checks: [] },
  { id: 'c3', name: '카카오 체험단', cat: '체험단', url: naver('카카오 체험단 모집'), note: '', checks: [] },
  { id: 'c4', name: '무신사 체험단', cat: '체험단', url: naver('무신사 체험단 모집'), note: '', checks: [] },
  { id: 'c5', name: '레뷰', cat: '체험단', url: 'https://www.revu.net/', note: '', checks: [] },
  { id: 'c6', name: '리뷰노트', cat: '체험단', url: 'https://www.reviewnote.co.kr/', note: '', checks: [] },
];

// ---------- 저장소 (폰 브라우저 안에만 저장) ----------
function loadState() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { s = null; }
  return {
    profile: { ...defaultProfile(), ...(s?.profile || {}) },
    attend: Array.isArray(s?.attend) ? s.attend : structuredClone(DEFAULT_ATTEND),
    camp: Array.isArray(s?.camp) ? s.camp : structuredClone(DEFAULT_CAMP),
    stars: Array.isArray(s?.stars) ? s.stars : [],
  };
}
function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch { toast('이 브라우저에서는 저장이 안 돼요. 백업 코드를 따로 보관해 주세요.'); }
}

let state = loadState();
let data = { items: [], source: 'none', updatedAt: null };
let ui = { tab: 'brief', q: '', filter: 'all', field: '', limit: 30 };

// ---------- 도우미 ----------
const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
const today = () => isoDate();
const uid = () => Math.random().toString(36).slice(2, 9);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function checkedToday(entry) { return (entry.checks || []).includes(today()); }
function streak(entry) {
  const set = new Set(entry.checks || []);
  let d = new Date();
  if (!set.has(isoDate(d))) d = new Date(d.getTime() - 86400000);
  let n = 0;
  while (set.has(isoDate(d))) { n++; d = new Date(d.getTime() - 86400000); }
  return n;
}
function toggleCheck(list, id) {
  const e = state[list].find((x) => x.id === id);
  if (!e) return;
  const t = today();
  e.checks = e.checks || [];
  if (e.checks.includes(t)) e.checks = e.checks.filter((d) => d !== t);
  else { e.checks.push(t); e.checks = e.checks.slice(-400); }
  saveState();
}

// 검색할 때마다 다시 계산하지 않도록 기억해 둬요 (데이터나 내 조건이 바뀌면 비워요)
let rankedCache = null;
function ranked() {
  return rankedCache || (rankedCache = rankBenefits(data.items, state.profile));
}
const detailUrl = (item) => item.url || `https://www.gov.kr/portal/rcvfvrSvc/dtlEx/${encodeURIComponent(item.id)}`;

// ---------- 화면: 브리핑 ----------
function renderBrief() {
  const r = ranked();
  const newOnes = r.filter((x) => isNew(x.item));
  const dueSoon = r.filter((x) => { const d = daysLeft(x.item); return d != null && d <= 7; });
  const aDone = state.attend.filter(checkedToday).length;
  const cDone = state.camp.filter(checkedToday).length;
  const d = new Date();
  const dateStr = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });

  let html = `<h2>${esc(dateStr)} 브리핑</h2>`;
  if (data.source === 'sample') {
    html += `<div class="card notice small">지금은 <b>샘플 데이터</b>예요. 공공데이터 인증키를 등록하면 진짜 지원금으로 바뀌어요.</div>`;
  }
  if (!profileFilled(state.profile)) {
    html += `<div class="card"><h3>먼저 내 조건을 알려주세요 🙌</h3>
      <p class="muted">태어난 해와 사는 지역만 넣어도 나에게 맞는 지원금을 골라드려요.</p>
      <button class="btn primary" data-go="me">내 조건 입력하기</button></div>`;
  }
  html += `<div class="stats">
    <button class="stat" data-go="benefits" data-filter="new"><b>${newOnes.length}</b><span>🆕 새 지원금</span></button>
    <button class="stat" data-go="benefits" data-filter="due"><b>${dueSoon.length}</b><span>⏰ 7일 내 마감</span></button>
    <button class="stat ${aDone === state.attend.length && aDone ? 'done' : ''}" data-go="attend"><b>${state.attend.length - aDone}</b><span>✅ 남은 출석 (${aDone}/${state.attend.length})</span></button>
    <button class="stat ${cDone === state.camp.length && cDone ? 'done' : ''}" data-go="camp"><b>${state.camp.length - cDone}</b><span>📰 확인 안 한 체험단</span></button>
  </div>`;

  html += `<h2>오늘 꼭 볼 지원금</h2>`;
  if (!profileFilled(state.profile)) {
    // 조건을 모르면 아무에게나 추천하지 않아요 (기초연금이 20대에게 뜨는 일 방지)
    html += `<div class="card empty">내 조건을 넣으면 여기에 추천이 나와요.</div>`;
  } else {
    const top = [...newOnes, ...dueSoon, ...r].filter((x, i, arr) => arr.indexOf(x) === i).slice(0, 3);
    html += top.length ? top.map(benefitCard).join('') :
      `<div class="card empty">맞는 지원금이 아직 없어요. 내 조건을 조금 더 채워보세요.</div>`;
    if (r.length > 3) html += `<button class="btn" style="width:100%" data-go="benefits">맞춤 지원금 ${r.length}개 모두 보기</button>`;
  }
  $('#tab-brief').innerHTML = html;
}

// ---------- 화면: 지원금 ----------
function benefitCard({ item, reasons }) {
  const left = daysLeft(item);
  const starred = state.stars.includes(item.id);
  const badges = [
    isNew(item) ? '<span class="badge new">🆕 새로 나옴</span>' : '',
    left != null && left <= 14 ? `<span class="badge due">마감 D-${left}</span>` : '',
    item.t ? `<span class="badge type">${esc(item.t)}</span>` : '',
  ].join('');
  return `<article class="card">
    <div>${badges}</div>
    <h3 style="margin-top:6px">${esc(item.n)}</h3>
    ${item.s ? `<p class="muted small">${esc(item.s)}</p>` : ''}
    ${item.ct ? `<p>💰 ${esc(item.ct)}</p>` : ''}
    <p class="reasons">👉 ${esc(reasons.join(' · '))}</p>
    <details><summary>자세히 (대상·기한·기관)</summary>
      ${item.tg ? `<p class="small"><b>대상</b> ${esc(item.tg)}</p>` : ''}
      <p class="small"><b>신청기한</b> ${esc(item.due || '-')}</p>
      ${item.ap ? `<p class="small"><b>신청방법</b> ${esc(item.ap)}</p>` : ''}
      <p class="small"><b>기관</b> ${esc(item.org || '-')} ${item.f ? '· ' + esc(item.f) : ''}</p>
    </details>
    <div class="row" style="margin-top:10px">
      <a class="btn primary small" href="${esc(safeUrl(detailUrl(item)))}" target="_blank" rel="noopener">신청하러 가기 ↗</a>
      <button class="btn small ${starred ? '' : 'ghost'}" data-star="${esc(item.id)}" aria-pressed="${starred}">${starred ? '★ 찜함' : '☆ 찜'}</button>
    </div>
  </article>`;
}

// 검색창은 그대로 두고 목록만 다시 그려요 (한글 입력이 끊기지 않게)
function renderBenefitList() {
  const box = $('#blist');
  if (!box) return;
  let list = ranked();
  if (ui.filter === 'new') list = list.filter((x) => isNew(x.item));
  if (ui.filter === 'due') list = list.filter((x) => { const d = daysLeft(x.item); return d != null && d <= 7; });
  if (ui.filter === 'star') list = list.filter((x) => state.stars.includes(x.item.id));
  if (ui.field) list = list.filter((x) => x.item.f === ui.field);
  if (ui.q.trim()) {
    const q = ui.q.trim().toLowerCase();
    list = list.filter((x) => [x.item.n, x.item.s, x.item.ct, x.item.tg, x.item.org].join(' ').toLowerCase().includes(q));
  }
  let html = `<p class="muted small">${list.length}개 · 점수 높은 순</p>`;
  html += list.slice(0, ui.limit).map(benefitCard).join('') ||
    `<div class="card empty">조건에 맞는 항목이 없어요.</div>`;
  if (list.length > ui.limit) html += `<button class="btn" style="width:100%" id="more">더 보기 (${list.length - ui.limit}개 남음)</button>`;
  box.innerHTML = html;
}

function renderBenefits() {
  const fields = [...new Set(ranked().map((x) => x.item.f).filter(Boolean))].sort();
  const filters = [['all', '전체'], ['new', '🆕 새로 나옴'], ['due', '⏰ 마감 임박'], ['star', '★ 찜']];
  let html = `<h2>나에게 맞는 지원금</h2>
    <div class="toolbar">
      <input type="text" id="q" placeholder="검색 (예: 월세, 교통비)" value="${esc(ui.q)}" aria-label="검색">
      <select id="field" aria-label="분야">
        <option value="">모든 분야</option>
        ${fields.map((f) => `<option ${f === ui.field ? 'selected' : ''}>${esc(f)}</option>`).join('')}
      </select>
    </div>
    <div class="row" style="margin-bottom:12px">
      ${filters.map(([k, l]) => `<button class="btn small ${ui.filter === k ? 'primary' : ''}" data-filter-set="${k}">${l}</button>`).join('')}
    </div>`;
  if (!profileFilled(state.profile)) {
    html += `<div class="card notice small">내 조건(태어난 해, 지역)을 넣으면 더 정확해져요. <button class="btn small" data-go="me">입력하기</button></div>`;
  }
  html += `<div id="blist"></div>`;
  html += `<p class="muted small">※ 자격은 공공데이터에 적힌 조건으로 추정한 거예요. 최종 확인은 신청 페이지에서 해주세요.</p>`;
  $('#tab-benefits').innerHTML = html;
  renderBenefitList();
}

// ---------- 화면: 출석 / 체험단 ----------
function linkList(listKey, title, intro) {
  const items = state[listKey];
  const done = items.filter(checkedToday).length;
  let html = `<h2>${title}</h2><p class="muted small">${intro}</p>
    <p><b>오늘 ${done}/${items.length}</b> 완료</p>`;
  html += items.map((e) => {
    const on = checkedToday(e);
    const st = streak(e);
    return `<div class="card list-item">
      <button class="check ${on ? 'on' : ''}" data-check="${listKey}:${esc(e.id)}" aria-pressed="${on}" aria-label="${esc(e.name)} 오늘 완료">${on ? '✓' : ''}</button>
      <div class="grow">
        <a class="name" href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener">${esc(e.name)} ↗</a>
        ${e.cat ? ` <span class="badge type">${esc(e.cat)}</span>` : ''}
        ${e.note ? `<p class="muted small">${esc(e.note)}</p>` : ''}
        <p class="muted small">${st ? `🔥 ${st}일 연속` : '아직 기록 없음'}</p>
      </div>
      <button class="btn small ghost" data-del="${listKey}:${esc(e.id)}" aria-label="${esc(e.name)} 삭제">삭제</button>
    </div>`;
  }).join('') || `<div class="card empty">목록이 비어 있어요. 아래에서 추가해 주세요.</div>`;
  html += `<form class="card" data-add="${listKey}">
    <h3>＋ 사이트 추가</h3>
    <label for="${listKey}-name">이름</label>
    <input type="text" id="${listKey}-name" name="name" required placeholder="예: 리뷰노트">
    <label for="${listKey}-url">주소</label>
    <input type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" id="${listKey}-url" name="url" required placeholder="예: www.reviewnote.co.kr">
    ${listKey === 'camp' ? `<label for="camp-cat">종류</label><select id="camp-cat" name="cat"><option>체험단</option><option>쇼핑혜택</option></select>` : ''}
    <div style="margin-top:12px"><button class="btn primary" type="submit">추가하기</button></div>
  </form>`;
  return html;
}
function renderAttend() {
  $('#tab-attend').innerHTML = linkList('attend', '출석 도장판',
    '이름을 누르면 사이트로 이동해요. 출석을 마치고 돌아와서 동그라미를 눌러 도장을 찍어주세요.');
}
function renderCamp() {
  $('#tab-camp').innerHTML = linkList('camp', '체험단 · 쇼핑혜택',
    '하루 한 번 둘러보고 확인 표시를 해주세요. 신청은 각 사이트에서 직접 해요(계정 안전을 위해 자동 신청은 하지 않아요).');
}

// ---------- 화면: 내 조건 ----------
function chips(name, dict, selected) {
  return `<div class="chips">${Object.entries(dict).map(([k, v]) =>
    `<label class="chip"><input type="checkbox" name="${name}" value="${k}" ${selected.includes(k) ? 'checked' : ''}><span>${esc(v.label)}</span></label>`).join('')}</div>`;
}
function renderMe() {
  const p = state.profile;
  const upd = data.updatedAt ? new Date(data.updatedAt).toLocaleString('ko-KR') : '없음';
  $('#tab-me').innerHTML = `<h2>내 조건</h2>
  <form class="card" id="profile-form">
    <p class="muted small">이 정보는 이 폰 안에만 저장되고 어디에도 보내지 않아요.</p>
    <label for="birthYear">태어난 해</label>
    <input type="text" id="birthYear" name="birthYear" inputmode="numeric" maxlength="4" autocomplete="bday-year" placeholder="예: 1995" value="${esc(p.birthYear)}">
    <label for="gender">성별</label>
    <select id="gender" name="gender">
      <option value="" ${!p.gender ? 'selected' : ''}>선택 안 함</option>
      <option value="M" ${p.gender === 'M' ? 'selected' : ''}>남성</option>
      <option value="F" ${p.gender === 'F' ? 'selected' : ''}>여성</option>
    </select>
    <label for="sido">사는 곳 (시·도)</label>
    <select id="sido" name="sido">
      <option value="">선택해 주세요</option>
      ${SIDO.map((s) => `<option value="${s.name}" ${p.sido === s.name ? 'selected' : ''}>${s.aliases[0]}</option>`).join('')}
    </select>
    <label for="sigungu">시·군·구</label>
    <input type="text" id="sigungu" name="sigungu" placeholder="예: 강남구, 수원시 영통구" value="${esc(p.sigungu)}">
    <p class="muted small">구가 있는 시는 '수원시 영통구'처럼 시와 구를 함께 적어주세요.</p>
    <label for="income">소득 수준 (기준 중위소득)</label>
    <select id="income" name="income">
      ${INCOME.map((i) => `<option value="${i.value}" ${p.income === i.value ? 'selected' : ''}>${i.label}</option>`).join('')}
    </select>
    <p class="muted small">잘 모르시면 "모름"으로 두세요. 1인 가구 기준 중위소득 100%는 월 약 250만원 정도예요.</p>
    <label>하는 일 (여러 개 가능)</label>${chips('jobs', JOBS, p.jobs)}
    <label>가구 상황 (여러 개 가능)</label>${chips('family', FAMILY, p.family)}
    <label>해당되는 것 (있으면)</label>${chips('special', SPECIAL, p.special)}
    <div style="margin-top:16px"><button class="btn primary" type="submit" style="width:100%">저장하기</button></div>
  </form>

  <div class="card">
    <h3>💾 백업 · 옮기기</h3>
    <p class="muted small">폰을 바꾸거나 기록이 지워질 때를 대비해서 백업 코드를 메모장이나 카톡 '나에게 보내기'에 보관해 두세요.</p>
    <div class="row"><button class="btn" id="backup">백업 코드 복사</button></div>
    <label for="restore-text">백업 코드 붙여넣기</label>
    <textarea id="restore-text" placeholder="복사해 둔 백업 코드를 여기에 붙여넣으세요"></textarea>
    <div class="row" style="margin-top:8px"><button class="btn" id="restore">불러오기</button></div>
  </div>

  <div class="card small muted">
    <p>지원금 데이터 갱신: ${esc(upd)} (${data.source === 'api' ? '공공데이터' : data.source === 'sample' ? '샘플' : '없음'}, ${data.items.length}개)</p>
    <p>매일 아침 7시쯤 자동으로 새로 받아와요.</p>
  </div>`;
}

// ---------- 공통 렌더 / 이벤트 ----------
const RENDER = { brief: renderBrief, benefits: renderBenefits, attend: renderAttend, camp: renderCamp, me: renderMe };
function render() {
  document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.dataset.tab !== ui.tab; });
  document.querySelectorAll('.tabbar button').forEach((b) => {
    if (b.dataset.go === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  RENDER[ui.tab]();
  const upd = data.updatedAt ? new Date(data.updatedAt) : null;
  $('#updated').textContent = upd ? `지원금 갱신 ${upd.toLocaleDateString('ko-KR')} ${upd.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : '지원금 데이터를 불러오는 중…';
}
function go(tab, filter) {
  ui.tab = tab;
  if (filter) { ui.filter = filter; ui.limit = 30; ui.q = ''; ui.field = ''; }
  try { sessionStorage.setItem('hunt.tab', tab); } catch {}
  render();
  window.scrollTo(0, 0);
}

document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('button, a');
  if (!t) return;
  if (t.dataset.go) { go(t.dataset.go, t.dataset.filter); return; }
  if (t.dataset.filterSet) { ui.filter = t.dataset.filterSet; ui.limit = 30; render(); return; }
  if (t.id === 'more') { ui.limit += 30; renderBenefitList(); return; }
  if (t.dataset.star) {
    const id = t.dataset.star;
    state.stars = state.stars.includes(id) ? state.stars.filter((x) => x !== id) : [...state.stars, id];
    saveState(); render(); return;
  }
  if (t.dataset.check) {
    const [list, id] = t.dataset.check.split(':');
    toggleCheck(list, id);
    render();
    if (state[list].find((x) => x.id === id && checkedToday(x))) toast('도장 쾅! 👍');
    return;
  }
  if (t.dataset.del) {
    const [list, id] = t.dataset.del.split(':');
    const e = state[list].find((x) => x.id === id);
    if (e && confirm(`'${e.name}'을(를) 목록에서 지울까요?`)) {
      state[list] = state[list].filter((x) => x.id !== id);
      saveState(); render(); toast('지웠어요');
    }
    return;
  }
  if (t.id === 'backup') {
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    try { await navigator.clipboard.writeText(code); toast('백업 코드를 복사했어요. 안전한 곳에 붙여넣어 두세요.'); }
    catch { $('#restore-text').value = code; toast('복사가 막혀 있어서 아래 칸에 코드를 넣어뒀어요. 길게 눌러 복사하세요.'); }
    return;
  }
  if (t.id === 'restore') {
    try {
      const obj = JSON.parse(decodeURIComponent(escape(atob($('#restore-text').value.trim()))));
      if (!obj || typeof obj !== 'object' || !obj.profile) throw new Error('bad');
      localStorage.setItem(STORE_KEY, JSON.stringify(obj));
      state = loadState();
      rankedCache = null;
      render(); toast('불러왔어요!');
    } catch { toast('백업 코드가 올바르지 않아요. 전체를 정확히 붙여넣었는지 확인해 주세요.'); }
  }
});

document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target;
  if (f.id === 'profile-form') {
    const fd = new FormData(f);
    const birthYear = String(fd.get('birthYear') || '').trim();
    if (birthYear && !/^(19|20)\d{2}$/.test(birthYear)) {
      toast('태어난 해를 4자리로 적어주세요 (예: 1995)');
      $('#birthYear').focus();
      return;
    }
    state.profile = {
      birthYear,
      gender: fd.get('gender') || '',
      sido: fd.get('sido') || '',
      sigungu: String(fd.get('sigungu') || '').trim(),
      income: fd.get('income') || '',
      jobs: fd.getAll('jobs'),
      family: fd.getAll('family'),
      special: fd.getAll('special'),
    };
    saveState();
    rankedCache = null;
    const n = ranked().length;
    toast(`저장했어요! 맞춤 지원금 ${n}개를 찾았어요.`);
    go('brief');
    return;
  }
  if (f.dataset.add) {
    const fd = new FormData(f);
    let url = String(fd.get('url') || '').trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url; // www.… 처럼 적어도 괜찮아요
    try {
      const u = new URL(url);
      if (!u.hostname.includes('.')) throw new Error('host');
      url = u.href;
    } catch {
      toast('주소가 올바르지 않아요. 예: www.reviewnote.co.kr');
      return;
    }
    const entry = { id: uid(), name: String(fd.get('name')).trim(), url, checks: [] };
    if (f.dataset.add === 'camp') { entry.cat = fd.get('cat') || '체험단'; entry.note = ''; }
    state[f.dataset.add].push(entry);
    saveState(); render(); toast('추가했어요');
  }
});

// 검색: 한글 조합 중에는 기다렸다가, 글자가 완성되면 목록만 다시 그려요
function onSearch(ev) {
  if (ev.target.id !== 'q' || ev.isComposing) return;
  ui.q = ev.target.value; ui.limit = 30;
  renderBenefitList();
}
document.addEventListener('input', onSearch);
document.addEventListener('compositionend', onSearch);
document.addEventListener('change', (ev) => {
  if (ev.target.id === 'field') { ui.field = ev.target.value; ui.limit = 30; renderBenefitList(); }
});

async function loadData() {
  try {
    // meta.json이 없으면(옛 형식) benefits.json 안의 값을 그대로 써요
    const [res, meta] = await Promise.all([
      fetch('data/benefits.json', { cache: 'no-cache' }),
      fetch('data/meta.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (!res.ok) throw new Error(res.status);
    data = { ...(await res.json()), ...(meta || {}) };
    rankedCache = null;
  } catch {
    toast('지원금 데이터를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
  }
  render();
}

try { const t = sessionStorage.getItem('hunt.tab'); if (t && RENDER[t]) ui.tab = t; } catch {}
render();
loadData();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
