'use strict';
// ===== 汎用ユーティリティ =====
const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yen = n => '¥' + Math.floor(n).toLocaleString();

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ===== 必殺技ヘルパー =====
function moveRank(uses) {
  let r = MOVE_RANKS[0];
  for (const rank of MOVE_RANKS) if (uses >= rank.min) r = rank;
  return r;
}
function moveLabel(slot) {
  const m = MOVES[slot.id];
  const r = moveRank(slot.uses || 0);
  return m.name + (r.label ? ' ' + r.label : '');
}
function elemAdvantage(attEl, defEl) {
  if (!attEl || !defEl) return 1;
  if (ELEMENTS[attEl].beats === defEl) return 1.15;
  if (ELEMENTS[defEl].beats === attEl) return 0.92;
  return 1;
}
// 技の実効威力
function movePower(player, slot, opponent) {
  if (!slot) return 0;
  const m = MOVES[slot.id];
  let p = m.power * moveRank(slot.uses || 0).mult;
  if (m.element === player.element) p *= 1.1;
  if (opponent) p *= elemAdvantage(m.element, opponent.element);
  return p;
}
function elemBadge(el) {
  const e = ELEMENTS[el];
  return `<span class="elem" style="--ec:${e.color}">${e.jp}</span>`;
}

// ===== 選手 =====
function learnsetFor(p) {
  const list = LEARNSETS[p.pos].map(([lv, type, tier]) => [lv, `${type}_${p.element}_${tier}`]);
  if (p.learnExtra) list.push(...p.learnExtra);
  return list.sort((a, b) => a[0] - b[0]);
}

// 技を覚える。同じ種類の弱い技があれば上書き、空きがあれば追加
function learnMove(p, moveId) {
  if (p.moves.some(s => s.id === moveId)) return null;
  const m = MOVES[moveId];
  const sameIdx = p.moves.findIndex(s => MOVES[s.id].type === m.type && MOVES[s.id].power < m.power);
  if (sameIdx >= 0) {
    const old = p.moves[sameIdx].id;
    p.moves[sameIdx] = { id: moveId, uses: 0 };
    return { id: moveId, replaced: old };
  }
  if (p.moves.length < 4) {
    p.moves.push({ id: moveId, uses: 0 });
    return { id: moveId, replaced: null };
  }
  return null;
}

function expToNext(level) { return 10 + 6 * level; }

function levelUp(p, r = Math.random) {
  p.level++;
  const g = POS_GROWTH[p.pos];
  for (const k in g) p.stats[k] += g[k] * p.talent * (0.8 + r() * 0.4);
  p.stats.tp += 1.2 * p.talent;
  const learned = [];
  for (const [lv, id] of learnsetFor(p)) {
    if (lv === p.level) {
      const res = learnMove(p, id);
      if (res) learned.push(res);
    }
  }
  return learned;
}

let _pid = 1;
function newId() { return 'p' + Date.now().toString(36) + (_pid++).toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

function createPlayer(o, r = Math.random) {
  const p = {
    id: o.id || newId(), name: o.name, pos: o.pos, element: o.element,
    level: 1, exp: 0, talent: o.talent || 1,
    stats: { ...POS_BASE[o.pos], tp: 60 + (o.pos === 'GK' ? 15 : 0) },
    moves: [], cond: 100, goals: 0, apps: 0,
    learnExtra: o.learnExtra || null, captain: !!o.captain,
  };
  for (const [lv, id] of learnsetFor(p)) if (lv <= 1) learnMove(p, id);
  const target = o.level || 1;
  while (p.level < target) levelUp(p, r);
  return p;
}

function gainExp(p, amount) {
  const res = { levels: 0, learned: [] };
  p.exp += Math.round(amount);
  while (p.exp >= expToNext(p.level) && p.level < 99) {
    p.exp -= expToNext(p.level);
    res.learned.push(...levelUp(p));
    res.levels++;
  }
  return res;
}

function overall(p) {
  const s = p.stats;
  let v;
  switch (p.pos) {
    case 'GK': v = s.catch * 0.6 + s.body * 0.2 + s.guard * 0.2; break;
    case 'DF': v = s.guard * 0.45 + s.body * 0.3 + s.speed * 0.15 + s.control * 0.1; break;
    case 'MF': v = s.control * 0.4 + s.kick * 0.2 + s.speed * 0.2 + s.guard * 0.2; break;
    default:   v = s.kick * 0.5 + s.control * 0.25 + s.speed * 0.25;
  }
  return Math.round(v);
}

function nextLearn(p) {
  for (const [lv, id] of learnsetFor(p)) {
    if (lv > p.level && !p.moves.some(s => s.id === id)) return { lv, id };
  }
  return null;
}

function genJpName(r) { return pick(JP_SURNAMES, r) + ' ' + pick(JP_GIVEN, r); }
function genForeignName(r) { return pick(FOREIGN_FIRST, r) + '・' + pick(FOREIGN_LAST, r); }

// ===== 対戦相手チーム =====
function buildOpponent(def) {
  const r = mulberry32(hashStr(def.id));
  const slots = FORMATIONS[def.formation];
  const used = new Set();
  const players = slots.map(([pos], i) => {
    let name;
    do { name = def.foreign ? genForeignName(r) : genJpName(r); } while (used.has(name));
    used.add(name);
    const element = r() < 0.7 ? def.element : pick(ELEMENT_KEYS, r);
    const level = Math.max(1, def.lv + Math.floor(r() * 4) - 2);
    return createPlayer({ id: def.id + '_' + i, name, pos, element, level, talent: def.talent || 1 }, r);
  });
  for (const ace of [def.ace, def.ace2]) {
    if (!ace) continue;
    const idx = slots.findIndex(([pos], i) => pos === ace.pos && !players[i].ace);
    if (idx < 0) continue;
    players[idx] = createPlayer({ id: def.id + '_ace' + idx, name: ace.name, pos: ace.pos, element: ace.element,
      level: def.lv + ace.lvBonus, talent: (def.talent || 1) * 1.12, learnExtra: ace.learnExtra }, r);
    players[idx].ace = true;
  }
  return { id: def.id, name: def.name, color: def.color, formation: def.formation, players, element: def.element };
}

function teamStrength(players) {
  return players.reduce((a, p) => a + overall(p), 0) / players.length;
}
