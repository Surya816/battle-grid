// ================================================================
//  BATTLE GRID — render.js  (Top-Down Polished Edition)
//  Clean top-down bird's-eye view with cute chibi avatars
// ================================================================

function render() {
    cx.clearRect(0, 0, cv.width, cv.height);
    cx.save(); cx.translate(shk.x, shk.y);
    drawBg();
    drawZone();
    drawFire();
    drawPowerDrops();
    drawWalls();
    drawSightLine();
    drawPlayers();
    drawKnifeSlash();   // 360° slash ring above players
    drawProj();
    drawPart();
    drawPops();
    drawVig();
    cx.restore();
    drawJoystick(); // drawn AFTER restore so it's not affected by camera shake
}

// ── 360° KNIFE SLASH RING ──
function drawKnifeSlash() {
    if (!S.knifeSlash) return;
    const ks = S.knifeSlash;
    const prog = 1 - (ks.t / ks.ml);          // 0 → 1 as animation plays
    const alpha = Math.max(0, 1 - prog * 1.2); // fade out
    const radius = cell * (0.4 + prog * 0.9);  // expands outward
    const col = ks.who === 'p1' ? '#00d4ff' : '#ff8800';

    // Outer expanding ring
    cx.globalAlpha = alpha * 0.7;
    cx.strokeStyle = col;
    cx.lineWidth = Math.max(1, cell * 0.12 * (1 - prog));
    cx.beginPath();
    cx.arc(ks.x, ks.y, radius, 0, Math.PI * 2);
    cx.stroke();

    // Inner bright ring (smaller, faster)
    const innerR = cell * (0.3 + prog * 0.55);
    cx.globalAlpha = alpha * 0.5;
    cx.strokeStyle = '#ffffff';
    cx.lineWidth = Math.max(0.5, cell * 0.06 * (1 - prog));
    cx.beginPath();
    cx.arc(ks.x, ks.y, innerR, 0, Math.PI * 2);
    cx.stroke();

    // Spinning slash arcs (4 arcs rotating)
    cx.globalAlpha = alpha * 0.85;
    cx.strokeStyle = col;
    cx.lineWidth = Math.max(1.5, cell * 0.08);
    const rotation = prog * Math.PI * 3; // spins during animation
    for (let i = 0; i < 4; i++) {
        const startAngle = rotation + i * (Math.PI / 2);
        cx.beginPath();
        cx.arc(ks.x, ks.y, radius * 0.65, startAngle, startAngle + Math.PI * 0.45);
        cx.stroke();
    }

    cx.globalAlpha = 1;
}

// ── VIRTUAL JOYSTICK VISUAL ──
// Drawn as a canvas overlay so it looks clean on any background
function drawJoystick() {
    if (!JOY.active) return;

    // Position: use jzone element rect mapped to canvas coordinates
    const jEl = document.getElementById('jzone');
    const jRect = jEl.getBoundingClientRect();
    const cRect = cv.getBoundingClientRect();

    // Map joystick origin into canvas pixel space
    const scaleX = cv.width / cRect.width;
    const scaleY = cv.height / cRect.height;
    const jOnCvX = (jRect.left + JOY.ox - cRect.left) * scaleX;
    const jOnCvY = (jRect.top + JOY.oy - cRect.top) * scaleY;

    // Clamp thumb to JOY_MAX radius
    const clampedDist = Math.min(JOY.dist, JOY_MAX);
    const angle = JOY.dist > 0 ? Math.atan2(JOY.dy, JOY.dx) : 0;
    const thumbX = jOnCvX + Math.cos(angle) * clampedDist * scaleX;
    const thumbY = jOnCvY + Math.sin(angle) * clampedDist * scaleY;
    const baseR = JOY_MAX * scaleX;

    // Outer ring
    cx.beginPath(); cx.arc(jOnCvX, jOnCvY, baseR, 0, Math.PI * 2);
    cx.strokeStyle = 'rgba(255,255,255,0.15)'; cx.lineWidth = 2; cx.stroke();
    cx.fillStyle = 'rgba(255,255,255,0.04)'; cx.fill();

    // Direction indicator line
    if (JOY.dist >= JOY_THRESHOLD) {
        cx.beginPath(); cx.moveTo(jOnCvX, jOnCvY); cx.lineTo(thumbX, thumbY);
        cx.strokeStyle = 'rgba(0,212,255,0.4)'; cx.lineWidth = 2; cx.stroke();
    }

    // Thumb dot
    const thumbR = baseR * 0.38;
    const thumbGr = cx.createRadialGradient(thumbX - thumbR * .25, thumbY - thumbR * .25, 1, thumbX, thumbY, thumbR);
    thumbGr.addColorStop(0, 'rgba(0,212,255,0.9)');
    thumbGr.addColorStop(1, 'rgba(0,100,180,0.5)');
    cx.beginPath(); cx.arc(thumbX, thumbY, thumbR, 0, Math.PI * 2);
    cx.fillStyle = thumbGr; cx.fill();
    cx.strokeStyle = 'rgba(0,212,255,0.5)'; cx.lineWidth = 1.5; cx.stroke();
}


// ── TERRAIN ──
function drawBg() {
    const t = S.terrain;
    for (let y = 0; y < G; y++) {
        for (let x = 0; x < G; x++) {
            const v = t[y][x];
            // Rich earthy/dark terrain colors
            const r = Math.floor(12 + v * 16), g = Math.floor(18 + v * 20), b = Math.floor(10 + v * 12);
            cx.fillStyle = `rgb(${r},${g},${b})`;
            cx.fillRect(x * cell, y * cell, cell, cell);
            // Subtle grid lines
            cx.strokeStyle = 'rgba(255,255,255,0.035)'; cx.lineWidth = 0.6;
            cx.strokeRect(x * cell, y * cell, cell, cell);
            // Tiny terrain detail dots
            if (v > 0.75) {
                cx.fillStyle = `rgba(255,255,255,0.04)`;
                cx.beginPath(); cx.arc(x * cell + cell * .3, y * cell + cell * .4, 1.5, 0, Math.PI * 2); cx.fill();
                cx.beginPath(); cx.arc(x * cell + cell * .7, y * cell + cell * .65, 1, 0, Math.PI * 2); cx.fill();
            }
        }
    }
}

// ── ZONE ──
function drawZone() {
    const z = S.zone;
    const p = 0.5 + 0.5 * Math.sin(Date.now() / 175);
    // Storm overlay on out-of-zone tiles
    cx.fillStyle = 'rgba(190,8,8,0.26)';
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++)
        if (x < z.x1 || x > z.x2 || y < z.y1 || y > z.y2)
            cx.fillRect(x * cell, y * cell, cell, cell);
    // Storm border
    cx.shadowColor = '#ff2222'; cx.shadowBlur = 14 * p;
    cx.strokeStyle = `rgba(255,55,55,${.55 + .35 * p})`; cx.lineWidth = 3;
    cx.strokeRect(z.x1 * cell, z.y1 * cell, (z.x2 - z.x1 + 1) * cell, (z.y2 - z.y1 + 1) * cell);
    cx.shadowBlur = 0;
    document.getElementById('zone-timer').textContent = Math.ceil(S.zT / 1000) + 's';
}

// ── FIRE TILES ──
function drawFire() {
    const now = Date.now();
    S.fireTiles.forEach((ttl, k) => {
        const [x, y] = k.split(',').map(Number), px = x * cell, py = y * cell;
        const f = .5 + .3 * Math.sin(now / 100 + x * 3);
        cx.fillStyle = `rgba(255,${Math.floor(60 + 40 * f)},0,${.28 + .14 * f})`;
        cx.fillRect(px, py, cell, cell);
        // Flame shape
        cx.fillStyle = `rgba(255,${Math.floor(120 + 80 * f)},20,${.4 * f})`;
        cx.beginPath();
        cx.moveTo(px + cell * .3, py + cell); cx.lineTo(px + cell * .5, py + cell * .25); cx.lineTo(px + cell * .7, py + cell);
        cx.fill();
    });
}

// ── POWER DROPS ──
function drawPowerDrops() {
    const now = Date.now();
    S.powerDrops.forEach(d => {
        const px = d.x * cell, py = d.y * cell, cx2 = px + cell / 2, cy2 = py + cell / 2;
        const pw = PWR[d.type];
        const pulse = .5 + .5 * Math.sin(now / 200);
        const bob = Math.sin(now / 350) * 2; // bobbing offset

        // Glowing tile background
        cx.fillStyle = pw.col + Math.floor(18 + 14 * pulse).toString(16);
        cx.fillRect(px + 2, py + 2, cell - 4, cell - 4);

        // Outer ring
        cx.shadowColor = pw.col; cx.shadowBlur = 14 * pulse;
        cx.strokeStyle = pw.col; cx.lineWidth = 2;
        cx.beginPath(); cx.arc(cx2, cy2 + bob, cell * .36, 0, Math.PI * 2); cx.stroke();
        cx.shadowBlur = 0;

        // Inner orb
        const gr = cx.createRadialGradient(cx2 - 2, cy2 + bob - 2, 1, cx2, cy2 + bob, cell * .26);
        gr.addColorStop(0, '#ffffff');
        gr.addColorStop(0.4, pw.col + 'ee');
        gr.addColorStop(1, pw.col + '44');
        cx.fillStyle = gr;
        cx.beginPath(); cx.arc(cx2, cy2 + bob, cell * .26, 0, Math.PI * 2); cx.fill();

        // Emoji icon
        cx.font = `${Math.floor(cell * .42)}px sans-serif`;
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(pw.icon, cx2, cy2 + bob);
    });
}

// ── WALLS ──
function drawWalls() {
    S.walls.forEach((hp, k) => {
        const [wx, wy] = k.split(',').map(Number), px = wx * cell, py = wy * cell;
        const df = (3 - hp) / 3;
        // Main block
        cx.fillStyle = `rgb(${Math.floor(48 - df * 18)},${Math.floor(38 - df * 12)},${Math.floor(24 - df * 8)})`;
        cx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
        // Top highlight
        cx.fillStyle = `rgba(255,255,220,${.12 - df * .06})`;
        cx.fillRect(px + 1, py + 1, cell - 2, Math.max(3, cell * .12));
        // Left highlight
        cx.fillStyle = `rgba(255,255,200,${.06 - df * .03})`;
        cx.fillRect(px + 1, py + 1, Math.max(2, cell * .08), cell - 2);
        // Bottom shadow
        cx.fillStyle = 'rgba(0,0,0,0.3)';
        cx.fillRect(px + 1, py + cell - Math.max(3, cell * .12), cell - 2, Math.max(3, cell * .12));
        // Cracks on damage
        if (hp < 3) {
            cx.strokeStyle = `rgba(0,0,0,${0.4 + df * 0.2})`; cx.lineWidth = 1;
            cx.beginPath();
            cx.moveTo(px + cell * .25, py + cell * .15); cx.lineTo(px + cell * .6, py + cell * .55);
            cx.stroke();
            if (hp < 2) {
                cx.beginPath();
                cx.moveTo(px + cell * .6, py + cell * .3); cx.lineTo(px + cell * .3, py + cell * .75);
                cx.stroke();
            }
        }
    });
}

// ── SIGHT LINE ──
function drawSightLine() {
    [S.p1, S.p2].forEach(p => {
        if (!p.alive || p.atkCd > 0) return;
        const sx = p.x * cell + cell / 2, sy = p.y * cell + cell / 2;
        const pulse = .07 + .05 * Math.sin(Date.now() / 120);
        cx.strokeStyle = p.col + Math.floor(pulse * 255).toString(16).padStart(2, '0');
        cx.lineWidth = 1.5; cx.setLineDash([3, 6]);
        cx.beginPath(); cx.moveTo(sx, sy);
        cx.lineTo(sx + p.facing.dx * cv.width, sy + p.facing.dy * cv.height);
        cx.stroke(); cx.setLineDash([]);
    });
}

// ── PLAYERS (Cute chibi top-down view) ──
function drawPlayers() {
    [S.p1, S.p2].forEach(p => { if (p.alive) drawPlayerAt(p); });
}

function drawPlayerAt(p) {
    const cx2 = p.x * cell + cell / 2, cy2 = p.y * cell + cell / 2;
    const r = cell * .38; // radius
    const now = Date.now();

    // Shadow
    cx.fillStyle = 'rgba(0,0,0,0.22)';
    cx.beginPath(); cx.ellipse(cx2 + 2, cy2 + 3, r * .85, r * .65, 0, 0, Math.PI * 2); cx.fill();

    // Hit flash overlay
    if (p.flash > 0) {
        cx.fillStyle = `rgba(255,255,255,${(p.flash / 400) * .55})`;
        cx.fillRect(p.x * cell, p.y * cell, cell, cell);
    }

    // Shield glow
    if (p.shield.on) {
        const sp = .5 + .5 * Math.sin(now / 140);
        cx.shadowColor = '#00ff88'; cx.shadowBlur = 18 * sp;
        cx.strokeStyle = `rgba(0,255,136,${.35 + .25 * sp})`; cx.lineWidth = 3;
        cx.beginPath(); cx.arc(cx2, cy2, r + 7, 0, Math.PI * 2); cx.stroke();
        cx.shadowBlur = 0;
    }

    // Speed lines
    if (p.speed.on) {
        const angle = Math.atan2(p.facing.dy, p.facing.dx) + Math.PI;
        for (let i = -1; i <= 1; i++) {
            const a = angle + i * .3, len = cell * .5 + Math.sin(now / 60 + i) * cell * .15;
            cx.strokeStyle = `rgba(255,220,0,${.3 + i * .05})`; cx.lineWidth = 1.5;
            cx.beginPath();
            cx.moveTo(cx2 + Math.cos(a) * r, cy2 + Math.sin(a) * r);
            cx.lineTo(cx2 + Math.cos(a) * (r + len), cy2 + Math.sin(a) * (r + len));
            cx.stroke();
        }
    }

    // ── Main body (top-down circle with shading) ──
    cx.shadowColor = p.col; cx.shadowBlur = 14;
    const bodyGr = cx.createRadialGradient(cx2 - r * .25, cy2 - r * .2, r * .1, cx2, cy2, r);
    bodyGr.addColorStop(0, p.col + 'ff');
    bodyGr.addColorStop(0.6, p.col + 'cc');
    bodyGr.addColorStop(1, p.col + '66');
    cx.fillStyle = bodyGr;
    cx.beginPath(); cx.arc(cx2, cy2, r, 0, Math.PI * 2); cx.fill();
    cx.shadowBlur = 0;

    // Rim / outline
    cx.strokeStyle = p.col + '88'; cx.lineWidth = 1.5;
    cx.beginPath(); cx.arc(cx2, cy2, r, 0, Math.PI * 2); cx.stroke();

    // ── Top-down headband / cap ──
    const bandAngle = Math.atan2(p.facing.dy, p.facing.dx);
    cx.fillStyle = p.isAI ? 'rgba(180,0,0,0.7)' : 'rgba(0,50,80,0.7)';
    cx.beginPath();
    cx.ellipse(cx2 + p.facing.dx * r * .3, cy2 + p.facing.dy * r * .3, r * .8, r * .35, bandAngle, 0, Math.PI * 2);
    cx.fill();

    // ── Eyes (top-down, looking in facing direction) ──
    const eyeOff = r * .32;
    const perpX = -p.facing.dy, perpY = p.facing.dx; // perpendicular to facing
    const eyeDist = r * .32;
    // left eye
    const lEx = cx2 + p.facing.dx * eyeOff - perpX * eyeDist;
    const lEy = cy2 + p.facing.dy * eyeOff - perpY * eyeDist;
    // right eye
    const rEx = cx2 + p.facing.dx * eyeOff + perpX * eyeDist;
    const rEy = cy2 + p.facing.dy * eyeOff + perpY * eyeDist;

    const eyeR = r * .19;
    // White of eye
    cx.fillStyle = p.isAI ? '#ff2200' : '#ffffff';
    if (p.isAI) { cx.shadowColor = '#ff0000'; cx.shadowBlur = 6; }
    cx.beginPath(); cx.arc(lEx, lEy, eyeR, 0, Math.PI * 2); cx.fill();
    cx.beginPath(); cx.arc(rEx, rEy, eyeR, 0, Math.PI * 2); cx.fill();
    cx.shadowBlur = 0;
    // Pupil
    cx.fillStyle = p.isAI ? '#660000' : '#111';
    cx.beginPath(); cx.arc(lEx + p.facing.dx * eyeR * .25, lEy + p.facing.dy * eyeR * .25, eyeR * .55, 0, Math.PI * 2); cx.fill();
    cx.beginPath(); cx.arc(rEx + p.facing.dx * eyeR * .25, rEy + p.facing.dy * eyeR * .25, eyeR * .55, 0, Math.PI * 2); cx.fill();
    // Eye shine
    cx.fillStyle = 'rgba(255,255,255,0.7)';
    cx.beginPath(); cx.arc(lEx - eyeR * .2, lEy - eyeR * .2, eyeR * .22, 0, Math.PI * 2); cx.fill();
    cx.beginPath(); cx.arc(rEx - eyeR * .2, rEy - eyeR * .2, eyeR * .22, 0, Math.PI * 2); cx.fill();

    // ── HP dots along bottom edge ──
    for (let i = 0; i < p.maxHp; i++) {
        const a = Math.PI * .55 + i * (Math.PI * .45 / (p.maxHp - 1 || 1));
        const hx = cx2 + Math.cos(a + Math.PI * .1) * r * .82, hy = cy2 + Math.sin(a + Math.PI * .1) * r * .82;
        cx.fillStyle = i < p.hp ? '#fff' : 'rgba(255,255,255,0.15)';
        cx.beginPath(); cx.arc(hx, hy, r * .1, 0, Math.PI * 2); cx.fill();
    }

    // ── Label ──
    cx.fillStyle = 'rgba(0,0,0,0.75)';
    cx.font = `bold ${Math.max(8, Math.floor(cell * .24))}px sans-serif`;
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(p.isAI ? 'AI' : 'P1', cx2, cy2 + r * .22);
}

// ── PROJECTILE (Stone, top-down) ──
function drawProj() {
    S.proj.forEach(pr => {
        // Trail
        pr.trail.forEach((t, i) => {
            const a = 1 - (i / pr.trail.length);
            cx.globalAlpha = a * .4; cx.fillStyle = '#8a7a6a';
            cx.beginPath(); cx.arc(t.x, t.y, Math.max(1, 3 - i * .4), 0, Math.PI * 2); cx.fill();
        }); cx.globalAlpha = 1;
        // Stone
        const sr = Math.floor(cell * .1);
        cx.fillStyle = '#9a8a7a';
        cx.beginPath(); cx.arc(pr.x, pr.y, sr, 0, Math.PI * 2); cx.fill();
        cx.fillStyle = '#c0b09a';
        cx.beginPath(); cx.arc(pr.x - sr * .3, pr.y - sr * .3, sr * .4, 0, Math.PI * 2); cx.fill();
    });
}

// ── PARTICLES ──
function drawPart() {
    S.part.forEach(p => {
        const a = p.life / p.ml; cx.globalAlpha = a * .85; cx.fillStyle = p.col;
        cx.beginPath(); cx.arc(p.x, p.y, Math.max(.5, p.sz * a), 0, Math.PI * 2); cx.fill();
    }); cx.globalAlpha = 1;
}

// ── FLOATING TEXT ──
function drawPops() {
    S.pops.forEach(p => {
        const a = p.life / p.ml; cx.globalAlpha = a; cx.fillStyle = p.c;
        cx.font = 'bold 12px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(p.t, p.x, p.y - (1 - a) * 26);
    }); cx.globalAlpha = 1;
}

// ── VIGNETTE ──
function drawVig() {
    const gr = cx.createRadialGradient(cv.width / 2, cv.height / 2, cv.width * .3, cv.width / 2, cv.height / 2, cv.width * .78);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.48)');
    cx.fillStyle = gr; cx.fillRect(0, 0, cv.width, cv.height);
}
