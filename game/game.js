// ================================================================
//  BATTLE GRID — game.js  (Top-Down Edition)
//  Core constants, state, loop, map, player, audio, zone
// ================================================================

const G = 10, MAXW = 500, WALLS = 13, MAX_HP = 5;
const MOVE_MS = 130, PROJ_SPD = 680, ATK_CD = 180, KNIFE_CD = 250, KNIFE_DMG = 2;
const ZONE_MS = 9000, ZONE_DMG = 1, ZONE_DMG_MS = 2500;
const PWR_SPAWN_MS = 8000, MAX_INV = 2;

const PWR = {
    SHIELD: { dur: 4000, name: 'SHIELD', icon: '🛡️', col: '#00ff88' },
    FIRE: { dur: 6000, name: 'FIRE', icon: '🔥', col: '#ff4400' },
    SPEED: { dur: 4000, name: 'SPEED', icon: '⚡', col: '#ffcc00' },
    WALL: { dur: 0, name: 'WALL', icon: '🧱', col: '#aa8833' }
};
const PWR_KEYS = ['SHIELD', 'FIRE', 'SPEED', 'WALL'];

const AI_P = {
    easy: { ms: 320, acc: 0.40, atkCd: 1400, think: 400, pwr: 0.02, dodge: false },
    medium: { ms: 180, acc: 0.72, atkCd: 800, think: 180, pwr: 0.06, dodge: true },
    hard: { ms: 110, acc: 0.95, atkCd: 500, think: 80, pwr: 0.12, dodge: true }
};

// ── Globals ──
let cv, cx, cell;
let S = {}, K = {}, TC = {};
let raf = null, AC = null;
let shk = { x: 0, y: 0, m: 0 };
let aiDiff = 'medium', mouseX = 0, mouseY = 0;

// Virtual joystick state
const JOY = { active: false, ox: 0, oy: 0, dx: 0, dy: 0, dist: 0 };
const JOY_THRESHOLD = 12; // min drag px to trigger movement
const JOY_MAX = 60;       // visual clamp radius

const ri = n => Math.floor(Math.random() * n);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Centre of grid cell in canvas pixels
const tcx = (gx, gy) => ({ x: gx * cell + cell / 2, y: gy * cell + cell / 2 });

// ── PWA ──
if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(() => { });

// ── INIT ──
window.onload = () => {
    cv = document.getElementById('C');
    cx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', e => {
        // Don't fire game actions when typing in an input box (e.g. room code)
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        K[e.code] = true;
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
        if (S && S.running) {
            if (e.code === 'Digit1') usePwr(0);
            if (e.code === 'Digit2') usePwr(1);
            if (e.code === 'KeyQ') useKnife();
        }
    });
    window.addEventListener('keyup', e => { K[e.code] = false; });

    // ── Joystick touch handlers ──
    const jzone = document.getElementById('jzone');
    jzone.addEventListener('touchstart', e => {
        e.preventDefault(); // prevent ghost clicks
        const t = e.touches[0];
        const r = jzone.getBoundingClientRect();
        JOY.active = true;
        JOY.ox = t.clientX - r.left;
        JOY.oy = t.clientY - r.top;
        JOY.dx = 0; JOY.dy = 0; JOY.dist = 0;
    }, { passive: false });
    jzone.addEventListener('touchmove', e => {
        e.preventDefault();
        if (!JOY.active) return;
        const t = e.touches[0];
        const r = jzone.getBoundingClientRect();
        JOY.dx = (t.clientX - r.left) - JOY.ox;
        JOY.dy = (t.clientY - r.top) - JOY.oy;
        JOY.dist = Math.sqrt(JOY.dx * JOY.dx + JOY.dy * JOY.dy);
    }, { passive: false });
    jzone.addEventListener('touchend', e => {
        JOY.active = false; JOY.dx = 0; JOY.dy = 0; JOY.dist = 0;
    }, { passive: true });
    jzone.addEventListener('touchcancel', e => {
        JOY.active = false; JOY.dx = 0; JOY.dy = 0; JOY.dist = 0;
    }, { passive: true });
    let mouseIsDown = false;
    cv.addEventListener('mousedown', e => {
        if (!S.running) return;
        mouseIsDown = true;
        const r = cv.getBoundingClientRect();
        mouseX = e.clientX - r.left; mouseY = e.clientY - r.top;
        if (typeof MP !== 'undefined') MP._guestMouseShoot = true;
        shootAtMouse();
    });
    window.addEventListener('mouseup', () => {
        mouseIsDown = false;
        if (typeof MP !== 'undefined') MP._guestMouseShoot = false;
    });
    cv.addEventListener('mousemove', e => {
        const r = cv.getBoundingClientRect();
        mouseX = e.clientX - r.left; mouseY = e.clientY - r.top;
    });
    cv.addEventListener('touchstart', e => {
        if (!S.running) return;
        mouseIsDown = true;
        const r = cv.getBoundingClientRect(), t = e.touches[0];
        mouseX = t.clientX - r.left; mouseY = t.clientY - r.top;
        if (typeof MP !== 'undefined') MP._guestMouseShoot = true;
        shootAtMouse();
    }, { passive: true });
    window.addEventListener('touchend', () => {
        mouseIsDown = false;
        if (typeof MP !== 'undefined') MP._guestMouseShoot = false;
    });
};

function resize() {
    const isLandscape = window.innerWidth > window.innerHeight;
    let target = Math.min(window.innerWidth, MAXW);
    if (isLandscape) target = Math.min(window.innerHeight * 0.88, MAXW);
    cell = Math.floor(target / G);
    cv.width = cell * G; cv.height = cell * G;
    if (S.running) render();
}

function setDiff(d) {
    aiDiff = d;
    ['easy', 'med', 'hard'].forEach(x => document.getElementById('d' + x).className = 'dbtn');
    document.getElementById('d' + (d === 'medium' ? 'med' : d)).className = 'dbtn sel';
}
function mp(d, v) {
    TC[d] = !!v; // just track hold state — update() fires every frame
}

// ── AUDIO ──
function initAudio() {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { }
}
function snd(type) {
    if (!AC) return;
    const n = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
    o.connect(g); g.connect(AC.destination);
    if (type === 'shoot') { o.type = 'sine'; o.frequency.setValueAtTime(380, n); o.frequency.exponentialRampToValueAtTime(90, n + .15); g.gain.setValueAtTime(.18, n); g.gain.exponentialRampToValueAtTime(.001, n + .18); o.start(n); o.stop(n + .2); }
    else if (type === 'hit') { o.type = 'sawtooth'; o.frequency.setValueAtTime(280, n); o.frequency.exponentialRampToValueAtTime(50, n + .22); g.gain.setValueAtTime(.35, n); g.gain.exponentialRampToValueAtTime(.001, n + .25); o.start(n); o.stop(n + .26); }
    else if (type === 'zone') { o.type = 'square'; o.frequency.setValueAtTime(100, n); g.gain.setValueAtTime(.12, n); g.gain.exponentialRampToValueAtTime(.001, n + .3); o.start(n); o.stop(n + .32); }
    else if (type === 'pwr') { o.type = 'sine'; o.frequency.setValueAtTime(600, n); o.frequency.exponentialRampToValueAtTime(1200, n + .1); g.gain.setValueAtTime(.15, n); g.gain.exponentialRampToValueAtTime(.001, n + .12); o.start(n); o.stop(n + .13); }
    else if (type === 'shield') { o.type = 'triangle'; o.frequency.setValueAtTime(400, n); o.frequency.exponentialRampToValueAtTime(800, n + .15); g.gain.setValueAtTime(.2, n); g.gain.exponentialRampToValueAtTime(.001, n + .18); o.start(n); o.stop(n + .2); }
    else if (type === 'win') { [523, 659, 784, 1047].forEach((f, i) => { const oo = AC.createOscillator(), gg = AC.createGain(); oo.connect(gg); gg.connect(AC.destination); oo.frequency.value = f; const t = n + i * .12; gg.gain.setValueAtTime(.2, t); gg.gain.exponentialRampToValueAtTime(.001, t + .28); oo.start(t); oo.stop(t + .3); }); }
}

// ── MAP ──
function makeWalls() {
    const w = new Map(), safe = new Set();
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { safe.add(a + ',' + b); safe.add((G - 1 - a) + ',' + (G - 1 - b)); }
    let c = 0;
    while (w.size < WALLS && ++c < 500) { const x = ri(G), y = ri(G), k = x + ',' + y; if (!safe.has(k)) w.set(k, 3); }
    return w;
}
function isW(x, y) { return x >= 0 && x < G && y >= 0 && y < G && S.walls.has(x + ',' + y); }
function inB(x, y) { return x >= 0 && x < G && y >= 0 && y < G; }
function hasLOS(ax, ay, bx, by) {
    if (ax === bx) { for (let y = Math.min(ay, by) + 1; y < Math.max(ay, by); y++) if (isW(ax, y)) return false; return true; }
    if (ay === by) { for (let x = Math.min(ax, bx) + 1; x < Math.max(ax, bx); x++) if (isW(x, ay)) return false; return true; }
    return false;
}

// ── PLAYER ──
function makePlayer(id, x, y, col, isAI) {
    return {
        id, x, y, hp: MAX_HP, maxHp: MAX_HP, col,
        facing: { dx: isAI ? -1 : 1, dy: 0 },
        moveT: 0, atkCd: 0, knifeCd: 0, flash: 0, alive: true, isAI,
        shield: { on: false, t: 0, hits: 0 },
        speed: { on: false, t: 0 },
        inv: [], wallCharges: 0
    };
}

// ── START ──
function startGame() {
    initAudio();
    S = {
        running: true, t: 0,
        walls: makeWalls(),
        terrain: Array.from({ length: G }, () => Array.from({ length: G }, () => Math.random())),
        zone: { x1: 0, y1: 0, x2: G - 1, y2: G - 1 },
        zT: ZONE_MS, zdT: ZONE_DMG_MS,
        p1: makePlayer('p1', 1, 1, '#00d4ff', false),
        p2: makePlayer('p2', G - 2, G - 2, '#ff4500', true),
        proj: [], part: [], pops: [],
        fireTiles: new Map(),
        powerDrops: [],
        pwrSpawnT: 3000,
        knifeSlash: null,
        ai: { st: 'HUNT', tT: 0, skT: 0, lp: { x: -1, y: -1 } },
        ts: performance.now()
    };
    document.getElementById('overlay').style.display = 'none';
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
}

// ── LOOP ──
function loop(ts) {
    const dt = Math.min(ts - S.ts, 50); S.ts = ts;
    if (!S.running) return;
    S.t += dt; update(dt); render();
    raf = requestAnimationFrame(loop);
}

// ── UPDATE ──
function update(dt) {
    const p1 = S.p1, p2 = S.p2;
    S.zT -= dt; if (S.zT <= 0) { shrinkZone(); S.zT = ZONE_MS; }
    S.zdT -= dt; if (S.zdT <= 0) { zoneDmg(); S.zdT = ZONE_DMG_MS; }
    // Fire tiles
    const dead = [];
    S.fireTiles.forEach((ttl, k) => {
        const nt = ttl - dt; if (nt <= 0) dead.push(k); else S.fireTiles.set(k, nt);
        const [fx, fy] = k.split(',').map(Number);
        [p1, p2].forEach(p => {
            if (p.alive && p.x === fx && p.y === fy && S.t % 800 < dt) {
                const c = tcx(p.x, p.y); dmg(p, 1); burst(c.x, c.y, '#ff4400', 6, 80);
            }
        });
    });
    dead.forEach(k => S.fireTiles.delete(k));
    // Timers
    [p1, p2].forEach(p => {
        if (p.shield.on) { p.shield.t -= dt; if (p.shield.t <= 0 || p.shield.hits <= 0) p.shield.on = false; }
        if (p.speed.on) { p.speed.t -= dt; if (p.speed.t <= 0) p.speed.on = false; }
    });
    // Power spawn
    S.pwrSpawnT -= dt; if (S.pwrSpawnT <= 0) { spawnPower(); S.pwrSpawnT = PWR_SPAWN_MS; }
    // Knife slash animation tick
    if (S.knifeSlash) { S.knifeSlash.t -= dt; if (S.knifeSlash.t <= 0) S.knifeSlash = null; }
    // Power pickup
    [p1, p2].forEach(p => {
        if (!p.alive) return;
        S.powerDrops = S.powerDrops.filter(d => {
            if (d.x === p.x && d.y === p.y && p.inv.length < MAX_INV) {
                p.inv.push(d.type);
                if (d.type === 'WALL') p.wallCharges += 2;
                const c = tcx(d.x, d.y); burst(c.x, c.y, PWR[d.type].col, 15, 140);
                addPop(c.x, c.y - 18, '+' + d.type, PWR[d.type].col); snd('pwr');
                if (!p.isAI) banner('GOT ' + d.type + '!', 1200, PWR[d.type].col);
                return false;
            }
            return true;
        });
    });
    playerInput(dt);
    if (typeof MP !== 'undefined' && MP.enabled && MP.role === 'host') applyRemoteP2Input(dt);
    if (p2.alive && p1.alive && !(typeof MP !== 'undefined' && MP.enabled)) updateAI(dt);
    // In MP mode, AI is off but we still need to tick p2.moveT so guest movement can apply
    if (typeof MP !== 'undefined' && MP.enabled) p2.moveT = Math.max(0, p2.moveT - dt);
    p1.atkCd = Math.max(0, p1.atkCd - dt); p2.atkCd = Math.max(0, p2.atkCd - dt);
    p1.knifeCd = Math.max(0, p1.knifeCd - dt); p2.knifeCd = Math.max(0, p2.knifeCd - dt);
    p1.flash = Math.max(0, p1.flash - dt); p2.flash = Math.max(0, p2.flash - dt);
    updProj(dt);
    S.part = S.part.filter(p => { p.life -= dt; p.x += p.vx * (dt / 1000); p.y += p.vy * (dt / 1000); p.vy += 160 * (dt / 1000); return p.life > 0; });
    S.pops = S.pops.filter(p => { p.life -= dt; return p.life > 0; });
    shk.m *= 0.8;
    if (shk.m > 0.3) { shk.x = (Math.random() - .5) * shk.m; shk.y = (Math.random() - .5) * shk.m; }
    else { shk.x = 0; shk.y = 0; shk.m = 0; }
    // ── Hold-to-fire: auto-shoot / auto-knife while button held ──
    if (S.running && p1.alive) {
        if (typeof MP !== 'undefined' && MP.enabled && MP.role === 'guest') {
            // Guest input handled entirely in mpGuestInput()
        } else {
            if (TC.atk && p1.atkCd <= 0) shoot(p1);
            if (TC.knife && p1.knifeCd <= 0) useKnife();
            // Allow Host to perfectly hold-to-fire with mouse click too
            if (typeof mouseIsDown !== 'undefined' && mouseIsDown && p1.atkCd <= 0) shootAtMouse();
        }
    }
    checkWin(); updateHUD();
    if (typeof MP !== 'undefined' && MP.enabled && MP.role === 'host') syncHostState();
}

// ── PLAYER INPUT ──
function playerInput(dt) {
    const isGuest = (typeof MP !== 'undefined' && MP.enabled && MP.role === 'guest');

    // Guest MUST still send continuous input state to host via mpGuestInput
    if (isGuest) mpGuestInput(dt);

    const p = isGuest ? S.p2 : S.p1;
    if (!p || !p.alive) return;
    const spd = p.speed.on ? MOVE_MS / 2.5 : MOVE_MS;
    p.moveT = Math.max(0, p.moveT - dt);
    if (p.moveT <= 0) {
        let dx = 0, dy = 0;

        // ── Keyboard (desktop) ──
        if (K['KeyW']) dy = -1;
        else if (K['KeyS']) dy = 1;
        else if (K['KeyA']) dx = -1;
        else if (K['KeyD']) dx = 1;

        // ── Virtual joystick (overrides keyboard) ──
        if (JOY.active && JOY.dist >= JOY_THRESHOLD) {
            // Map joystick angle to 4-way grid direction
            const angle = Math.atan2(JOY.dy, JOY.dx); // -π … π
            const deg = angle * 180 / Math.PI;          // -180 … 180
            // 4 sectors of 90° each, offset 45°
            if (deg >= -45 && deg < 45) { dx = 1; dy = 0; } // RIGHT
            else if (deg >= 45 && deg < 135) { dx = 0; dy = 1; } // DOWN
            else if (deg >= 135 || deg < -135) { dx = -1; dy = 0; } // LEFT
            else { dx = 0; dy = -1; } // UP
        }

        if (dx || dy) {
            p.facing = { dx: dx || p.facing.dx, dy: dy || p.facing.dy };
            const nx = p.x + dx, ny = p.y + dy;
            const otherP = isGuest ? S.p1 : S.p2;
            if (inB(nx, ny) && !isW(nx, ny) && !(otherP && otherP.alive && otherP.x === nx && otherP.y === ny)) {
                p.x = nx; p.y = ny; p.moveT = spd;
            }
        }
    }
}
function shootAtMouse() {
    const isGuest = (typeof MP !== 'undefined' && MP.enabled && MP.role === 'guest');
    const p = isGuest ? S.p2 : S.p1;
    if (!p.alive || p.atkCd > 0) return;
    const c = tcx(p.x, p.y);
    const adx = mouseX - c.x, ady = mouseY - c.y;
    let dx = 0, dy = 0;
    if (Math.abs(adx) > Math.abs(ady)) dx = adx > 0 ? 1 : -1; else dy = ady > 0 ? 1 : -1;

    if (isGuest) {
        // For guest, we save facing to send over Firebase. We DO NOT mutate P1 locally!
        MP.guestMouseFace = { dx, dy };
    } else {
        p.facing = { dx, dy };
        shoot(p);
    }
}

// ── SHOOTING ──
function shoot(p) {
    p.atkCd = p.isAI ? AI_P[aiDiff].atkCd : ATK_CD;
    const c = tcx(p.x, p.y);
    S.proj.push({ x: c.x, y: c.y, vx: p.facing.dx * PROJ_SPD, vy: p.facing.dy * PROJ_SPD, from: p.id, col: p.col, trail: [], done: false });
    snd('shoot'); burst(c.x, c.y, p.col, 5, 90);
}

// ── PROJECTILES ──
function updProj(dt) {
    S.proj.forEach(pr => {
        if (pr.done) return;
        pr.trail.unshift({ x: pr.x, y: pr.y });
        if (pr.trail.length > 8) pr.trail.pop();
        pr.x += pr.vx * (dt / 1000); pr.y += pr.vy * (dt / 1000);
        const gx = Math.floor(pr.x / cell), gy = Math.floor(pr.y / cell);
        if (!inB(gx, gy)) { pr.done = true; return; }
        if (S.walls.has(gx + ',' + gy)) {
            const hp = S.walls.get(gx + ',' + gy) - 1;
            if (hp <= 0) { S.walls.delete(gx + ',' + gy); burst(pr.x, pr.y, '#aa8833', 12, 130); }
            else { S.walls.set(gx + ',' + gy, hp); burst(pr.x, pr.y, '#aa8833', 6, 75); }
            pr.done = true; snd('hit'); return;
        }
        const tgt = pr.from === 'p1' ? S.p2 : S.p1;
        if (tgt.alive && tgt.x === gx && tgt.y === gy) {
            if (tgt.shield.on && tgt.shield.hits > 0) {
                tgt.shield.hits--;
                burst(pr.x, pr.y, '#00ff88', 15, 170);
                addPop(pr.x, pr.y - 14, 'BLOCKED!', '#00ff88'); snd('shield');
            } else {
                dmg(tgt, 1); burst(pr.x, pr.y, tgt.col, 18, 190); shk.m = 12; snd('hit');
            }
            pr.done = true;
        }
    });
    S.proj = S.proj.filter(p => !p.done);
}

function dmg(p, d) {
    p.hp = Math.max(0, p.hp - d); p.flash = 400;
    if (p.hp <= 0) {
        p.alive = false;
        const c = tcx(p.x, p.y); burst(c.x, c.y, '#ff4400', 25, 190); shk.m = 18; snd('hit');
    }
}

// ── ZONE ──
function shrinkZone() {
    const z = S.zone; if (z.x2 - z.x1 < 3 || z.y2 - z.y1 < 3) return;
    const s = ['x1', 'y1', 'x2', 'y2'][ri(4)];
    if (s === 'x1') z.x1 = Math.min(z.x1 + 1, z.x2 - 2);
    if (s === 'y1') z.y1 = Math.min(z.y1 + 1, z.y2 - 2);
    if (s === 'x2') z.x2 = Math.max(z.x2 - 1, z.x1 + 2);
    if (s === 'y2') z.y2 = Math.max(z.y2 - 1, z.y1 + 2);
    shk.m = 8; snd('zone');
}
function zoneDmg() {
    const z = S.zone;
    [S.p1, S.p2].forEach(p => {
        if (!p.alive) return;
        if (p.x < z.x1 || p.x > z.x2 || p.y < z.y1 || p.y > z.y2) {
            const c = tcx(p.x, p.y); dmg(p, ZONE_DMG); burst(c.x, c.y, '#ff4400', 8, 90); snd('zone');
        }
    });
}

// ── WIN CHECK ──
function checkWin() {
    if (!S.p1.alive && !S.p2.alive) { S.running = false; showEnd('DRAW', 'Both fell!', '#888'); }
    else if (!S.p1.alive) { S.running = false; showEnd('DEFEAT', 'AI wins this round.', '#ff4500'); }
    else if (!S.p2.alive) { S.running = false; snd('win'); showEnd('VICTORY!', 'You are the champion!', '#00ff88'); }
}
function showEnd(t, s, c) {
    document.getElementById('overlay').innerHTML =
        '<h2 style="color:' + c + ';text-shadow:0 0 20px ' + c + '">' + t + '</h2><p>' + s + '</p>' +
        '<button class="btn" onclick="startGame()">PLAY AGAIN</button>';
    document.getElementById('overlay').style.display = 'flex';
}

// ── HELPERS ──
function burst(x, y, c, n, s) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = s * (.4 + Math.random());
        S.part.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, col: c, life: 250 + Math.random() * 250, ml: 500, sz: 2 + Math.random() * 3 });
    }
}
function addPop(x, y, t, c) { S.pops.push({ x, y, t, c, life: 800, ml: 800 }); }
function banner(txt, dur, col) {
    const el = document.getElementById('ev');
    el.textContent = txt; el.style.color = col; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), dur);
}

// ── HUD ──
function updateHUD() {
    const p1 = S.p1, p2 = S.p2;
    document.getElementById('p1bar').style.width = (p1.hp / p1.maxHp) * 100 + '%';
    document.getElementById('p2bar').style.width = (p2.hp / p2.maxHp) * 100 + '%';
    document.getElementById('p1txt').textContent = p1.hp + ' HP' + (p1.shield.on ? ' 🛡️' : '') + (p1.speed.on ? ' ⚡' : '');
    document.getElementById('p2txt').textContent = p2.hp + ' HP' + (p2.inv.length > 0 ? ' [' + p2.inv.length + ' pwr]' : '');
    updatePwrUI();
}
