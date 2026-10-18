'use strict';
// ===== 試合エンジン =====
// フィールド座標: x=0（自陣ゴール）〜100（敵陣ゴール）, y=0〜64
// チーム0 = プレイヤー（右へ攻める）, チーム1 = 相手（左へ攻める）
const FIELD_W = 100, FIELD_H = 64;
const GOAL_Y1 = 28.3, GOAL_Y2 = 35.7;
const HALF_SECONDS = 110;

function textColorFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#111' : '#fff';
}

class Match {
  constructor({ home, away, settings, aggro, onEnd, root }) {
    this.settings = settings;
    this.aggro = aggro;
    this.onEnd = onEnd;
    this.root = root;
    this.canvas = root.querySelector('#pitch');
    this.ctx = this.canvas.getContext('2d');
    this.teamInfo = [home, away];
    this.teams = [this.makeTeam(home, 0), this.makeTeam(away, 1)];
    this.players = [...this.teams[0], ...this.teams[1]];
    this.ball = { x: 50, y: 32, vx: 0, vy: 0, owner: null, pass: null, noPick: 0, h: 0 };
    this.score = [0, 0];
    this.goals = [];
    this.stats = { shots: [0, 0], saves: [0, 0] };
    this.half = 1; this.clock = 0; this.time = 0;
    this.busy = false; this.running = true; this.stopped = false;
    this.passMode = false; this.userTarget = null; this.shotPrompted = false;
    this.duelCd = 2; this.freeze = 0; this.tween = null; this.hudT = 0;
    this.bindInput();
    this.kickoff(0);
    this.updateHud(true);
    this.log(`キックオフ！ ${home.name} vs ${away.name}`);
    this.last = performance.now();
    this.raf = requestAnimationFrame(t => this.loop(t));
  }

  makeTeam(info, team) {
    const slots = FORMATIONS[info.formation];
    return info.players.map((p, idx) => {
      const [pos, hx, hy] = slots[idx];
      const home = team === 0 ? { x: hx, y: hy } : { x: FIELD_W - hx, y: FIELD_H - hy };
      const cf = 0.85 + (p.cond ?? 100) * 0.0015;
      let mis = 1, catchMul = pos === 'GK' ? 1 : 0;
      if (pos !== p.pos) {
        if (pos === 'GK') { catchMul = 0.5; mis = 0.9; }
        else if (p.pos === 'GK') mis = 0.7;
        else mis = 0.92;
      }
      const s = p.stats;
      const st = {
        kick: s.kick * cf * mis, guard: s.guard * cf * mis, body: s.body * cf * mis,
        control: s.control * cf * mis, speed: s.speed * cf * mis, catch: s.catch * cf * catchMul,
      };
      return { p, team, idx, pos, home, x: home.x, y: home.y, tx: home.x, ty: home.y, st,
        tp: s.tp, maxTp: s.tp, stun: 0, cd: 0, think: Math.random() * 0.4, holdT: 0 };
    });
  }

  destroy() {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.resolvePrompt && this.resolvePrompt({ kind: 'normal' });
  }

  // ---------- メインループ ----------
  loop(ts) {
    if (this.stopped) return;
    const realDt = Math.min(0.05, (ts - this.last) / 1000);
    this.last = ts;
    const dt = realDt * this.settings.speed;
    this.time += dt;
    if (this.tween) this.stepTween(dt);
    if (this.running && !this.busy && !this.passMode) this.update(dt);
    this.render();
    this.hudT -= realDt;
    if (this.hudT <= 0) { this.hudT = 0.2; this.updateHud(); }
    this.raf = requestAnimationFrame(t => this.loop(t));
  }

  run(fn) {
    this.busy = true;
    this.userTarget = null;
    Promise.resolve().then(fn).catch(e => console.error(e)).finally(() => {
      this.busy = false;
      this.hidePrompt();
    });
  }

  wait(ms) { return new Promise(r => setTimeout(r, ms / this.settings.speed)); }

  minute() {
    return Math.min(45, Math.floor(this.clock / HALF_SECONDS * 45) + 1) + (this.half === 2 ? 45 : 0);
  }

  update(dt) {
    this.clock += dt;
    if (this.clock >= HALF_SECONDS) { this.endHalf(); return; }
    if (this.freeze > 0) { this.freeze -= dt; return; }
    this.duelCd -= dt;
    for (const p of this.players) {
      p.stun -= dt; p.cd -= dt;
      p.tp = Math.min(p.maxTp, p.tp + dt * 0.22);
    }
    this.computeTargets();
    const c = this.ball.owner;
    if (c) this.carrierLogic(c, dt);
    if (this.busy) return;
    this.movePlayers(dt);
    this.updateBall(dt);
    const c2 = this.ball.owner;
    if (c2 && c2.pos !== 'GK' && this.duelCd <= 0 && c2.cd <= 0) {
      for (const o of this.teams[1 - c2.team]) {
        if (o.stun > 0 || o.cd > 0) continue;
        if (Math.hypot(o.x - c2.x, o.y - c2.y) < 2.0) {
          this.run(() => this.duel(c2, o));
          break;
        }
      }
    }
  }

  computeTargets() {
    const ball = this.ball, owner = ball.owner;
    const poss = owner ? owner.team : (ball.pass ? ball.pass.from.team : -1);
    for (let t = 0; t < 2; t++) {
      const dir = t === 0 ? 1 : -1;
      const mates = this.teams[t];
      const ownGoalX = t === 0 ? 0 : FIELD_W;
      const field = mates.filter(p => p.pos !== 'GK' && p !== owner);
      const byDist = (x, y) => [...field].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
      let presser = null, cover = null, chaser = null;
      if (owner && owner.team !== t) {
        const s = byDist(owner.x, owner.y);
        presser = s[0]; cover = s[1];
      } else if (!owner) {
        if (ball.pass && ball.pass.from.team === t) chaser = ball.pass.to;
        else chaser = byDist(ball.x, ball.y)[0];
      }
      for (const p of mates) {
        if (p === owner) continue;
        let x, y;
        if (p === presser) {
          x = owner.x - dir * 0.8; y = owner.y;
        } else if (p === cover) {
          x = owner.x + (ownGoalX - owner.x) * 0.3; y = owner.y + (32 - owner.y) * 0.3;
        } else if (p === chaser) {
          x = ball.x + ball.vx * 0.25; y = ball.y + ball.vy * 0.25;
        } else if (p.pos === 'GK') {
          const dBall = Math.abs(ball.x - ownGoalX);
          x = ownGoalX + dir * clamp(2 + (100 - dBall) * 0.03, 2, 6);
          y = clamp(32 + (ball.y - 32) * 0.22, 28, 36);
          // 自陣深くのこぼれ球はGKが飛び出す
          if (!owner && dBall < 12 && Math.abs(ball.y - 32) < 14) { x = ball.x; y = ball.y; }
        } else {
          x = p.home.x + (ball.x - 50) * 0.45;
          if (poss === t) x += 10 * dir; else if (poss !== -1) x -= 5 * dir;
          y = p.home.y + (ball.y - 32) * 0.25;
          x += Math.sin(this.time * 0.7 + p.idx * 1.7) * 1.5;
          y += Math.cos(this.time * 0.6 + p.idx) * 1.5;
        }
        p.tx = clamp(x, 1, FIELD_W - 1);
        p.ty = clamp(y, 1, FIELD_H - 1);
      }
    }
  }

  movePlayers(dt) {
    for (const p of this.players) {
      if (p.stun > 0) continue;
      const spd = (6.5 + p.st.speed * 0.035) * (p === this.ball.owner ? 0.85 : 1);
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.2) {
        const step = Math.min(d, spd * dt);
        p.x += dx / d * step; p.y += dy / d * step;
      }
      p.x = clamp(p.x, 0.5, FIELD_W - 0.5);
      p.y = clamp(p.y, 0.5, FIELD_H - 0.5);
    }
  }

  updateBall(dt) {
    const b = this.ball;
    if (b.owner) {
      const dir = b.owner.team === 0 ? 1 : -1;
      b.x = b.owner.x + dir * 0.9; b.y = b.owner.y + 0.3;
      b.vx = b.vy = 0;
      return;
    }
    if (this.tween) return;
    b.x += b.vx * dt; b.y += b.vy * dt;
    const f = Math.pow(0.4, dt);
    b.vx *= f; b.vy *= f;
    if (b.y < 0.5) { b.y = 0.5; b.vy = Math.abs(b.vy) * 0.5; }
    if (b.y > FIELD_H - 0.5) { b.y = FIELD_H - 0.5; b.vy = -Math.abs(b.vy) * 0.5; }
    if (b.x < 0.5) { b.x = 0.5; b.vx = Math.abs(b.vx) * 0.5; }
    if (b.x > FIELD_W - 0.5) { b.x = FIELD_W - 0.5; b.vx = -Math.abs(b.vx) * 0.5; }
    const speed = Math.hypot(b.vx, b.vy);
    if (b.pass && speed < 4) b.pass = null;
    b.noPick -= dt;
    if (b.noPick > 0) return;
    let best = null, bd = 1.7;
    for (const p of this.players) {
      if (p.stun > 0) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d >= bd) continue;
      if (b.pass && speed > 10 && p.team !== b.pass.from.team) {
        if (b.pass.checked.has(p)) continue;
        b.pass.checked.add(p);
        const ch = clamp(0.3 + (p.st.guard - b.pass.from.st.control) / 250, 0.12, 0.55);
        if (Math.random() > ch) continue;
      }
      best = p; bd = d;
    }
    if (best) {
      if (b.pass && best.team !== b.pass.from.team) this.log(`${best.p.name}がパスカット！`);
      this.setOwner(best);
    }
  }

  setOwner(p) {
    const prev = this.ball.owner;
    const prevTeam = prev ? prev.team : (this.ball.pass ? this.ball.pass.from.team : -1);
    this.ball.owner = p;
    this.ball.pass = null;
    this.ball.vx = this.ball.vy = 0;
    p.holdT = 0;
    p.think = 0.3 + Math.random() * 0.2;
    if (prevTeam !== p.team) { this.shotPrompted = false; this.userTarget = null; }
    if (this.passMode && p.team !== 0) this.setPassMode(false);
  }

  // ---------- ボール保持者 ----------
  carrierLogic(c, dt) {
    c.holdT += dt;
    const dir = c.team === 0 ? 1 : -1;
    if (c.pos === 'GK') {
      c.tx = c.x; c.ty = c.y;
      if (c.holdT > 1.0) {
        const t = this.bestPassTarget(c, true);
        if (t) this.pass(c, t);
      }
      return;
    }
    const manual = c.team === 0 && !this.settings.auto;
    if (manual && this.userTarget) {
      c.tx = this.userTarget.x; c.ty = this.userTarget.y;
      if (Math.hypot(c.tx - c.x, c.ty - c.y) < 1) this.userTarget = null;
    } else {
      const t = this.dribbleTarget(c);
      c.tx = t.x; c.ty = t.y;
    }
    const gx = c.team === 0 ? FIELD_W : 0;
    const dGoal = Math.hypot(gx - c.x, 32 - c.y);
    if (manual) {
      if (!this.shotPrompted && dGoal < 27) {
        this.shotPrompted = true;
        this.run(() => this.userShoot(c, true));
      }
      return;
    }
    c.think -= dt;
    if (c.think > 0) return;
    c.think = 0.35 + Math.random() * 0.25;
    if (dGoal < 15 || (dGoal < 26 && Math.random() < 0.3)) {
      this.run(() => this.shootSeq(c, this.aiChoose(c, 'shoot', 0.25)));
      return;
    }
    const press = Math.min(...this.teams[1 - c.team].map(o => Math.hypot(o.x - c.x, o.y - c.y)));
    if ((press < 6 && Math.random() < 0.3) || Math.random() < 0.05) {
      const t = this.bestPassTarget(c);
      if (t && dir * (t.x - c.x) > -8) this.pass(c, t);
    }
  }

  dribbleTarget(c) {
    const dir = c.team === 0 ? 1 : -1;
    const gx = c.team === 0 ? FIELD_W - 6 : 6;
    let ty = 32 + (c.y - 32) * 0.5;
    let near = null, nd = 8;
    for (const o of this.teams[1 - c.team]) {
      const ahead = dir * (o.x - c.x);
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      if (ahead > -1 && d < nd) { near = o; nd = d; }
    }
    if (near) ty = c.y + (c.y >= near.y ? 9 : -9);
    return { x: clamp(c.x + dir * 10, 2, FIELD_W - 2) * 0.5 + gx * 0.5, y: clamp(ty, 3, FIELD_H - 3) };
  }

  bestPassTarget(c, anyDirection) {
    const dir = c.team === 0 ? 1 : -1;
    let best = null, bs = -Infinity;
    for (const m of this.teams[c.team]) {
      if (m === c || m.pos === 'GK' || m.stun > 0) continue;
      const d = Math.hypot(m.x - c.x, m.y - c.y);
      if (d < 5) continue;
      const open = Math.min(10, ...this.teams[1 - c.team].map(o => Math.hypot(o.x - m.x, o.y - m.y)));
      if (open < 3) continue;
      let s = dir * (m.x - c.x) * (anyDirection ? 0.3 : 0.6) + open * 1.5 - Math.max(0, d - 35);
      s += Math.random() * 3;
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  }

  pass(from, to) {
    const b = this.ball;
    const tx = to.x + (to.tx - to.x) * 0.15, ty = to.y + (to.ty - to.y) * 0.15;
    const d = Math.hypot(tx - b.x, ty - b.y) || 1;
    const v = Math.max(12, d * 0.916 + 7);
    b.owner = null;
    b.vx = (tx - b.x) / d * v; b.vy = (ty - b.y) / d * v;
    b.pass = { from, to, checked: new Set() };
    b.noPick = 0.15;
    from.cd = 0.5;
  }

  // ---------- コマンド選択 ----------
  aiChoose(mp, type, bias = 0) {
    const slots = mp.p.moves.filter(s => MOVES[s.id].type === type && MOVES[s.id].tp <= mp.tp);
    if (!slots.length) return { kind: 'normal' };
    const prob = (mp.team === 1 ? this.aggro : 0.7) + bias;
    if (Math.random() < prob) {
      slots.sort((a, b) => MOVES[b.id].power - MOVES[a.id].power);
      return { kind: 'move', slot: slots[0] };
    }
    return { kind: 'normal' };
  }

  choose(mp, type, title, extras = [], info = '') {
    if (mp.team === 1 || this.settings.auto) {
      const ai = this.aiChoose(mp, type, type === 'catch' ? 0.25 : 0);
      return Promise.resolve(ai);
    }
    const opts = [];
    opts.push({ choice: { kind: 'normal' }, html: `<b>通常${MOVE_TYPES[type].jp}</b><small>TP 0</small>` });
    for (const slot of mp.p.moves) {
      const m = MOVES[slot.id];
      if (m.type !== type) continue;
      const pw = Math.round(movePower(mp.p, slot));
      opts.push({
        choice: { kind: 'move', slot }, disabled: m.tp > mp.tp, color: ELEMENTS[m.element].color,
        html: `<b>${elemBadge(m.element)} ${esc(moveLabel(slot))}</b><small>威力 ${pw} / TP ${m.tp}</small>`,
      });
    }
    for (const e of extras) opts.push({ choice: { kind: e.kind }, html: `<b>${esc(e.label)}</b><small>&nbsp;</small>`, extra: true });
    return this.showPrompt(title, `${esc(mp.p.name)}　TP ${Math.floor(mp.tp)}/${Math.floor(mp.maxTp)}${info ? '　' + info : ''}`, opts);
  }

  showPrompt(title, sub, opts) {
    const el = this.root.querySelector('#prompt');
    el.innerHTML = `<div class="prompt-title">${esc(title)}</div><div class="prompt-sub">${sub}</div><div class="prompt-opts"></div>`;
    const box = el.querySelector('.prompt-opts');
    return new Promise(resolve => {
      this.resolvePrompt = resolve;
      opts.forEach(o => {
        const btn = document.createElement('button');
        btn.className = 'opt' + (o.extra ? ' extra' : '');
        if (o.color) btn.style.setProperty('--ec', o.color);
        btn.innerHTML = o.html;
        btn.disabled = !!o.disabled;
        btn.onclick = () => { this.resolvePrompt = null; this.hidePrompt(); resolve(o.choice); };
        box.appendChild(btn);
      });
      el.classList.add('show');
    });
  }

  hidePrompt() {
    const el = this.root.querySelector('#prompt');
    if (el) el.classList.remove('show');
  }

  useMove(mp, choice) {
    if (!choice || choice.kind !== 'move') return null;
    const m = MOVES[choice.slot.id];
    if (m.tp > mp.tp) return null;
    mp.tp -= m.tp;
    choice.slot.uses = (choice.slot.uses || 0) + 1;
    return choice.slot;
  }

  cutin(mp, slot) {
    const m = MOVES[slot.id];
    const el = this.root.querySelector('#cutin');
    const color = ELEMENTS[m.element].color;
    el.style.setProperty('--ec', color);
    el.style.setProperty('--tc', this.teamInfo[mp.team].color);
    el.innerHTML = `<div class="cutin-band"><div class="cutin-who">${esc(mp.p.name)}</div><div class="cutin-move">${esc(moveLabel(slot))}</div><div class="cutin-type">${ELEMENTS[m.element].jp}属性 ${MOVE_TYPES[m.type].jp}</div></div>`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    this.log(`${mp.p.name}「${moveLabel(slot)}」！`, color);
    return this.wait(1150).then(() => el.classList.remove('show'));
  }

  bigText(text, color = '#ffd400', ms = 1300) {
    const el = this.root.querySelector('#bigtext');
    el.style.setProperty('--ec', color);
    el.textContent = text;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    return this.wait(ms).then(() => el.classList.remove('show'));
  }

  flash(text, color) {
    const el = this.root.querySelector('#flash');
    el.style.color = color || '#fff';
    el.textContent = text;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  animateBall(tx, ty, dur) {
    return new Promise(res => {
      this.ball.owner = null;
      this.tween = { fx: this.ball.x, fy: this.ball.y, tx, ty, t: 0, dur, res };
    });
  }
  stepTween(dt) {
    const tw = this.tween;
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    this.ball.x = tw.fx + (tw.tx - tw.fx) * k;
    this.ball.y = tw.fy + (tw.ty - tw.fy) * k;
    this.ball.h = Math.sin(k * Math.PI) * 1.2;
    if (k >= 1) { this.tween = null; this.ball.h = 0; tw.res(); }
  }

  // ---------- ドリブル勝負 ----------
  async duel(att, def) {
    const userAtt = att.team === 0;
    const title = userAtt ? `${att.p.name} vs ${def.p.name}　突破せよ！` : `${def.p.name} vs ${att.p.name}　ボールを奪え！`;
    let ac = userAtt
      ? await this.choose(att, 'dribble', title, [{ kind: 'pass', label: 'パスを出す' }])
      : this.aiChoose(att, 'dribble');
    if (this.stopped) return;
    if (ac.kind === 'pass') {
      const t = this.bestPassTarget(att, true);
      if (t) { this.pass(att, t); this.duelCd = 1.0; return; }
      ac = { kind: 'normal' };
    }
    const dc = userAtt ? this.aiChoose(def, 'block') : await this.choose(def, 'block', title);
    if (this.stopped) return;
    const am = this.useMove(att, ac), dm = this.useMove(def, dc);
    if (am) await this.cutin(att, am);
    if (dm) await this.cutin(def, dm);
    const a = att.st, d = def.st;
    const av = a.control * 0.5 + a.speed * 0.3 + a.body * 0.2 + movePower(att.p, am, def.p) + rnd(0, 22);
    const dv = d.guard * 0.5 + d.body * 0.3 + d.speed * 0.2 + movePower(def.p, dm, att.p) + rnd(0, 22);
    if (av >= dv) {
      def.stun = 1.3; att.cd = 1.0;
      const dir = att.team === 0 ? 1 : -1;
      att.x = clamp(att.x + dir * 2.5, 1, FIELD_W - 1);
      this.flash('突破！', this.teamInfo[att.team].color);
      this.log(`${att.p.name}が${def.p.name}をかわした！`);
    } else {
      att.stun = 1.1; def.cd = 0.8;
      this.setOwner(def);
      this.flash('奪取！', this.teamInfo[def.team].color);
      this.log(`${def.p.name}がボールを奪った！`);
    }
    this.duelCd = 2.6;
    await this.wait(300);
  }

  // ---------- シュート ----------
  async userShoot(c, chance) {
    const gx = FIELD_W;
    const dGoal = Math.hypot(gx - c.x, 32 - c.y);
    const ch = await this.choose(c, 'shoot', chance ? `シュートチャンス！` : 'シュート！',
      [{ kind: 'cancel', label: chance ? 'まだ撃たない' : 'やめる' }], `ゴールまで ${Math.round(dGoal)}m`);
    if (this.stopped || ch.kind === 'cancel') return;
    await this.shootSeq(c, ch);
  }

  findBlocker(shooter, gx, gy, defTeam) {
    let best = null, bd = 5;
    const sx = shooter.x, sy = shooter.y, vx = gx - sx, vy = gy - sy;
    const len2 = vx * vx + vy * vy;
    for (const p of this.teams[defTeam]) {
      if (p.pos === 'GK' || p.stun > 0) continue;
      const t = ((p.x - sx) * vx + (p.y - sy) * vy) / len2;
      if (t < 0.08 || t > 0.95) continue;
      const d = Math.hypot(sx + vx * t - p.x, sy + vy * t - p.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  async shootSeq(shooter, choice) {
    const atk = shooter.team, defT = 1 - atk;
    const dir = atk === 0 ? 1 : -1;
    const gx = atk === 0 ? FIELD_W : 0;
    const gy = 32 + rnd(-2.5, 2.5);
    const gk = this.teams[defT][0];
    const sm = this.useMove(shooter, choice);
    this.stats.shots[atk]++;
    this.ball.owner = null; this.ball.pass = null;
    if (sm) await this.cutin(shooter, sm);
    else { this.flash('シュート！', this.teamInfo[atk].color); this.log(`${shooter.p.name}のシュート！`); }
    if (this.stopped) return;
    const d = Math.hypot(gx - shooter.x, gy - shooter.y);
    const distF = d <= 18 ? 1 : Math.max(0.45, 1 - (d - 18) / 45);
    let shot = (shooter.st.kick + movePower(shooter.p, sm, gk.p)) * distF + rnd(0, 15);
    shooter.cd = 0.8;

    const blocker = this.findBlocker(shooter, gx, gy, defT);
    if (blocker && Math.random() < 0.55) {
      const bc = await this.choose(blocker, 'block', `シュートブロック！`,
        blocker.team === 0 ? [{ kind: 'cancel', label: 'ブロックしない' }] : [], `シュート威力 ${Math.round(shot)}`);
      if (this.stopped) return;
      if (bc.kind !== 'cancel') {
        const bm = this.useMove(blocker, bc);
        await this.animateBall(blocker.x, blocker.y, 0.25);
        if (bm) await this.cutin(blocker, bm);
        const bv = (blocker.st.guard * 0.5 + blocker.st.body * 0.5) * 0.6 + movePower(blocker.p, bm, shooter.p) + rnd(0, 12);
        if (bv >= shot) {
          this.flash('ブロック！', this.teamInfo[defT].color);
          this.log(`${blocker.p.name}がシュートをブロック！`);
          this.setOwner(blocker);
          blocker.cd = 0.8;
          this.duelCd = 1.5;
          await this.wait(400);
          return;
        }
        shot -= bv * 0.35;
        this.flash('威力ダウン！', '#ccc');
        this.log(`${blocker.p.name}が威力を削いだ！`);
      }
    }

    const gc = await this.choose(gk, 'catch', `キーパー！止めろ！`, [], `シュート威力 ${Math.round(shot)}`);
    if (this.stopped) return;
    const gm = this.useMove(gk, gc);
    await this.animateBall(gx - dir * 4, gy, 0.3);
    if (gm) await this.cutin(gk, gm);
    const cv = gk.st.catch * 1.1 + 8 + movePower(gk.p, gm, shooter.p) + rnd(0, 15);
    if (shot > cv) {
      await this.animateBall(gx + dir * 1.5, gy, 0.15);
      await this.goal(shooter, sm);
      return;
    }
    this.stats.saves[defT]++;
    const margin = cv - shot;
    if (margin < 8 && Math.random() < 0.6) {
      this.ball.x = gk.x + (-dir) * 2; this.ball.y = gk.y;
      this.ball.vx = -dir * rnd(12, 20); this.ball.vy = rnd(-14, 14);
      this.ball.noPick = 0.3;
      this.flash('パンチング！', this.teamInfo[defT].color);
      this.log(`${gk.p.name}がパンチングで弾いた！`);
    } else {
      this.setOwner(gk);
      this.flash('キャッチ！', this.teamInfo[defT].color);
      this.log(`${gk.p.name}ががっちりキャッチ！`);
    }
    this.duelCd = 1.5;
    await this.wait(400);
  }

  async goal(shooter, move) {
    const t = shooter.team;
    this.score[t]++;
    this.goals.push({ team: t, minute: this.minute(), name: shooter.p.name, pid: shooter.p.id, move: move ? moveLabel(move) : null });
    this.log(`⚽ GOAL!! ${shooter.p.name}（${this.teamInfo[t].name}）`, '#ffd400');
    this.updateHud(true);
    await this.bigText('GOAL!!', t === 0 ? '#ffd400' : '#ff4d4d');
    this.kickoff(1 - t);
  }

  kickoff(team) {
    const b = this.ball;
    b.pass = null; b.vx = b.vy = 0; b.x = 50; b.y = 32;
    this.tween = null;
    for (const p of this.players) {
      p.x = p.team === 0 ? Math.min(p.home.x, 46) : Math.max(p.home.x, 54);
      p.y = p.home.y; p.tx = p.x; p.ty = p.y;
      p.stun = 0; p.cd = 0.5;
    }
    const fws = this.teams[team].filter(p => p.pos === 'FW');
    const kicker = (fws.length ? fws : this.teams[team].slice(1))[0];
    kicker.x = team === 0 ? 49 : 51; kicker.y = 32;
    this.setOwner(kicker);
    this.updateBall(0);
    this.freeze = 0.9;
    this.duelCd = 2.5;
  }

  endHalf() {
    this.run(async () => {
      if (this.half === 1) {
        this.log('ハーフタイム');
        await this.bigText('HALF TIME', '#7dd3fc');
        for (const p of this.players) p.tp = Math.min(p.maxTp, p.tp + p.maxTp * 0.4);
        this.half = 2; this.clock = 0;
        this.kickoff(1);
        this.log('後半開始！');
      } else {
        this.running = false;
        this.log('試合終了！');
        await this.bigText('FULL TIME', '#ffffff', 1600);
        if (!this.stopped) this.onEnd({ score: [...this.score], goals: this.goals, stats: this.stats });
      }
    });
  }

  // ---------- 入力 ----------
  bindInput() {
    this.canvas.addEventListener('pointerdown', e => {
      const r = this.canvas.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width * FIELD_W;
      const fy = (e.clientY - r.top) / r.height * FIELD_H;
      if (this.passMode) {
        const owner = this.ball.owner;
        let best = null, bd = 12;
        for (const m of this.teams[0]) {
          if (m === owner) continue;
          const d = Math.hypot(m.x - fx, m.y - fy);
          if (d < bd) { bd = d; best = m; }
        }
        if (best && owner && owner.team === 0) this.pass(owner, best);
        this.setPassMode(false);
        return;
      }
      if (this.busy || this.settings.auto) return;
      if (this.ball.owner && this.ball.owner.team === 0) this.userTarget = { x: fx, y: fy };
    });
    const q = s => this.root.querySelector(s);
    q('#btn-pass').onclick = () => {
      const o = this.ball.owner;
      if (this.passMode) return this.setPassMode(false);
      if (this.busy || !o || o.team !== 0 || o.pos === 'GK') return;
      this.setPassMode(true);
    };
    q('#btn-shoot').onclick = () => {
      const o = this.ball.owner;
      if (this.busy || this.passMode || !o || o.team !== 0 || o.pos === 'GK') return;
      this.run(() => this.userShoot(o, false));
    };
    q('#btn-auto').onclick = () => {
      this.settings.auto = !this.settings.auto;
      this.setPassMode(false);
      this.updateHud(true);
    };
    q('#btn-speed').onclick = () => {
      this.settings.speed = this.settings.speed >= 3 ? 1 : this.settings.speed + 1;
      this.updateHud(true);
    };
  }

  setPassMode(on) {
    this.passMode = on;
    const b = this.root.querySelector('#btn-pass');
    if (b) b.classList.toggle('active', on);
    if (on) this.flash('パス先の味方をタップ', '#fff');
  }

  // ---------- 表示 ----------
  log(msg, color) {
    const el = this.root.querySelector('#mlog');
    if (!el) return;
    const li = document.createElement('li');
    li.innerHTML = `<span class="min">${this.minute()}'</span> ${esc(msg)}`;
    if (color) li.style.color = color;
    el.prepend(li);
    while (el.children.length > 40) el.lastChild.remove();
  }

  updateHud(force) {
    const q = s => this.root.querySelector(s);
    q('#sc-home').textContent = this.score[0];
    q('#sc-away').textContent = this.score[1];
    q('#sc-time').textContent = `${this.half === 1 ? '前半' : '後半'} ${this.minute()}'`;
    if (force) {
      q('#btn-auto').textContent = this.settings.auto ? 'オート:ON' : 'オート:OFF';
      q('#btn-auto').classList.toggle('active', this.settings.auto);
      q('#btn-speed').textContent = `速度 x${this.settings.speed}`;
    }
    const o = this.ball.owner;
    const canAct = o && o.team === 0 && o.pos !== 'GK' && !this.busy;
    q('#btn-pass').disabled = !canAct && !this.passMode;
    q('#btn-shoot').disabled = !canAct || this.passMode;
    const tpEl = q('#tplist');
    tpEl.innerHTML = this.teams[0].map(p => {
      const pct = Math.round(p.tp / p.maxTp * 100);
      return `<div class="tp-row${p === o ? ' has' : ''}"><span>${esc(p.p.name.split(' ')[0])}</span><i><b style="width:${pct}%"></b></i><em>${Math.floor(p.tp)}</em></div>`;
    }).join('');
  }

  render() {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const s = W / FIELD_W;
    // 芝
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i % 2 ? '#1d7a3a' : '#228a42';
      ctx.fillRect(i * W / 10, 0, W / 10 + 1, H);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 2;
    ctx.strokeRect(s * 0.3, s * 0.3, W - s * 0.6, H - s * 0.6);
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 9.15 * s, 0, Math.PI * 2); ctx.stroke();
    for (const side of [0, 1]) {
      const x0 = side ? W : 0, sg = side ? -1 : 1;
      ctx.strokeRect(Math.min(x0, x0 + sg * 16.5 * s), 11.85 * s, 16.5 * s, 40.3 * s);
      ctx.strokeRect(Math.min(x0, x0 + sg * 5.5 * s), 22.85 * s, 5.5 * s, 18.3 * s);
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.fillRect(side ? W - 0.8 * s : 0, GOAL_Y1 * s, 0.8 * s, (GOAL_Y2 - GOAL_Y1) * s);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      ctx.strokeRect(side ? W - 0.8 * s : 0, GOAL_Y1 * s, 0.8 * s, (GOAL_Y2 - GOAL_Y1) * s);
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2;
    }
    // 移動目標
    if (this.userTarget) {
      ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.userTarget.x * s, this.userTarget.y * s, 0.9 * s, 0, Math.PI * 2); ctx.stroke();
    }
    // 選手
    const owner = this.ball.owner;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of this.players) {
      const col = this.teamInfo[p.team].color;
      const x = p.x * s, y = p.y * s, r = 1.9 * s;
      ctx.globalAlpha = p.stun > 0 ? 0.45 : 1;
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(x, y + r * 0.8, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      if (this.passMode && p.team === 0 && p !== owner) {
        ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, r + 0.9 * s, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = p.pos === 'GK' ? 3 : 2;
      ctx.strokeStyle = p.pos === 'GK' ? '#ffd400' : (p.team === 0 ? '#fff' : '#111');
      ctx.stroke();
      ctx.fillStyle = textColorFor(col);
      ctx.font = `bold ${Math.round(s * 1.9)}px sans-serif`;
      ctx.fillText(String(p.idx + 1), x, y + 1);
      if (p === owner) {
        ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r + 0.5 * s, 0, Math.PI * 2); ctx.stroke();
        ctx.font = `bold ${Math.round(s * 2.2)}px sans-serif`;
        ctx.fillStyle = '#000'; ctx.fillText(p.p.name, x + 1, y - r - s * 1.2 + 1);
        ctx.fillStyle = '#fff'; ctx.fillText(p.p.name, x, y - r - s * 1.2);
      }
      ctx.globalAlpha = 1;
    }
    // ボール
    const b = this.ball, bh = (b.h || 0) * s;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(b.x * s, b.y * s + 0.5 * s, 0.7 * s, 0.3 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(b.x * s, b.y * s - bh, 0.95 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

// ===== PK戦 =====
function simulatePK(ourPlayers, oppPlayers) {
  const kickers = list => list.filter(p => p.pos !== 'GK').sort((a, b) => b.stats.kick - a.stats.kick).slice(0, 5);
  const ours = kickers(ourPlayers), theirs = kickers(oppPlayers);
  const ourGK = ourPlayers[0], oppGK = oppPlayers[0];
  const prob = (k, gk) => clamp(0.75 + (k.stats.kick - gk.stats.catch) / 200, 0.4, 0.95);
  const seq = [];
  let a = 0, b = 0;
  for (let i = 0; i < 20; i++) {
    const k1 = ours[i % ours.length], k2 = theirs[i % theirs.length];
    const g1 = Math.random() < prob(k1, oppGK), g2 = Math.random() < prob(k2, ourGK);
    a += g1; b += g2;
    seq.push({ ours: k1.name, g1, theirs: k2.name, g2 });
    if (i >= 4 && a !== b) break;
    if (i < 4) {
      const left = 4 - i;
      if (a > b + left || b > a + left) break;
    }
  }
  if (a === b) { a++; seq.push({ ours: ours[0].name, g1: true, theirs: theirs[0].name, g2: false }); }
  return { a, b, seq };
}
