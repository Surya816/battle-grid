// ================================================================
//  BATTLE GRID — powers.js
//  Inventory system, power spawning, knife attack, power activation
// ================================================================

// ── SPAWN UNIQUE POWER ──
function spawnPower() {
    const onMap = new Set(S.powerDrops.map(d => d.type));
    const held = new Set([...S.p1.inv, ...S.p2.inv]);
    const avail = PWR_KEYS.filter(k => !onMap.has(k) && !held.has(k));
    if (avail.length === 0) return;
    const type = avail[ri(avail.length)];
    let x, y, tries = 0;
    do { x = 2 + ri(G - 4); y = 2 + ri(G - 4); tries++; }
    while ((isW(x, y) || (S.p1.x === x && S.p1.y === y) || (S.p2.x === x && S.p2.y === y)) && tries < 50);
    if (tries >= 50) return;
    S.powerDrops.push({ x, y, type });
    banner(PWR[type].icon + ' ' + type + ' SPAWNED!', 2000, PWR[type].col);
}

// ── ACTIVATE POWER (shared by player and AI) ──
function activatePower(p, pw) {
    const other = p.isAI ? S.p1 : S.p2;
    const tc = tcx(p.x, p.y);
    if (pw === 'SHIELD') {
        p.shield = { on: true, t: PWR.SHIELD.dur, hits: 2 };
        banner('SHIELD ON!', 1500, '#00ff88'); snd('shield');
        burst(tc.x, tc.y, '#00ff88', 12, 120);
    } else if (pw === 'FIRE') {
        for (let s = 1; s <= 3; s++) {
            const fx = p.x + p.facing.dx * s, fy = p.y + p.facing.dy * s;
            if (inB(fx, fy) && !isW(fx, fy)) S.fireTiles.set(fx + ',' + fy, PWR.FIRE.dur);
        }
        if (!p.isAI) banner('FIRE!', 1500, '#ff4400'); snd('pwr');
    } else if (pw === 'SPEED') {
        p.speed = { on: true, t: PWR.SPEED.dur };
        if (!p.isAI) banner('SPEED BOOST!', 1500, '#ffcc00'); snd('pwr');
        burst(tc.x, tc.y, '#ffcc00', 10, 100);
    } else if (pw === 'WALL') {
        if (p.wallCharges <= 0) {
            addPop(tc.x, tc.y - 20, 'NO WALLS', '#ff4444');
            p.inv.unshift(pw); return;
        }
        const wx = p.x + p.facing.dx, wy = p.y + p.facing.dy;
        if (!inB(wx, wy) || isW(wx, wy) || (other.alive && other.x === wx && other.y === wy)) {
            p.inv.unshift(pw); return;
        }
        S.walls.set(wx + ',' + wy, 3); p.wallCharges--; snd('pwr');
    }
}

// ── USE POWER from inventory (player) ──
function usePwr(slot) {
    const p = S.p1; if (!p.alive || !S.running || slot >= p.inv.length) return;
    const pw = p.inv[slot];
    p.inv.splice(slot, 1);
    activatePower(p, pw);
    updatePwrUI();
}

// ── KNIFE (melee) — 360° slash like Valkyrie ──
function useKnife() {
    const p = S.p1; if (!p.alive || !S.running || p.knifeCd > 0) return;
    const tgt = S.p2;
    // Chebyshev distance — hits ALL 8 surrounding tiles (including diagonals)
    const cdist = Math.max(Math.abs(p.x - tgt.x), Math.abs(p.y - tgt.y));
    p.knifeCd = KNIFE_CD;
    const myTc = tcx(p.x, p.y);

    // 360° slash ring visual — stored in game state, drawn by render.js
    S.knifeSlash = { x: myTc.x, y: myTc.y, t: 400, ml: 400, who: 'p1' };

    // ── Hit enemy ──
    if (cdist <= 1 && tgt.alive) {
        const tgtTc = tcx(tgt.x, tgt.y);
        if (tgt.shield.on && tgt.shield.hits > 0) {
            tgt.shield.hits--;
            burst(tgtTc.x, tgtTc.y, '#00ff88', 15, 180);
            addPop(tgtTc.x, tgtTc.y - 20, 'BLOCKED!', '#00ff88'); snd('shield');
        } else {
            dmg(tgt, KNIFE_DMG); shk.m = 15; snd('hit');
            burst(tgtTc.x, tgtTc.y, '#ff8800', 22, 200);
            addPop(tgtTc.x, tgtTc.y - 20, '⚔️ -' + KNIFE_DMG, '#ff8800');
            if (!tgt.alive && tgt.inv.length > 0 && p.inv.length < MAX_INV) {
                const stolen = tgt.inv.pop();
                p.inv.push(stolen);
                banner('STOLE ' + stolen + '!', 2000, '#ff00ff');
                burst(myTc.x, myTc.y, '#ff00ff', 15, 150);
            }
        }
    }

    // ── Damage adjacent walls (all 8 directions) ──
    for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
            if (ox === 0 && oy === 0) continue;
            const wx = p.x + ox, wy = p.y + oy;
            const wk = wx + ',' + wy;
            if (inB(wx, wy) && S.walls.has(wk)) {
                const hp = S.walls.get(wk) - 1;
                const wTc = tcx(wx, wy);
                if (hp <= 0) {
                    S.walls.delete(wk);
                    burst(wTc.x, wTc.y, '#aa8833', 14, 130);
                    addPop(wTc.x, wTc.y - 14, '💥', '#aa8833');
                } else {
                    S.walls.set(wk, hp);
                    burst(wTc.x, wTc.y, '#8a6622', 6, 70);
                }
            }
        }
    }

    snd('hit');
}

// ── INVENTORY UI ──
function updatePwrUI() {
    const p = S.p1;
    for (let i = 0; i < 2; i++) {
        const el = document.getElementById('pw' + i);
        if (i < p.inv.length) {
            const pw = p.inv[i];
            el.textContent = PWR[pw].icon + ' ' + pw;
            el.className = 'pwr-btn ready';
            el.style.borderColor = PWR[pw].col + '66';
        } else {
            el.textContent = '---';
            el.className = 'pwr-btn';
            el.style.borderColor = '#222';
        }
    }
}
