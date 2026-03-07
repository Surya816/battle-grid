// ================================================================
//  BATTLE GRID — ai.js
//  AI state machine: HUNT / EVADE / RUSH / ROTATE
//  Uses inventory-based powers and knife when adjacent
// ================================================================

function updateAI(dt) {
    if (typeof MP !== 'undefined' && MP.enabled) return;
    const ai = S.p2, pl = S.p1, cfg = AI_P[aiDiff], a = S.ai;
    a.tT -= dt; if (a.tT > 0) return; a.tT = cfg.think;
    if (!ai.alive) return;

    const z = S.zone;
    const dist = Math.abs(ai.x - pl.x) + Math.abs(ai.y - pl.y);
    const inZ = ai.x >= z.x1 && ai.x <= z.x2 && ai.y >= z.y1 && ai.y <= z.y2;

    // ── State Machine ──
    if (!inZ) a.st = 'ROTATE';
    else if (ai.hp <= 1 && dist < 3) a.st = 'EVADE';
    else if (dist <= 2) a.st = 'RUSH';
    else a.st = 'HUNT';

    // ── Target ──
    let tx, ty;
    if (a.st === 'ROTATE') {
        // Also try to reach a nearby power drop
        const nearDrop = S.powerDrops.find(d => ai.inv.length < MAX_INV);
        if (nearDrop) { tx = nearDrop.x; ty = nearDrop.y; }
        else { tx = Math.floor((z.x1 + z.x2) / 2); ty = Math.floor((z.y1 + z.y2) / 2); }
    } else if (a.st === 'EVADE') {
        tx = clamp(ai.x * 2 - pl.x, z.x1, z.x2);
        ty = clamp(ai.y * 2 - pl.y, z.y1, z.y2);
    } else if (a.st === 'HUNT') {
        // Chase nearest power drop if not full
        const nearDrop = S.powerDrops.reduce((best, d) => {
            const md = Math.abs(d.x - ai.x) + Math.abs(d.y - ai.y);
            const pd = Math.abs(pl.x - ai.x) + Math.abs(pl.y - ai.y);
            if (ai.inv.length < MAX_INV && md < pd / 2) return d; // prefer drop if much closer
            return best;
        }, null);
        if (nearDrop) { tx = nearDrop.x; ty = nearDrop.y; }
        else { tx = pl.x; ty = pl.y; }
    } else { tx = pl.x; ty = pl.y; }

    // ── Dodge incoming ──
    if (cfg.dodge) {
        const threats = S.proj.filter(p => p.from === 'p1' && !p.done);
        for (const pr of threats) {
            const pgx = Math.floor(pr.x / cell), pgy = Math.floor(pr.y / cell);
            const willHitX = pr.vx !== 0 && pgy === ai.y && ((pr.vx > 0 && pgx <= ai.x) || (pr.vx < 0 && pgx >= ai.x));
            const willHitY = pr.vy !== 0 && pgx === ai.x && ((pr.vy > 0 && pgy <= ai.y) || (pr.vy < 0 && pgy >= ai.y));
            if (willHitX) {
                const ddy = ai.y < Math.floor(G / 2) ? 1 : -1;
                const ny = ai.y + ddy;
                if (inB(ai.x, ny) && !isW(ai.x, ny)) { ai.y = ny; ai.moveT = cfg.ms; return; }
            }
            if (willHitY) {
                const ddx = ai.x < Math.floor(G / 2) ? 1 : -1;
                const nx = ai.x + ddx;
                if (inB(nx, ai.y) && !isW(nx, ai.y)) { ai.x = nx; ai.moveT = cfg.ms; return; }
            }
        }
    }

    // ── Move ──
    const spd = ai.speed.on ? cfg.ms / 2.5 : cfg.ms;
    ai.moveT = Math.max(0, ai.moveT - dt);
    if (ai.moveT <= 0) {
        let mx = Math.sign(tx - ai.x), my = Math.sign(ty - ai.y);
        if (Math.abs(tx - ai.x) >= Math.abs(ty - ai.y)) my = 0; else mx = 0;
        const nk = (ai.x + mx) + ',' + (ai.y + my);
        if (S.fireTiles.has(nk)) {
            if (mx !== 0) { my = ri(2) ? 1 : -1; mx = 0; } else { mx = ri(2) ? 1 : -1; my = 0; }
        }
        if (mx || my) {
            ai.facing = { dx: mx || ai.facing.dx, dy: my || ai.facing.dy };
            const nx = ai.x + mx, ny = ai.y + my;
            if (inB(nx, ny) && !isW(nx, ny) && !(pl.alive && pl.x === nx && pl.y === ny)) {
                ai.x = nx; ai.y = ny; ai.moveT = spd;
            }
        }
    }

    // ── Shoot ──
    if (ai.atkCd <= 0 && pl.alive) {
        const aligned = (pl.x === ai.x || pl.y === ai.y);
        if (aligned && hasLOS(ai.x, ai.y, pl.x, pl.y)) {
            ai.facing = { dx: Math.sign(pl.x - ai.x) || ai.facing.dx, dy: Math.sign(pl.y - ai.y) || ai.facing.dy };
            if (Math.random() < cfg.acc) shoot(ai);
        } else if (aiDiff === 'hard' && dist <= 3 && Math.random() < 0.1) {
            if (Math.abs(pl.x - ai.x) >= Math.abs(pl.y - ai.y)) ai.facing = { dx: Math.sign(pl.x - ai.x), dy: 0 };
            else ai.facing = { dx: 0, dy: Math.sign(pl.y - ai.y) };
            shoot(ai);
        }
    }

    // ── Knife (360° — all adjacent tiles including diagonal) ──
    const cdist = Math.max(Math.abs(ai.x - pl.x), Math.abs(ai.y - pl.y));
    if (ai.knifeCd <= 0 && cdist <= 1 && pl.alive) {
        const plTc = tcx(pl.x, pl.y), aiTc = tcx(ai.x, ai.y);
        S.knifeSlash = { x: aiTc.x, y: aiTc.y, t: 400, ml: 400, who: 'p2' };
        dmg(pl, KNIFE_DMG); ai.knifeCd = KNIFE_CD; shk.m = 12; snd('hit');
        burst(plTc.x, plTc.y, '#ff8800', 18, 180);
        addPop(plTc.x, plTc.y - 20, '⚔️ -' + KNIFE_DMG, '#ff8800');
        if (!pl.alive && pl.inv.length > 0 && ai.inv.length < MAX_INV) ai.inv.push(pl.inv.pop());
    }

    // ── Use powers ──
    if (Math.random() < cfg.pwr && ai.inv.length > 0) {
        const hasP = t => ai.inv.includes(t);
        if (hasP('SHIELD') && ai.hp <= 2 && !ai.shield.on) { ai.inv.splice(ai.inv.indexOf('SHIELD'), 1); activatePower(ai, 'SHIELD'); }
        else if (hasP('FIRE') && dist <= 4) { ai.inv.splice(ai.inv.indexOf('FIRE'), 1); activatePower(ai, 'FIRE'); }
        else if (hasP('SPEED') && dist > 4 && a.st === 'HUNT') { ai.inv.splice(ai.inv.indexOf('SPEED'), 1); activatePower(ai, 'SPEED'); }
        else if (hasP('WALL') && dist <= 2 && ai.wallCharges > 0) { ai.inv.splice(ai.inv.indexOf('WALL'), 1); activatePower(ai, 'WALL'); }
    }

    // ── Stuck detection ──
    if (a.lp.x === ai.x && a.lp.y === ai.y) {
        a.skT += cfg.think;
        if (a.skT > 500) {
            const dirs = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
            ai.facing = dirs[ri(4)]; a.skT = 0;
            const nx = ai.x + ai.facing.dx, ny = ai.y + ai.facing.dy;
            if (inB(nx, ny) && !isW(nx, ny)) { ai.x = nx; ai.y = ny; }
        }
    } else a.skT = 0;
    a.lp = { x: ai.x, y: ai.y };
}
