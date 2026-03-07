// ================================================================
//  BATTLE GRID — multiplayer.js
//  Firebase Realtime Database — 1v1 online multiplayer
//
//  SETUP (one-time, ~5 mins):
//  1. Go to console.firebase.google.com → create a free project
//  2. Project Settings → Add Web App → copy the config below
//  3. Build → Realtime Database → Create database → Test mode
// ================================================================

// ── PASTE YOUR FIREBASE CONFIG HERE ──────────────────────────────
const FB_CONFIG = {
    apiKey: "AIzaSyCSksf4dXos51giODLA7zKgIpaE1hkMpmY",

    authDomain: "battle-grid-afdc1.firebaseapp.com",

    databaseURL: "https://battle-grid-afdc1-default-rtdb.asia-southeast1.firebasedatabase.app",

    projectId: "battle-grid-afdc1",

    storageBucket: "battle-grid-afdc1.firebasestorage.app",

    messagingSenderId: "955980716815",

    appId: "1:955980716815:web:adb0a5f849fc00bb3cfc7a",

    measurementId: "G-9WHGZ2EHEL"

};
// ─────────────────────────────────────────────────────────────────

// ── MP State (global, read by game.js) ──
const MP = {
    enabled: false,
    role: null,      // 'host' | 'guest'
    roomId: null,
    db: null,
    roomRef: null,
    syncT: 0,
    SYNC_MS: 50,        // write state every 50ms (20hz)
    _subs: [],        // listener cleanup functions
    _renderStarted: false,
    guestDx: 0,
    guestDy: 0
};

// ── Firebase init ──
function initFirebase() {
    if (typeof firebase === 'undefined') {
        alert('Firebase SDK not loaded.\nCheck your internet connection.'); return false;
    }
    const isPlaceholder = FB_CONFIG.apiKey === 'YOUR_API_KEY';
    if (isPlaceholder) {
        alert('⚠️  Please fill in your Firebase config in game/multiplayer.js\n\nGo to console.firebase.google.com → create a project → add a web app.');
        return false;
    }
    if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
    MP.db = firebase.database();
    return true;
}

// ── Room code: 4 uppercase letters (no ambiguous chars) ──
function genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ════════════════════════════════════════
//  HOST: Create Room
// ════════════════════════════════════════
async function createRoom() {
    if (!initFirebase()) return;
    const code = genCode();
    MP.role = 'host';
    MP.roomId = code;
    MP.roomRef = MP.db.ref('rooms/' + code);

    await MP.roomRef.set({
        state: 'waiting',
        created: Date.now(),
        p2Input: { dx: 0, dy: 0, shoot: false, knife: false, pwr: -1 }
    });
    // Auto-delete room when host disconnects
    MP.roomRef.onDisconnect().remove();

    mpUI('Room Code: <span id="mp-code-display">' + code + '</span><br><small>Share this with your friend!</small>', true);

    // Wait for guest to join (state → 'playing')
    const stateRef = MP.roomRef.child('state');
    stateRef.on('value', snap => {
        if (snap.val() === 'playing') {
            stateRef.off();
            _hostListenP2Input();
            startOnlineGame();
        }
    });
    MP._subs.push(() => stateRef.off());
}

// ════════════════════════════════════════
//  GUEST: Join Room
// ════════════════════════════════════════
async function joinRoom(code) {
    if (!initFirebase()) return;
    code = (code || '').toUpperCase().trim();
    if (code.length !== 4) { mpUI('Enter a 4-letter room code!'); return; }

    MP.role = 'guest';
    MP.roomId = code;
    MP.roomRef = MP.db.ref('rooms/' + code);
    MP.roomRef.child('state').onDisconnect().set('waiting');

    const snap = await MP.roomRef.once('value');
    if (!snap.exists()) { mpUI('Room not found. Check the code.'); return; }
    if (snap.val().state !== 'waiting') { mpUI('Room is full or game in progress.'); return; }

    await MP.roomRef.child('state').set('playing');
    mpUI('Joined! Game starting…');

    // Listen for host game state
    const gsRef = MP.roomRef.child('gameState');
    gsRef.on('value', snap => {
        if (!snap.val() || !MP.enabled) return;
        applyHostState(snap.val());
        render();
    });
    MP._subs.push(() => gsRef.off());

    MP.enabled = true;
    // _guestLoop starts from applyHostState once S is initialized
    hideMPOverlay();
}

// ════════════════════════════════════════
//  HOST: Listen for P2 input
// ════════════════════════════════════════
function _hostListenP2Input() {
    const inp = MP.roomRef.child('p2Input');
    inp.on('value', snap => {
        if (!snap.val() || !MP.enabled || !S.running) return;
        MP._latestP2Input = snap.val();
        // Power uses are handled immediately since they are one-off triggers
        const d = snap.val();
        const p2 = S.p2;
        if (d.pwr >= 0 && d.pwr < (p2.inv || []).length) {
            const pw = p2.inv.splice(d.pwr, 1)[0];
            activatePower(p2, pw);
            // reset powerslot to -1 in Firebase so it doesn't re-trigger
            MP.roomRef.child('p2Input/pwr').set(-1);
        }
    });
    MP._subs.push(() => inp.off());
}

// Called every frame from game.js update() loop
function applyRemoteP2Input() {
    if (!MP._latestP2Input || !MP.enabled || !S.running) return;
    const d = MP._latestP2Input;
    const p2 = S.p2;

    // Authoritative Guest Movement Tracking
    if (d.x !== undefined && d.y !== undefined) {
        // Did the guest claim to move to a new tile?
        if (p2.x !== d.x || p2.y !== d.y) {
            // Is it a valid tile? (Protect against cheating or extreme desyncs)
            if (inB(d.x, d.y) && !isW(d.x, d.y) && !(S.p1.alive && S.p1.x === d.x && S.p1.y === d.y)) {
                // Trigger smooth move animation on Host if it's a normal 1-step walk
                if (Math.abs(p2.x - d.x) <= 1 && Math.abs(p2.y - d.y) <= 1) {
                    p2.moveT = p2.speed.on ? MOVE_MS / 2.5 : MOVE_MS;
                }
                p2.x = d.x; p2.y = d.y;
            }
        }
    }

    // Explicit facing override (e.g. from Guest clicking the screen to shoot, or standard moving)
    if (d.fx !== undefined && d.fy !== undefined) {
        if (d.fx !== 0 || d.fy !== 0) {
            p2.facing = { dx: d.fx, dy: d.fy };
        }
    } else if (d.dx || d.dy) {
        p2.facing = { dx: d.dx || p2.facing.dx, dy: d.dy || p2.facing.dy };
    }

    // Throw stone (applies continuously while shoot is true)
    if (d.shoot && p2.alive && p2.atkCd <= 0) shoot(p2);
    // Knife (applies continuously while knife is true)
    if (d.knife && p2.alive && p2.knifeCd <= 0) _remoteKnife(p2, S.p1);
}


// ── Knife action for remote P2 (run on host) ──
function _remoteKnife(atk, def) {
    const cd = Math.max(Math.abs(atk.x - def.x), Math.abs(atk.y - def.y));
    atk.knifeCd = KNIFE_CD;
    const atkTc = tcx(atk.x, atk.y);
    S.knifeSlash = { x: atkTc.x, y: atkTc.y, t: 400, ml: 400, who: 'p2' };
    // Walls
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        if (!ox && !oy) continue;
        const wk = (atk.x + ox) + ',' + (atk.y + oy);
        if (inB(atk.x + ox, atk.y + oy) && S.walls.has(wk)) {
            const hp = S.walls.get(wk) - 1;
            const wt = tcx(atk.x + ox, atk.y + oy);
            if (hp <= 0) { S.walls.delete(wk); burst(wt.x, wt.y, '#aa8833', 12, 120); }
            else { S.walls.set(wk, hp); burst(wt.x, wt.y, '#8a6622', 5, 60); }
        }
    }
    if (cd <= 1 && def.alive) {
        const defTc = tcx(def.x, def.y);
        if (def.shield.on && def.shield.hits > 0) {
            def.shield.hits--;
            burst(defTc.x, defTc.y, '#00ff88', 12, 160);
            addPop(defTc.x, defTc.y - 20, 'BLOCKED!', '#00ff88'); snd('shield');
        } else {
            dmg(def, KNIFE_DMG); shk.m = 12; snd('hit');
            burst(defTc.x, defTc.y, '#ff8800', 18, 160);
            addPop(defTc.x, defTc.y - 20, '⚔️ -' + KNIFE_DMG, '#ff8800');
            if (!def.alive && def.inv.length > 0 && atk.inv.length < MAX_INV) {
                atk.inv.push(def.inv.pop());
                banner('FRIEND STOLE YOUR POWER!', 2000, '#ff00ff');
            }
        }
    }
}

// ════════════════════════════════════════
//  HOST: Write full game state to Firebase
// ════════════════════════════════════════
function syncHostState() {
    if (!MP.enabled || MP.role !== 'host' || !S.running) return;
    const wallsObj = {}, fireObj = {};
    S.walls.forEach((v, k) => wallsObj[k.replace(',', '_')] = v);
    S.fireTiles.forEach((v, k) => fireObj[k.replace(',', '_')] = v);

    const gs = {
        t: S.t, running: S.running,
        p1: _serP(S.p1), p2: _serP(S.p2),
        zone: S.zone, zT: S.zT, zdT: S.zdT,
        walls: wallsObj,
        powerDrops: S.powerDrops || [],
        fireTiles: fireObj,
        // Normalize by cell so guest can rescale to their own screen size
        proj: (S.proj || []).slice(0, 20).map(p => ({
            nx: p.x / cell, ny: p.y / cell,
            nvx: p.vx / cell, nvy: p.vy / cell,
            from: p.from, col: p.col, done: p.done || false
        })),
        part: (S.part || []).slice(-20),
        pops: S.pops || [],
        knifeSlash: S.knifeSlash || null
    };
    MP.roomRef.child('gameState').set(gs);
}

function _serP(p) {
    return {
        id: p.id, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, col: p.col,
        facing: p.facing, alive: p.alive, flash: p.flash, isAI: false,
        shield: { on: p.shield.on, hits: p.shield.hits }, speed: { on: p.speed.on },
        inv: p.inv || [], wallCharges: p.wallCharges || 0,
        atkCd: p.atkCd, knifeCd: p.knifeCd, moveT: p.moveT
    };
}

// ════════════════════════════════════════
//  GUEST: Apply host state to local S
// ════════════════════════════════════════
function applyHostState(d) {
    if (!d) return;
    // ── Init S if guest hasn't run startGame() yet ──
    // S.p1 is undefined until startGame() runs, but guests never call it.
    if (!S || !S.p1) {
        S = {
            running: false, t: 0,
            walls: new Map(),
            terrain: Array.from({ length: G }, () => Array.from({ length: G }, () => Math.random())),
            zone: { x1: 0, y1: 0, x2: G - 1, y2: G - 1 }, zT: 9000, zdT: 2500,
            p1: { x: 1, y: 1, hp: 5, maxHp: 5, col: '#00d4ff', facing: { dx: 1, dy: 0 }, alive: true, isAI: false, shield: { on: false, hits: 0 }, speed: { on: false }, inv: [], flash: 0, atkCd: 0, knifeCd: 0, moveT: 0 },
            p2: { x: 8, y: 8, hp: 5, maxHp: 5, col: '#ff4500', facing: { dx: -1, dy: 0 }, alive: true, isAI: false, shield: { on: false, hits: 0 }, speed: { on: false }, inv: [], flash: 0, atkCd: 0, knifeCd: 0, moveT: 0 },
            proj: [], part: [], pops: [], fireTiles: new Map(), powerDrops: [], pwrSpawnT: 3000, knifeSlash: null,
            ai: { st: 'HUNT', tT: 0, skT: 0, lp: { x: -1, y: -1 } }, ts: performance.now()
        };
        resize();
        // Hide overlay now that we have state
        document.getElementById('overlay').style.display = 'none';
    }
    // Start render loop and input poller now that S.terrain is ready (only once)
    if (!MP._renderStarted) {
        MP._renderStarted = true;
        _guestLoop();
    }

    S.running = d.running;
    S.t = d.t;
    if (d.p1) Object.assign(S.p1, d.p1);
    if (d.p2) {
        if (MP.role === 'guest') {
            // Client-side prediction: Protect our local movement from being overwritten by delayed host data
            const dist = Math.abs(S.p2.x - d.p2.x) + Math.abs(S.p2.y - d.p2.y);
            let { x, y, facing, moveT } = S.p2;
            if (dist > 2) {
                // Snap back if we are wildly out of sync from the host
                x = d.p2.x; y = d.p2.y;
            }
            Object.assign(S.p2, d.p2);
            // Restore locally simulated smooth movement values
            S.p2.x = x; S.p2.y = y; S.p2.facing = facing; S.p2.moveT = moveT;
        } else {
            Object.assign(S.p2, d.p2);
        }
    }
    S.zone = d.zone || S.zone;
    S.zT = d.zT;
    S.zdT = d.zdT;
    S.walls = new Map(Object.entries(d.walls || {}).map(([k, v]) => [k.replace('_', ','), v]));
    S.fireTiles = new Map(Object.entries(d.fireTiles || {}).map(([k, v]) => [k.replace('_', ','), v]));
    S.powerDrops = d.powerDrops || [];
    // Restore projectiles — de-normalize from cell-space to pixel-space for this device
    S.proj = (d.proj || []).map(p => ({
        x: p.nx * cell, y: p.ny * cell,
        vx: p.nvx * cell, vy: p.nvy * cell,
        from: p.from, col: p.col, trail: [], done: p.done || false
    }));
    S.part = (d.part || []).filter(p => p && p.life > 0);

    S.pops = d.pops || [];
    S.knifeSlash = d.knifeSlash || null;
    if (!S.terrain) S.terrain = Array.from({ length: G }, () => Array.from({ length: G }, () => Math.random()));
    if (!S.running && d.running === false) {
        if (!S.p1.alive && !S.p2.alive) showEnd('DRAW', 'Both fell!', '#888');
        else if (!S.p2.alive) showEnd('VICTORY!', 'You beat your friend!', '#00ff88');
        else showEnd('DEFEAT', 'Your friend wins!', '#ff4500');
    }
    updateHUD();
}


// ════════════════════════════════════════
//  GUEST: Send inputs to Firebase
// ════════════════════════════════════════
function mpGuestInput(dt) {
    // Movement from joystick
    let dx = 0, dy = 0;
    if (JOY.active && JOY.dist >= JOY_THRESHOLD) {
        const angle = Math.atan2(JOY.dy, JOY.dx);
        const deg = angle * 180 / Math.PI;
        if (deg >= -45 && deg < 45) dx = 1;
        else if (deg >= 45 && deg < 135) dy = 1;
        else if (deg >= 135 || deg < -135) dx = -1;
        else dy = -1;
    }
    if (K['KeyW']) dy = -1; else if (K['KeyS']) dy = 1;
    if (K['KeyA']) dx = -1; else if (K['KeyD']) dx = 1;
    MP.guestDx = dx; MP.guestDy = dy;

    // Mouse shooting integration
    let clickShoot = false;
    if (MP._guestMouseShoot) {
        clickShoot = true;
    } else {
        MP.guestMouseFace = null;
    }

    // Write to Firebase at sync rate
    if (isNaN(MP.syncT)) MP.syncT = 0;
    MP.syncT -= dt;
    // Force sync if input is active to make sure movements send immediately
    const hasInput = (dx !== 0 || dy !== 0 || TC.atk || TC.knife || clickShoot);
    if (MP.syncT <= 0 || (hasInput && MP.syncT > MP.SYNC_MS / 2)) {
        MP.syncT = MP.SYNC_MS;
        const msg = {
            dx: dx, dy: dy,
            x: S.p2.x, y: S.p2.y,
            fx: MP.guestMouseFace ? MP.guestMouseFace.dx : 0,
            fy: MP.guestMouseFace ? MP.guestMouseFace.dy : 0,
            shoot: !!(TC.atk || clickShoot),
            knife: !!(TC.knife),
            pwr: -1
        };
        MP.roomRef.child('p2Input').set(msg);
    }
}

// Guest power use — write slot index to Firebase
function guestUsePwr(slot) {
    if (!MP.enabled || MP.role !== 'guest') return;
    MP.roomRef.child('p2Input/pwr').set(slot);
}

// ════════════════════════════════════════
//  GUEST: Render loop (joystick visual + input)
// ════════════════════════════════════════
function _guestLoop() {
    if (!MP.enabled || MP.role !== 'guest') return;
    // Compute dt for input sync and local physics
    const now = performance.now();
    const dt = Math.min(now - (MP._guestLastT || now), 50);
    MP._guestLastT = now;

    // Simulate player movement locally AND send to host via mpGuestInput
    if (S && S.running && typeof playerInput === 'function') playerInput(dt);

    // Update projectiles & particles locally so they glide smoothly
    if (S && S.running && typeof updProj === 'function') {
        updProj(dt);
        S.part = S.part.filter(p => { p.life -= dt; p.x += p.vx * (dt / 1000); p.y += p.vy * (dt / 1000); p.vy += 160 * (dt / 1000); return p.life > 0; });
        S.pops = S.pops.filter(p => { p.life -= dt; return p.life > 0; });
    }

    render();           // Renders state
    requestAnimationFrame(_guestLoop);
}


// ════════════════════════════════════════
//  Start online game (host only)
// ════════════════════════════════════════
function startOnlineGame() {
    // Update HUD label
    document.querySelector('.pname.p2c').textContent = 'FRIEND';
    MP.enabled = true;
    hideMPOverlay();
    startGame();
}

// ════════════════════════════════════════
//  Clean up
// ════════════════════════════════════════
function leaveRoom() {
    MP.enabled = false; MP.role = null; MP.roomId = null;
    MP._subs.forEach(f => { try { f(); } catch (e) { } }); MP._subs = [];
    if (MP.roomRef) { if (MP.role === 'host') MP.roomRef.remove(); MP.roomRef = null; }
}

// ════════════════════════════════════════
//  UI helpers
// ════════════════════════════════════════
function mpUI(html, waiting) {
    document.getElementById('mp-status').innerHTML = html;
    document.getElementById('mp-join-form').style.display = waiting ? 'none' : 'flex';
}

function showMPPanel() {
    document.getElementById('mp-panel').style.display = 'flex';
    document.getElementById('mp-status').innerHTML = 'Create a room or join a friend\'s room:';
}

function hideMPOverlay() {
    document.getElementById('mp-panel').style.display = 'none';
    document.getElementById('overlay').style.display = 'none';
    // Release keyboard focus from the room code input so WASD works
    const inp = document.getElementById('mp-codeinput');
    if (inp) inp.blur();
    document.body.focus();
    // For guest: show "waiting for host" placeholder if no state yet
    if (MP.role === 'guest') {
        // build a minimal S so render() doesn't crash
        S = {
            running: false, t: 0,
            walls: new Map(), terrain: Array.from({ length: G }, () => Array.from({ length: G }, () => Math.random())),
            zone: { x1: 0, y1: 0, x2: G - 1, y2: G - 1 }, zT: 9000, zdT: 2500,
            p1: { x: 1, y: 1, hp: 5, maxHp: 5, col: '#00d4ff', facing: { dx: 1, dy: 0 }, alive: true, isAI: false, shield: { on: false, hits: 0 }, speed: { on: false }, inv: [], flash: 0, atkCd: 0, knifeCd: 0, moveT: 0 },
            p2: { x: 8, y: 8, hp: 5, maxHp: 5, col: '#ff4500', facing: { dx: -1, dy: 0 }, alive: true, isAI: false, shield: { on: false, hits: 0 }, speed: { on: false }, inv: [], flash: 0, atkCd: 0, knifeCd: 0, moveT: 0 },
            proj: [], part: [], pops: [], fireTiles: new Map(), powerDrops: [], pwrSpawnT: 3000, knifeSlash: null,
            ai: { st: 'HUNT', tT: 0, skT: 0, lp: { x: -1, y: -1 } }, ts: performance.now()
        };
        resize();
    }
}

function joinMPFromUI() {
    const code = document.getElementById('mp-codeinput').value;
    joinRoom(code);
}
