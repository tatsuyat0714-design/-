'use strict';
// ===== ゲーム本体（育成・大会進行・画面） =====
const SAVE_KEY = 'chojigen_eleven_save_v1';
const TEAM_COLORS = ['#2563eb', '#dc2626', '#f59e0b', '#16a34a', '#9333ea', '#0891b2', '#111827', '#ec4899'];
let G = null;
let currentMatch = null;
let ui = { lineupSlot: null, shopTab: 'item' };

const $app = () => document.getElementById('app');

// ---------- セーブ ----------
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) { /* 保存不可の環境 */ } }
function loadSave() { try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
function hasSave() { const s = loadSave(); return !!(s && s.version === 1); }

// ---------- 状態ヘルパー ----------
const stage = () => STAGES[G.stageIdx];
const matchDef = () => stage().matches[G.matchIdx];
const byId = id => G.roster.find(p => p.id === id);
const lineupPlayers = () => G.lineup.map(byId);
const avgLevel = list => Math.round(list.reduce((a, p) => a + p.level, 0) / list.length);
const fill = s => s.replace(/\{team\}/g, G ? G.teamName : '');

function addLog(msg) {
  G.log.unshift(`Day${G.day}: ${msg}`);
  G.log = G.log.slice(0, 12);
}

function newGame(teamName, color) {
  G = {
    version: 1, teamName, color, money: 5000, day: 1,
    stageIdx: 0, matchIdx: 0, daysLeft: STAGES[0].firstDays,
    roster: STARTING_MEMBERS.map(m => createPlayer(m)),
    formation: '4-4-2', lineup: [],
    record: { w: 0, d: 0, l: 0, gf: 0, ga: 0 },
    group: null, scoutPool: [], settings: { auto: false, speed: 1 },
    log: [], cleared: false, retries: 0, lastResult: null,
  };
  G.lineup = autoLineup();
  G.scoutPool = genScoutPool();
  addLog(`${teamName}サッカー部、始動！`);
  save();
}

function autoLineup() {
  const used = new Set();
  return FORMATIONS[G.formation].map(([pos]) => {
    const score = p => overall(p) * (0.85 + p.cond * 0.0015);
    let cand = G.roster.filter(p => !used.has(p.id) && p.pos === pos).sort((a, b) => score(b) - score(a));
    if (!cand.length) cand = G.roster.filter(p => !used.has(p.id) && p.pos !== 'GK').sort((a, b) => score(b) - score(a));
    if (!cand.length) cand = G.roster.filter(p => !used.has(p.id));
    used.add(cand[0].id);
    return cand[0].id;
  });
}

function validateLineup() {
  const used = new Set();
  G.lineup = G.lineup.map(id => (byId(id) && !used.has(id) && used.add(id)) ? id : null);
  G.lineup.forEach((id, i) => {
    if (id) return;
    const pos = FORMATIONS[G.formation][i][0];
    const free = G.roster.filter(p => !used.has(p.id));
    const c = free.find(p => p.pos === pos) || free[0];
    G.lineup[i] = c.id; used.add(c.id);
  });
}

function genScoutPool() {
  const lv = avgLevel(lineupPlayers());
  const pool = [];
  const posList = ['FW', 'FW', 'MF', 'MF', 'DF', 'DF', 'GK'];
  for (let i = 0; i < 5; i++) {
    const level = Math.max(1, lv + rint(-2, 4));
    const talent = Math.round(rnd(1.0, 1.2) * 100) / 100;
    const p = createPlayer({ name: genJpName(Math.random), pos: pick(posList), element: pick(ELEMENT_KEYS), level, talent });
    p.price = Math.round((level * level * 8 * talent + 1000) / 100) * 100;
    pool.push(p);
  }
  if (G.stageIdx === 2) {
    const el = pick(ELEMENT_KEYS);
    const pos = pick(['FW', 'GK', 'MF']);
    const legendMove = pos === 'GK' ? `catch_${el}_5` : pos === 'FW' ? `shoot_${el}_5` : `dribble_${el}_4`;
    const p = createPlayer({ name: genJpName(Math.random), pos, element: el, level: lv + 3, talent: 1.25, learnExtra: [[lv + 6, legendMove]] });
    p.price = Math.round(((lv + 3) ** 2 * 16 + 5000) / 100) * 100;
    p.tag = '伝説の選手';
    pool.push(p);
  }
  return pool;
}

function rivalRecruits() {
  const lv = avgLevel(lineupPlayers());
  const list = [];
  for (const def of STAGES[1].matches.map(m => m.team).filter(t => ['kokuryu', 'teio'].includes(t.id))) {
    const a = def.ace;
    const p = createPlayer({ name: a.name, pos: a.pos, element: a.element, level: lv + 2, talent: 1.15 });
    p.price = 0; p.tag = `元${def.name}のライバル`;
    list.push(p);
  }
  return list;
}

// ---------- 共通UI ----------
function render(html) {
  $app().innerHTML = html;
  window.scrollTo(0, 0);
}
function modal(html, wide) {
  const m = document.getElementById('modal');
  m.querySelector('.modal-box').innerHTML = html;
  m.querySelector('.modal-box').classList.toggle('wide', !!wide);
  m.classList.add('show');
}
function closeModal() { document.getElementById('modal').classList.remove('show'); }
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
function condClass(c) { return c >= 70 ? 'good' : c >= 40 ? 'mid' : 'bad'; }
function moveChip(slot, player) {
  const m = MOVES[slot.id];
  return `<span class="move-chip" style="--ec:${ELEMENTS[m.element].color}">${esc(moveLabel(slot))}<small>${MOVE_TYPES[m.type].jp}・威力${Math.round(movePower(player, slot))}・TP${m.tp}</small></span>`;
}
function playerRow(p, extra = '') {
  return `<div class="prow" data-act="player" data-id="${p.id}">
    <span class="pos pos-${p.pos}">${p.pos}</span>${elemBadge(p.element)}
    <span class="pname">${esc(p.name)}${p.captain ? ' <i class="cap">C</i>' : ''}</span>
    <span class="plv">Lv${p.level}</span><span class="povr">総合${overall(p)}</span>
    <span class="pcond ${condClass(p.cond)}">調子${Math.round(p.cond)}</span>${extra}</div>`;
}

// ---------- タイトル ----------
function renderTitle() {
  render(`<div class="title-screen">
    <div class="title-logo"><span>超次元</span>サッカー<em>ELEVEN LEGENDS</em></div>
    <p class="title-sub">選手を育て、必殺技を極め、世界の頂点へ。</p>
    <div class="title-btns">
      ${hasSave() ? `<button class="btn primary big" data-act="continue">つづきから</button>` : ''}
      <button class="btn big ${hasSave() ? '' : 'primary'}" data-act="newgame">はじめから</button>
      <button class="btn" data-act="howto">遊び方</button>
      ${installButtonHtml()}
    </div>
  </div>`);
}

// ---------- アプリ化（PWA） ----------
let deferredInstall = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installButtonHtml() {
  if (isStandalone()) return '';
  if (deferredInstall || isIOS()) return `<button class="btn" data-act="install">📲 アプリとしてインストール</button>`;
  return '';
}
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  if (document.querySelector('.title-screen')) renderTitle();
});
window.addEventListener('appinstalled', () => { deferredInstall = null; toast('ホーム画面に追加しました！'); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

function howtoHtml() {
  return `<h2>遊び方</h2>
  <h3>育成パート</h3>
  <ul>
    <li>試合までの日数を使って<b>トレーニング</b>や<b>休養</b>を行います（1回 = 1日）。</li>
    <li>トレーニングで経験値と能力が上がり、レベルアップで<b>必殺技</b>を習得します。</li>
    <li>疲れると練習効率や試合での力が落ちます。<b>コンディション</b>に注意！</li>
    <li>ショップの<b>秘伝書</b>で好きな必殺技を覚えさせたり、<b>スカウト</b>で新戦力を獲得できます。</li>
    <li>必殺技は使うほど熟練度が上がり「改」「真」へ進化します。</li>
  </ul>
  <h3>試合パート</h3>
  <ul>
    <li>ボールを持った味方は自動でドリブルします。<b>ピッチをタップ</b>するとその方向へドリブル。</li>
    <li><b>パス</b>ボタン → 味方をタップでパス。<b>シュート</b>ボタンで好きな位置からシュート。</li>
    <li>敵と接触すると<b>コマンドバトル</b>！ 必殺技（TP消費）か通常技を選びます。</li>
    <li>シュートは「シュート威力」vs「キーパー」の勝負。遠いほど威力が落ちます。</li>
    <li>相手のシュートにはキーパーの必殺技で対抗！ TPの配分が勝負の鍵です。</li>
    <li><b>オート</b>にするとすべて自動で進行します。<b>速度</b>は x1〜x3。</li>
  </ul>
  <h3>属性</h3>
  <p class="elem-cycle">${elemBadge('fire')} → ${elemBadge('wood')} → ${elemBadge('wind')} → ${elemBadge('earth')} → ${elemBadge('fire')}<br><small>矢印の先の属性に強い（技の威力1.15倍）。選手と同じ属性の技は威力1.1倍。</small></p>
  <h3>大会</h3>
  <p>地区予選（3試合）→ 全国大会（4試合）→ 世界大会（グループリーグ3試合＋決勝トーナメント3試合）。トーナメントで引き分けはPK戦。負けても特訓してリベンジできます。</p>
  <div class="modal-actions"><button class="btn primary" data-act="close">閉じる</button></div>`;
}

function renderIntro() {
  render(`<div class="card intro">
    <h2>チーム結成</h2>
    <label>チーム名<input id="team-name" maxlength="10" value="流星中"></label>
    <label>チームカラー</label>
    <div class="colors">${TEAM_COLORS.map((c, i) => `<button class="color${i === 0 ? ' sel' : ''}" data-act="color" data-color="${c}" style="background:${c}"></button>`).join('')}</div>
    <button class="btn primary big" data-act="start">この名前で始める</button>
    <button class="btn" data-act="title">戻る</button>
  </div>`);
}

// ---------- ストーリー ----------
const STORIES = {
  intro: [
    ['', '超次元サッカー――それは人知を超えた必殺技がぶつかり合う、究極のサッカー。'],
    ['', '世界の頂点を決める大会『ギャラクシーカップ』。その舞台に立てるのは、選ばれし者だけ。'],
    ['天城 翔', '監督！ 俺たち、本気で世界一を目指したいんです！'],
    ['守山 大地', '部員は13人、グラウンドもボロボロ…。でも、気持ちだけはどこにも負けません！'],
    ['', 'あなたは{team}サッカー部の新監督。選手を鍛え、必殺技を磨き、地区予選から世界の頂点を目指せ！'],
  ],
  regionalClear: [
    ['', '地区予選、優勝――！'],
    ['天城 翔', 'やった…！ 俺たちが地区の頂点だ！'],
    ['早瀬 疾人', 'でも全国にはもっとすごい奴らがいる。特に40年無敗の帝王学園…。'],
    ['', '次なる舞台は全国大会「ジャパンカップ」。さらなる特訓が待っている！'],
  ],
  nationalClear: [
    ['', '全国制覇――！ {team}が日本一に輝いた！'],
    ['', 'そして大会後、{team}のメンバーを中心とした日本代表が結成された。'],
    ['皇 王牙', '…フン。お前たちとなら世界を獲れるかもしれん。'],
    ['龍崎 焔', '俺の炎、世界でも使わせてもらうぜ！'],
    ['', 'かつてのライバルたちがスカウトに名乗りを上げた！ 世界大会「ギャラクシーカップ」へ挑め！'],
  ],
  groupClear: [
    ['', 'グループリーグ突破！ 決勝トーナメント進出だ！'],
    ['天城 翔', 'ここからは一発勝負。負けたら終わりだ…全力でいくぞ！'],
  ],
  groupFail: [
    ['', 'グループリーグ敗退…。しかし、まだ終わりではない！'],
    ['', '大会運営の特別措置により、もう一度グループリーグに挑戦できることになった。'],
    ['守山 大地', '次こそは…絶対にゴールを守り抜く！'],
  ],
  retry: [
    ['', '惜しくも敗れてしまった…。'],
    ['天城 翔', 'このままじゃ終われない！ 監督、特訓をお願いします！'],
    ['', '3日間の特訓の後、もう一度挑戦だ！（勝つまで何度でも挑めます）'],
  ],
  final: [
    ['ゼノ', 'よくぞここまで来た。だが、超次元サッカーの頂点は我らギャラクシー・オーダーのものだ。'],
    ['天城 翔', '俺たちは仲間と一緒に強くなった。その力、見せてやる！'],
  ],
};

function renderStory(key, next) {
  const lines = STORIES[key];
  let i = 0;
  const show = () => {
    const [who, text] = lines[i];
    render(`<div class="story" data-act="story-next">
      <div class="story-box">
        ${who ? `<div class="story-who">${esc(who)}</div>` : ''}
        <div class="story-text">${esc(fill(text))}</div>
        <div class="story-hint">タップで次へ ▼ (${i + 1}/${lines.length})</div>
      </div>
      <button class="btn small skip" data-act="story-skip">スキップ</button>
    </div>`);
  };
  ui.storyNext = () => { i++; if (i >= lines.length) next(); else show(); };
  ui.storySkip = next;
  show();
}

// ---------- ハブ ----------
function renderHub() {
  validateLineup();
  const st = stage(), md = matchDef();
  const lp = lineupPlayers();
  const avgCond = Math.round(G.roster.reduce((a, p) => a + p.cond, 0) / G.roster.length);
  const opp = md.team;
  const canMatch = G.daysLeft <= 0;
  render(`
  <header class="topbar" style="--tc:${G.color}">
    <div class="tb-team">${esc(G.teamName)}</div>
    <div class="tb-info"><span>${yen(G.money)}</span><span>Day ${G.day}</span></div>
  </header>
  <section class="card next-match">
    <div class="stage-name">${esc(st.name)}　<b>${esc(md.round)}</b></div>
    <div class="vs-line"><span class="tdot" style="background:${G.color}"></span>${esc(G.teamName)} <em>VS</em> <span class="tdot" style="background:${opp.color}"></span>${esc(opp.name)}</div>
    <div class="vs-sub">相手の平均Lv 約${opp.lv}・${ELEMENTS[opp.element].jp}属性中心　/　こちらの平均Lv ${avgLevel(lp)}</div>
    <div class="days">${canMatch ? '<b>試合当日！</b>' : `試合まで あと <b>${G.daysLeft}</b> 日`}</div>
  </section>
  <section class="actions">
    ${canMatch ? `<button class="tile hot wide" data-act="prematch">⚽ 試合へ</button>` : `
    <button class="tile" data-act="training">🏃 トレーニング</button>
    <button class="tile" data-act="rest">😴 休養</button>
    <button class="tile dim" data-act="skipdays">⏩ 試合へ進む</button>`}
    <button class="tile" data-act="lineup">📋 編成</button>
    <button class="tile" data-act="roster">👥 選手一覧</button>
    <button class="tile" data-act="shop">🛒 ショップ</button>
    <button class="tile" data-act="scout">🔍 スカウト</button>
    <button class="tile" data-act="info">🏆 大会情報</button>
    <button class="tile dim" data-act="menu">⚙ メニュー</button>
  </section>
  <section class="card">
    <h3>チーム状況</h3>
    <div class="stats-grid">
      <div><small>スタメン平均Lv</small><b>${avgLevel(lp)}</b></div>
      <div><small>スタメン総合力</small><b>${Math.round(teamStrength(lp))}</b></div>
      <div><small>平均コンディション</small><b class="${condClass(avgCond)}">${avgCond}</b></div>
      <div><small>通算成績</small><b>${G.record.w}勝${G.record.d}分${G.record.l}敗</b></div>
    </div>
  </section>
  <section class="card"><h3>活動記録</h3><ul class="loglist">${G.log.map(l => `<li>${esc(l)}</li>`).join('')}</ul></section>`);
}

// ---------- トレーニング ----------
function renderTraining() {
  const avgCond = Math.round(G.roster.reduce((a, p) => a + p.cond, 0) / G.roster.length);
  render(`
  <header class="subbar"><button class="btn small" data-act="hub">← 戻る</button><h2>トレーニング</h2><span>残り${G.daysLeft}日</span></header>
  <p class="note">全員（控え含む）が参加します。平均コンディション：<b class="${condClass(avgCond)}">${avgCond}</b>${avgCond < 40 ? '　<span class="bad">疲れが溜まっています。休養をおすすめします。</span>' : ''}</p>
  <section class="train-list">
    ${Object.entries(TRAININGS).map(([id, t]) => `
      <button class="train" data-act="train" data-id="${id}">
        <span class="ticon">${t.icon}</span><span class="tname">${t.name}</span>
        <span class="tdesc">${t.desc}</span><span class="tfat">疲労 -${t.fatigue}</span>
      </button>`).join('')}
    <button class="train rest" data-act="rest"><span class="ticon">😴</span><span class="tname">休養</span><span class="tdesc">全員のコンディションが大きく回復する</span><span class="tfat">調子 +45</span></button>
  </section>`);
}

function endDay() {
  G.daysLeft--; G.day++;
}

function doTraining(id) {
  const t = TRAININGS[id];
  const gains = {};
  const levelUps = [];
  for (const p of G.roster) {
    const eff = p.cond >= 60 ? 1 : p.cond >= 30 ? 0.7 : 0.4;
    for (const [stat, mults] of Object.entries(t.stats)) {
      const g = (mults[p.pos] || 0) * eff * rnd(0.7, 1.3) * (stat === 'tp' ? 1 : p.talent);
      p.stats[stat] += g;
      gains[stat] = (gains[stat] || 0) + g;
    }
    if (t.moveUses) p.moves.forEach(s => { s.uses = (s.uses || 0) + t.moveUses; });
    const before = p.level;
    const res = gainExp(p, t.exp * eff * rnd(0.9, 1.1));
    if (res.levels) levelUps.push({ p, before, learned: res.learned });
    p.cond = Math.max(0, p.cond - t.fatigue);
  }
  const ev = randomEvent();
  endDay();
  addLog(`${t.name}を行った`);
  save();
  const n = G.roster.length;
  const gainHtml = Object.entries(gains).map(([k, v]) => `<li>${STAT_LABELS[k]} 平均 <b>+${(v / n).toFixed(1)}</b></li>`).join('');
  modal(`<h2>${t.icon} ${t.name}</h2>
    <ul class="gains">${gainHtml}${t.moveUses ? `<li>全員の必殺技熟練度 +${t.moveUses}</li>` : ''}</ul>
    ${levelUpHtml(levelUps)}
    ${ev ? `<div class="event">📣 ${esc(ev)}</div>` : ''}
    <div class="modal-actions"><button class="btn primary" data-act="close-hub">OK</button></div>`);
}

function levelUpHtml(levelUps) {
  if (!levelUps.length) return '';
  return `<h3>レベルアップ！</h3><ul class="levelups">${levelUps.map(({ p, before, learned }) =>
    `<li><b>${esc(p.name)}</b> Lv${before} → <b>Lv${p.level}</b>${learned.map(l =>
      `<div class="learned" style="--ec:${ELEMENTS[MOVES[l.id].element].color}">🔥 必殺技「${esc(MOVES[l.id].name)}」を習得！${l.replaced ? `（${esc(MOVES[l.replaced].name)}から進化）` : ''}</div>`).join('')}</li>`).join('')}</ul>`;
}

function randomEvent() {
  if (Math.random() > 0.2) return null;
  const p = pick(G.roster);
  const r = Math.random();
  if (r < 0.35) {
    const key = { GK: 'catch', DF: 'guard', MF: 'control', FW: 'kick' }[p.pos];
    p.stats[key] += 3; gainExp(p, 60);
    return `${p.name}が特訓中に何かを掴んだ！（${STAT_LABELS[key]} +3）`;
  }
  if (r < 0.6) { G.money += 1000; return 'OB会から差し入れが届いた！（資金 +¥1,000）'; }
  if (r < 0.85 && p.moves.length) {
    const s = pick(p.moves); s.uses = (s.uses || 0) + 3;
    return `${p.name}の「${MOVES[s.id].name}」に磨きがかかった！（熟練度 +3）`;
  }
  G.roster.forEach(q => { q.cond = Math.min(100, q.cond + 10); });
  return '全員でミーティング。チームの雰囲気が良くなった！（全員 調子 +10）';
}

function doRest() {
  G.roster.forEach(p => { p.cond = Math.min(100, p.cond + 45); });
  endDay();
  addLog('休養でリフレッシュした');
  save();
  modal(`<h2>😴 休養</h2><p>全員のコンディションが回復した！</p><div class="modal-actions"><button class="btn primary" data-act="close-hub">OK</button></div>`);
}

// ---------- 編成 ----------
function renderLineup() {
  validateLineup();
  const slots = FORMATIONS[G.formation];
  const sel = ui.lineupSlot;
  const pitch = slots.map(([pos, x, y], i) => {
    const p = byId(G.lineup[i]);
    const mis = p.pos !== pos;
    return `<button class="slot${sel === i ? ' sel' : ''}${mis ? ' mis' : ''}" data-act="slot" data-i="${i}" style="left:${y / 64 * 100}%;top:${100 - x / 70 * 100}%">
      <span class="slot-pos">${pos}</span><span class="slot-name">${esc(p.name.split(' ')[0])}</span><span class="slot-lv">Lv${p.level}</span></button>`;
  }).join('');
  const inLineup = new Set(G.lineup);
  render(`
  <header class="subbar"><button class="btn small" data-act="hub">← 戻る</button><h2>編成</h2><button class="btn small" data-act="autolineup">おまかせ</button></header>
  <div class="formations">${Object.keys(FORMATIONS).map(f => `<button class="btn small${f === G.formation ? ' primary' : ''}" data-act="formation" data-f="${f}">${f}</button>`).join('')}</div>
  <p class="note">${sel === null ? 'ポジションをタップして選手を入れ替えます。赤枠は本来と違うポジション（能力ダウン）。' : `<b>${slots[sel][0]}</b> の枠に入れる選手を下から選んでください。`}</p>
  <div class="mini-pitch">${pitch}</div>
  <h3>選手</h3>
  <div class="plist">${G.roster.map(p => playerRow(p, inLineup.has(p.id) ? '<span class="tag">先発</span>' : '<span class="tag dim">控え</span>').replace('data-act="player"', sel === null ? 'data-act="player"' : 'data-act="assign"')).join('')}</div>`);
}

function assignSlot(pid) {
  const i = ui.lineupSlot;
  if (i === null) return;
  const cur = G.lineup.indexOf(pid);
  if (cur >= 0) { G.lineup[cur] = G.lineup[i]; }
  G.lineup[i] = pid;
  ui.lineupSlot = null;
  save();
  renderLineup();
}

// ---------- 選手 ----------
function renderRoster() {
  render(`
  <header class="subbar"><button class="btn small" data-act="hub">← 戻る</button><h2>選手一覧</h2><span>${G.roster.length}/${MAX_ROSTER}人</span></header>
  <div class="plist">${G.roster.map(p => playerRow(p)).join('')}</div>`);
}

function playerDetailHtml(p, opts = {}) {
  const maxStat = 200;
  const statKeys = ['kick', 'control', 'speed', 'guard', 'body', 'catch'];
  const nl = nextLearn(p);
  return `<div class="pd-head"><span class="pos pos-${p.pos}">${p.pos}</span>${elemBadge(p.element)}<h2>${esc(p.name)}</h2>${p.tag ? `<span class="tag">${esc(p.tag)}</span>` : ''}</div>
  <div class="pd-sub">Lv${p.level}　総合${overall(p)}　才能${'★'.repeat(Math.max(1, Math.round((p.talent - 0.95) * 20)))}　出場${p.apps}　得点${p.goals}</div>
  ${opts.noExp ? '' : `<div class="expbar"><i style="width:${Math.round(p.exp / expToNext(p.level) * 100)}%"></i><span>EXP ${p.exp}/${expToNext(p.level)}</span></div>`}
  <div class="pd-stats">${statKeys.map(k => `<div class="st"><span>${STAT_LABELS[k]}</span><i><b style="width:${Math.min(100, p.stats[k] / maxStat * 100)}%"></b></i><em>${Math.floor(p.stats[k])}</em></div>`).join('')}
  <div class="st"><span>最大TP</span><i><b class="tpb" style="width:${Math.min(100, p.stats.tp / 250 * 100)}%"></b></i><em>${Math.floor(p.stats.tp)}</em></div>
  <div class="st"><span>コンディション</span><i><b class="${condClass(p.cond)}" style="width:${p.cond}%"></b></i><em>${Math.round(p.cond)}</em></div></div>
  <h3>必殺技 (${p.moves.length}/4)</h3>
  <div class="moves">${p.moves.length ? p.moves.map(s => moveChip(s, p) + `<small class="uses">熟練度 ${s.uses || 0}${moveRank(s.uses || 0).label ? '' : '（5で改）'}</small>`).join('') : '<p class="note">なし</p>'}</div>
  ${nl ? `<p class="note">次の習得：Lv${nl.lv}で「${esc(MOVES[nl.id].name)}」</p>` : ''}`;
}

function showPlayer(id) {
  const p = byId(id);
  if (!p) return;
  const canRelease = G.roster.length > 11 && !p.captain;
  modal(playerDetailHtml(p) + `<div class="modal-actions">
    ${canRelease ? `<button class="btn danger small" data-act="release" data-id="${p.id}">退部させる</button>` : ''}
    <button class="btn primary" data-act="close">閉じる</button></div>`, true);
}

function releasePlayer(id) {
  const p = byId(id);
  if (!p || !confirm(`${p.name}を退部させますか？（元に戻せません）`)) return;
  G.roster = G.roster.filter(q => q.id !== id);
  G.lineup = G.lineup.map(x => x === id ? null : x);
  validateLineup();
  addLog(`${p.name}が退部した`);
  save(); closeModal(); renderRoster();
}

// ---------- ショップ ----------
function maxBookTier() { return [2, 3, 5][G.stageIdx]; }

function renderShop() {
  const tab = ui.shopTab;
  const tabs = [['item', 'アイテム'], ['shoot', 'シュート'], ['dribble', 'ドリブル'], ['block', 'ブロック'], ['catch', 'キャッチ']];
  let body;
  if (tab === 'item') {
    body = SHOP_ITEMS.map(it => `<div class="shop-item"><div><b>${it.name}</b><small>${it.desc}</small></div>
      <button class="btn small primary" data-act="buyitem" data-id="${it.id}" ${G.money < it.price ? 'disabled' : ''}>${yen(it.price)}</button></div>`).join('');
  } else {
    const list = Object.values(MOVES).filter(m => m.type === tab && m.tier <= maxBookTier()).sort((a, b) => a.tier - b.tier || ELEMENT_KEYS.indexOf(a.element) - ELEMENT_KEYS.indexOf(b.element));
    body = `<p class="note">秘伝書を使うと選手が必殺技をすぐに習得します。${tab === 'catch' ? 'キャッチ技はGK専用。' : 'GKは覚えられません。'}大会が進むと強力な秘伝書が入荷します。</p>` +
      list.map(m => `<div class="shop-item"><div><b style="color:${ELEMENTS[m.element].color}">${elemBadge(m.element)} ${m.name}</b><small>威力${m.power}・TP${m.tp}・ランク${'★'.repeat(m.tier)}</small></div>
      <button class="btn small primary" data-act="buybook" data-id="${m.id}" ${G.money < BOOK_PRICES[m.tier] ? 'disabled' : ''}>${yen(BOOK_PRICES[m.tier])}</button></div>`).join('');
  }
  render(`
  <header class="subbar"><button class="btn small" data-act="hub">← 戻る</button><h2>ショップ</h2><span>${yen(G.money)}</span></header>
  <div class="tabs">${tabs.map(([k, l]) => `<button class="tab${k === tab ? ' sel' : ''}" data-act="shoptab" data-tab="${k}">${l}</button>`).join('')}</div>
  <div class="shop-list">${body}</div>`);
}

function buyItem(id) {
  const it = SHOP_ITEMS.find(i => i.id === id);
  if (G.money < it.price) return;
  G.money -= it.price;
  if (id === 'drink') {
    G.roster.forEach(p => { p.cond = Math.min(100, p.cond + 30); });
    toast('全員のコンディションが回復した！');
  } else if (id === 'protein') {
    const ups = [];
    G.roster.forEach(p => { const before = p.level; const r = gainExp(p, 120); if (r.levels) ups.push({ p, before, learned: r.learned }); });
    if (ups.length) modal(`<h2>特製プロテイン</h2>${levelUpHtml(ups)}<div class="modal-actions"><button class="btn primary" data-act="close">OK</button></div>`);
    else toast('全員が経験値を得た！');
  }
  save(); renderShop();
}

function buyBook(moveId) {
  const m = MOVES[moveId];
  const eligible = G.roster.filter(p => (m.type === 'catch') === (p.pos === 'GK'));
  modal(`<h2>「${esc(m.name)}」を誰に覚えさせる？</h2>
    <div class="plist">${eligible.map(p => {
      const has = p.moves.some(s => s.id === moveId);
      return `<div class="prow${has ? ' disabled' : ''}" ${has ? '' : `data-act="teach" data-id="${p.id}" data-move="${moveId}"`}>
        <span class="pos pos-${p.pos}">${p.pos}</span>${elemBadge(p.element)}<span class="pname">${esc(p.name)}</span>
        <span class="plv">Lv${p.level}</span><span class="tag ${p.element === m.element ? '' : 'dim'}">${has ? '習得済み' : p.element === m.element ? '同属性◎' : `技${p.moves.length}/4`}</span></div>`;
    }).join('')}</div>
    <div class="modal-actions"><button class="btn" data-act="close">やめる</button></div>`, true);
}

function teach(pid, moveId, forgetIdx) {
  const p = byId(pid), m = MOVES[moveId];
  if (G.money < BOOK_PRICES[m.tier]) return;
  if (p.moves.length >= 4 && forgetIdx === undefined) {
    modal(`<h2>${esc(p.name)}の技がいっぱいです</h2><p>忘れる技を選んでください。</p>
      <div class="moves">${p.moves.map((s, i) => `<button class="btn block" data-act="forget" data-id="${pid}" data-move="${moveId}" data-i="${i}">${moveChip(s, p)}</button>`).join('')}</div>
      <div class="modal-actions"><button class="btn" data-act="close">やめる</button></div>`, true);
    return;
  }
  G.money -= BOOK_PRICES[m.tier];
  const slot = { id: moveId, uses: 0 };
  if (forgetIdx !== undefined) p.moves[forgetIdx] = slot; else p.moves.push(slot);
  addLog(`${p.name}が「${m.name}」を習得`);
  save();
  modal(`<h2>習得！</h2><div class="learned big" style="--ec:${ELEMENTS[m.element].color}">${esc(p.name)}は「${esc(m.name)}」を覚えた！</div>
    <div class="modal-actions"><button class="btn primary" data-act="close-shop">OK</button></div>`);
}

// ---------- スカウト ----------
function renderScout() {
  const full = G.roster.length >= MAX_ROSTER;
  render(`
  <header class="subbar"><button class="btn small" data-act="hub">← 戻る</button><h2>スカウト</h2><span>${yen(G.money)}</span></header>
  <p class="note">部員 ${G.roster.length}/${MAX_ROSTER}人。${full ? '<span class="bad">部員が上限です。選手一覧から退部させると枠が空きます。</span>' : '候補は試合ごとに入れ替わります。'}</p>
  <div class="scout-list">${G.scoutPool.length ? G.scoutPool.map((p, i) => `
    <div class="card scout">
      ${p.tag ? `<div class="scout-tag">${esc(p.tag)}</div>` : ''}
      <div class="prow"><span class="pos pos-${p.pos}">${p.pos}</span>${elemBadge(p.element)}<span class="pname">${esc(p.name)}</span><span class="plv">Lv${p.level}</span><span class="povr">総合${overall(p)}</span></div>
      <div class="moves">${p.moves.map(s => moveChip(s, p)).join('')}</div>
      <div class="scout-foot"><button class="btn small" data-act="scoutview" data-i="${i}">詳細</button>
      <button class="btn small primary" data-act="recruit" data-i="${i}" ${full || G.money < p.price ? 'disabled' : ''}>${p.price ? yen(p.price) + 'で獲得' : '無料で加入'}</button></div>
    </div>`).join('') : '<p class="note">今は候補がいません。</p>'}</div>
  <button class="btn" data-act="scoutrefresh" ${G.money < 500 ? 'disabled' : ''}>候補を入れ替える（¥500）</button>`);
}

function recruit(i) {
  const p = G.scoutPool[i];
  if (!p || G.roster.length >= MAX_ROSTER || G.money < p.price) return;
  G.money -= p.price;
  delete p.price;
  G.scoutPool.splice(i, 1);
  G.roster.push(p);
  addLog(`${p.name}が入部した！`);
  save();
  toast(`${p.name}が仲間になった！`);
  renderScout();
}

// ---------- 大会情報 ----------
function groupTableHtml() {
  if (!G.group) return '';
  const rows = rankGroup();
  return `<table class="gtable"><tr><th>#</th><th>チーム</th><th>勝点</th><th>勝</th><th>分</th><th>敗</th><th>得失</th></tr>
    ${rows.map((t, i) => `<tr class="${t.id === 'us' ? 'us' : ''}${i < 2 ? ' adv' : ''}"><td>${i + 1}</td><td>${esc(t.name)}</td><td><b>${t.pts}</b></td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td><td>${t.gf - t.ga >= 0 ? '+' : ''}${t.gf - t.ga}</td></tr>`).join('')}</table>
    <p class="note">上位2チームが決勝トーナメントへ進出。</p>`;
}

function showInfo() {
  const st = stage();
  modal(`<h2>🏆 ${esc(st.name)}</h2>
    <ol class="bracket">${st.matches.map((m, i) => `<li class="${i < G.matchIdx ? 'done' : i === G.matchIdx ? 'cur' : ''}">
      <span>${esc(m.round)}</span><b>${esc(m.team.name)}</b><small>Lv${m.team.lv}・${ELEMENTS[m.team.element].jp}</small>${i < G.matchIdx ? '<em>✓</em>' : i === G.matchIdx ? '<em>NEXT</em>' : ''}</li>`).join('')}</ol>
    ${groupTableHtml()}
    <h3>大会の流れ</h3><p class="note">${STAGES.map((s, i) => i === G.stageIdx ? `<b>${esc(s.name)}</b>` : esc(s.name)).join(' → ')}</p>
    <div class="modal-actions"><button class="btn primary" data-act="close">閉じる</button></div>`, true);
}

function showMenu() {
  modal(`<h2>メニュー</h2>
    <div class="menu-btns">
      <button class="btn block" data-act="howto">遊び方</button>
      <button class="btn block" data-act="savenow">セーブする</button>
      <button class="btn block" data-act="title">タイトルへ戻る</button>
    </div>
    <p class="note">進行は自動でセーブされます（このブラウザ内に保存）。</p>
    <div class="modal-actions"><button class="btn primary" data-act="close">閉じる</button></div>`);
}

// ---------- 世界大会グループ ----------
function initGroup() {
  const ms = STAGES[2].matches.filter(m => m.group);
  G.group = {
    teams: [{ id: 'us', name: G.teamName, lv: 0 }, ...ms.map(m => ({ id: m.team.id, name: m.team.name, lv: m.team.lv }))]
      .map(t => ({ ...t, pts: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 })),
  };
}
function recordGroup(idA, idB, ga, gb) {
  const A = G.group.teams.find(t => t.id === idA), B = G.group.teams.find(t => t.id === idB);
  A.gf += ga; A.ga += gb; B.gf += gb; B.ga += ga;
  if (ga > gb) { A.w++; A.pts += 3; B.l++; } else if (ga < gb) { B.w++; B.pts += 3; A.l++; } else { A.d++; B.d++; A.pts++; B.pts++; }
}
function rankGroup() {
  return [...G.group.teams].sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || (a.id === 'us' ? -1 : 1));
}
function simOtherGroupMatch(k) {
  const others = GROUP_OTHERS_ORDER.filter((_, i) => i !== k);
  const [a, b] = others.map(id => G.group.teams.find(t => t.id === id));
  const goals = (x, y) => Math.max(0, Math.round(rnd(0, 2.4) + (x.lv - y.lv) * 0.08));
  recordGroup(a.id, b.id, goals(a, b), goals(b, a));
}

// ---------- 試合前 ----------
function renderPrematch() {
  validateLineup();
  const md = matchDef();
  const opp = buildOpponent(md.team);
  const lp = lineupPlayers();
  const tired = lp.filter(p => p.cond < 50);
  const ace = opp.players.filter(p => p.ace);
  render(`
  <header class="subbar"><button class="btn small" data-act="hub">← 戻る</button><h2>${esc(stage().name)}</h2><span>${esc(md.round)}</span></header>
  <section class="card prematch">
    <div class="pm-teams">
      <div class="pm-team" style="--tc:${G.color}"><b>${esc(G.teamName)}</b><small>平均Lv${avgLevel(lp)}・総合${Math.round(teamStrength(lp))}</small></div>
      <div class="pm-vs">VS</div>
      <div class="pm-team" style="--tc:${opp.color}"><b>${esc(opp.name)}</b><small>平均Lv${avgLevel(opp.players)}・総合${Math.round(teamStrength(opp.players))}</small></div>
    </div>
    <blockquote>「${esc(md.team.quote)}」</blockquote>
    ${ace.map(a => `<div class="ace">要注意：<b>${esc(a.name)}</b>（${a.pos}・${ELEMENTS[a.element].jp}・Lv${a.level}）<div class="moves">${a.moves.map(s => moveChip(s, a)).join('')}</div></div>`).join('')}
    <p class="note">相手フォーメーション：${opp.formation}　/　こちら：${G.formation}</p>
    ${tired.length ? `<p class="bad">⚠ 疲れている選手：${tired.map(p => esc(p.name)).join('、')}</p>` : ''}
    ${md.group ? groupTableHtml() : `<p class="note">トーナメント戦：引き分けの場合はPK戦</p>`}
  </section>
  <div class="pm-actions">
    <button class="btn" data-act="lineup">編成を変更</button>
    <button class="btn primary big" data-act="kickoff">キックオフ！</button>
  </div>`);
  ui.opp = opp;
}

function startMatch() {
  const md = matchDef();
  if (md.team.id === 'galaxy' && !ui.finalStoryShown) {
    ui.finalStoryShown = true;
    return renderStory('final', startMatch);
  }
  const opp = ui.opp && ui.opp.id === md.team.id ? ui.opp : buildOpponent(md.team);
  const lp = lineupPlayers();
  // ユニフォームの色が近いときは相手がアウェイカラーに
  const rgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const [c1, c2] = [rgb(G.color), rgb(opp.color)];
  const oppColor = Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]) < 120
    ? (c1[0] + c1[1] + c1[2] > 450 ? '#111827' : '#f1f5f9') : opp.color;
  render(`<div class="match">
    <div class="scoreboard">
      <div class="sb-team" style="--tc:${G.color}">${esc(G.teamName)}</div>
      <div class="sb-score"><span id="sc-home">0</span><i>-</i><span id="sc-away">0</span><small id="sc-time"></small></div>
      <div class="sb-team" style="--tc:${oppColor}">${esc(opp.name)}</div>
    </div>
    <div class="pitch-wrap">
      <canvas id="pitch" width="1000" height="640"></canvas>
      <div id="cutin" class="cutin"></div>
      <div id="bigtext" class="bigtext"></div>
      <div id="flash" class="flash"></div>
    </div>
    <div class="controls">
      <button class="btn" id="btn-pass">パス</button>
      <button class="btn primary" id="btn-shoot">シュート</button>
      <button class="btn small" id="btn-auto"></button>
      <button class="btn small" id="btn-speed"></button>
    </div>
    <div id="prompt" class="prompt"></div>
    <div class="match-bottom">
      <div><h4>TP（味方）</h4><div id="tplist" class="tplist"></div></div>
      <div><h4>実況</h4><ul id="mlog" class="mlog"></ul></div>
    </div>
    <p class="note">ピッチをタップ：ドリブル方向　／　パス→味方をタップ　／　敵と接触するとコマンドバトル</p>
  </div>`);
  const aggro = 0.4 + G.stageIdx * 0.12 + G.matchIdx * 0.02;
  currentMatch = new Match({
    home: { name: G.teamName, color: G.color, formation: G.formation, players: lp },
    away: { name: opp.name, color: oppColor, formation: opp.formation, players: opp.players },
    settings: G.settings, aggro, root: $app(),
    onEnd: res => onMatchEnd(res, opp, md),
  });
}

// ---------- 試合後 ----------
function onMatchEnd(res, opp, md) {
  if (currentMatch) { currentMatch.destroy(); currentMatch = null; }
  const st = stage();
  const lp = lineupPlayers();
  const [a, b] = res.score;
  let outcome = a > b ? 'win' : a < b ? 'loss' : 'draw';
  let pk = null;
  if (outcome === 'draw' && !md.group) {
    pk = simulatePK(lp, opp.players);
    outcome = pk.a > pk.b ? 'win' : 'loss';
  }
  G.record[{ win: 'w', draw: 'd', loss: 'l' }[outcome]]++;
  G.record.gf += a; G.record.ga += b;
  for (const g of res.goals) if (g.team === 0) { const p = byId(g.pid); if (p) p.goals++; }
  if (md.group) {
    recordGroup('us', md.team.id, a, b);
    simOtherGroupMatch(G.matchIdx);
  }
  const mult = { win: 1, draw: 0.6, loss: 0.4 }[outcome];
  const money = Math.round(st.reward * { win: 1, draw: 0.5, loss: 0.25 }[outcome]);
  G.money += money;
  const baseExp = (100 + md.team.lv * 6) * mult;
  const starters = new Set(G.lineup);
  const levelUps = [];
  for (const p of G.roster) {
    const isStarter = starters.has(p.id);
    const before = p.level;
    const r = gainExp(p, baseExp * (isStarter ? 1 : 0.5));
    if (r.levels) levelUps.push({ p, before, learned: r.learned });
    if (isStarter) { p.apps++; p.cond = Math.max(0, p.cond - 18); } else p.cond = Math.min(100, p.cond + 15);
  }
  addLog(`${md.round} vs ${md.team.name}　${a}-${b}${pk ? `（PK ${pk.a}-${pk.b}）` : ''} ${{ win: '勝利！', draw: '引き分け', loss: '敗北…' }[outcome]}`);
  G.lastResult = { a, b, pk, outcome, oppName: opp.name, oppColor: opp.color, goals: res.goals, stats: res.stats, money, exp: Math.round(baseExp) };
  G.pendingAdvance = outcome;
  save();
  renderResult(levelUps);
}

function renderResult(levelUps = []) {
  const r = G.lastResult;
  const title = { win: '勝利！', draw: '引き分け', loss: '敗北…' }[r.outcome];
  render(`
  <section class="card result ${r.outcome}">
    <div class="res-title">${title}</div>
    <div class="res-score"><span style="--tc:${G.color}">${esc(G.teamName)}</span><b>${r.a} - ${r.b}</b><span style="--tc:${r.oppColor}">${esc(r.oppName)}</span></div>
    ${r.pk ? `<div class="pk"><h3>PK戦 ${r.pk.a} - ${r.pk.b}</h3><ol>${r.pk.seq.map(k => `<li>${esc(k.ours)} ${k.g1 ? '⭕' : '❌'}　/　${esc(k.theirs)} ${k.g2 ? '⭕' : '❌'}</li>`).join('')}</ol></div>` : ''}
    <div class="res-goals">${r.goals.length ? r.goals.map(g => `<div class="${g.team === 0 ? 'ours' : 'theirs'}">${g.minute}' ${esc(g.name)}${g.move ? `「${esc(g.move)}」` : ''}</div>`).join('') : '<div class="note">得点なし</div>'}</div>
    <div class="note">シュート ${r.stats.shots[0]} - ${r.stats.shots[1]}　/　セーブ ${r.stats.saves[0]} - ${r.stats.saves[1]}</div>
    <div class="res-reward">獲得資金 <b>${yen(r.money)}</b>　経験値 <b>${r.exp}</b>（控えは半分）</div>
    ${levelUpHtml(levelUps)}
  </section>
  <div class="pm-actions"><button class="btn primary big" data-act="advance">次へ</button></div>`);
}

function advance() {
  const outcome = G.pendingAdvance;
  if (!outcome) return renderHub();
  G.pendingAdvance = null;
  const st = stage(), md = matchDef();
  let story = null;
  const nextCycle = days => { G.daysLeft = days; G.scoutPool = genScoutPool(); };
  if (md.group) {
    if (G.matchIdx < 2) { G.matchIdx++; nextCycle(st.days); }
    else {
      const rank = rankGroup().findIndex(t => t.id === 'us');
      if (rank < 2) { G.matchIdx = 3; nextCycle(st.days); story = 'groupClear'; }
      else { initGroup(); G.matchIdx = 0; G.retries++; nextCycle(3); story = 'groupFail'; }
    }
  } else if (outcome === 'win') {
    if (G.matchIdx < st.matches.length - 1) { G.matchIdx++; nextCycle(st.days); }
    else if (G.stageIdx === STAGES.length - 1) {
      G.cleared = true; save();
      return renderEnding();
    } else {
      story = G.stageIdx === 0 ? 'regionalClear' : 'nationalClear';
      G.stageIdx++; G.matchIdx = 0;
      nextCycle(stage().firstDays);
      if (G.stageIdx === 2) { initGroup(); G.scoutPool = [...rivalRecruits(), ...G.scoutPool]; }
      addLog(`${stage().name}へ進出！`);
    }
  } else {
    G.retries++; nextCycle(3); story = 'retry';
  }
  save();
  if (story) renderStory(story, renderHub); else renderHub();
}

function renderEnding() {
  const top = [...G.roster].sort((a, b) => b.goals - a.goals)[0];
  render(`<div class="ending">
    <div class="trophy">🏆</div>
    <h1>世界一！</h1>
    <p>${esc(G.teamName)}は、ギャラクシーカップを制覇した！<br>超次元サッカーの頂点に、新たな伝説が刻まれた――。</p>
    <div class="card">
      <h3>最終成績</h3>
      <div class="stats-grid">
        <div><small>通算</small><b>${G.record.w}勝${G.record.d}分${G.record.l}敗</b></div>
        <div><small>総得点 / 総失点</small><b>${G.record.gf} / ${G.record.ga}</b></div>
        <div><small>得点王</small><b>${esc(top.name)}（${top.goals}点）</b></div>
        <div><small>かかった日数</small><b>${G.day}日</b></div>
      </div>
      <p class="note">リトライ回数：${G.retries}</p>
    </div>
    <p class="thanks">THANK YOU FOR PLAYING!</p>
    <button class="btn primary big" data-act="title">タイトルへ</button>
  </div>`);
}

// ---------- イベント処理 ----------
const ACTIONS = {
  continue() { G = loadSave(); if (!G) return renderTitle(); G.settings = G.settings || { auto: false, speed: 1 }; G.cleared ? renderEnding() : (G.pendingAdvance ? renderResult() : renderHub()); },
  newgame() { if (hasSave() && !confirm('セーブデータを上書きして最初から始めますか？')) return; renderIntro(); },
  howto() { modal(howtoHtml(), true); },
  async install() {
    if (deferredInstall) {
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      renderTitle();
    } else {
      modal(`<h2>📲 ホーム画面に追加</h2>
        <ol><li>Safari の下にある <b>共有ボタン</b>（□に↑）をタップ</li>
        <li><b>「ホーム画面に追加」</b>を選ぶ</li><li>右上の<b>「追加」</b>をタップ</li></ol>
        <p class="note">ホーム画面のアイコンから、全画面のアプリとして遊べます。一度開けばオフラインでもプレイできます。</p>
        <div class="modal-actions"><button class="btn primary" data-act="close">OK</button></div>`);
    }
  },
  title() { closeModal(); if (currentMatch) { currentMatch.destroy(); currentMatch = null; } renderTitle(); },
  color(el) { document.querySelectorAll('.color').forEach(b => b.classList.remove('sel')); el.classList.add('sel'); },
  start() {
    const name = (document.getElementById('team-name').value || '').trim() || '流星中';
    const color = document.querySelector('.color.sel')?.dataset.color || TEAM_COLORS[0];
    newGame(name, color);
    renderStory('intro', renderHub);
  },
  'story-next'() { ui.storyNext && ui.storyNext(); },
  'story-skip'() { ui.storySkip && ui.storySkip(); },
  hub() { ui.lineupSlot = null; renderHub(); },
  training() { renderTraining(); },
  train(el) { doTraining(el.dataset.id); },
  rest() { doRest(); },
  skipdays() {
    if (!confirm(`残り${G.daysLeft}日を使わずに試合へ進みますか？`)) return;
    G.day += G.daysLeft; G.daysLeft = 0; save(); renderPrematch();
  },
  'close-hub'() { closeModal(); renderHub(); },
  close() { closeModal(); },
  'close-shop'() { closeModal(); renderShop(); },
  lineup() { ui.lineupSlot = null; renderLineup(); },
  slot(el) { const i = +el.dataset.i; ui.lineupSlot = ui.lineupSlot === i ? null : i; renderLineup(); },
  assign(el) { assignSlot(el.dataset.id); },
  formation(el) { G.formation = el.dataset.f; validateLineup(); save(); renderLineup(); },
  autolineup() { G.lineup = autoLineup(); ui.lineupSlot = null; save(); renderLineup(); toast('おまかせ編成にしました'); },
  roster() { renderRoster(); },
  player(el) { showPlayer(el.dataset.id); },
  release(el) { releasePlayer(el.dataset.id); },
  shop() { renderShop(); },
  shoptab(el) { ui.shopTab = el.dataset.tab; renderShop(); },
  buyitem(el) { buyItem(el.dataset.id); },
  buybook(el) { buyBook(el.dataset.id); },
  teach(el) { teach(el.dataset.id, el.dataset.move); },
  forget(el) { teach(el.dataset.id, el.dataset.move, +el.dataset.i); },
  scout() { renderScout(); },
  recruit(el) { recruit(+el.dataset.i); },
  scoutview(el) { const p = G.scoutPool[+el.dataset.i]; modal(playerDetailHtml(p, { noExp: true }) + `<div class="modal-actions"><button class="btn primary" data-act="close">閉じる</button></div>`, true); },
  scoutrefresh() { if (G.money < 500) return; G.money -= 500; const keep = G.scoutPool.filter(p => p.price === 0); G.scoutPool = [...keep, ...genScoutPool()]; save(); renderScout(); },
  info() { showInfo(); },
  menu() { showMenu(); },
  savenow() { save(); toast('セーブしました'); },
  prematch() { renderPrematch(); },
  kickoff() { startMatch(); },
  advance() { advance(); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el); }
});
document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

renderTitle();
