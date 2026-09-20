'use strict';
// ─── STATE ────────────────────────────────────────────────
const socket = io({
    reconnectionAttempts: 10,
});
let myIndex    = -1;
let myRoomId   = null;
let isHost     = false;
let myName     = 'Player';
let gameState  = null;
let pendingTile = null;
let roundReadyCount = 0; // track how many players clicked next round
let myHandOrder = []; // track custom sorted order of hand
let sortableInstance = null; // keep SortableJS instance
let isDragging = false;     // prevent click-fire during drag

// ─── DOM HELPERS ──────────────────────────────────────────
const $ = id => document.getElementById(id);
const COLORS = ['c0','c1','c2','c3'];
function showEl(id)  { const e = $(id); if(e) e.classList.remove('hidden'); }
function hideEl(id)  { const e = $(id); if(e) e.classList.add('hidden'); }
function setInner(id, v) { const e = $(id); if(e) e.innerHTML = v; }
function setText(id, v)  { const e = $(id); if(e) e.textContent = v; }

// Show lobby sub-sections
function showMenu(name) {
    ['menu-main','menu-create','menu-join','menu-waiting'].forEach(m =>
        $(m).classList.toggle('hidden', m !== name)
    );
}

function initials(name) {
    return (name||'?').trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2)||'?';
}

// ─── SCREENS ─────────────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
}
function showOverlay(id) { const e = $(id); if(e) e.classList.remove('hidden'); }
function hideOverlay(id) { const e = $(id); if(e) e.classList.add('hidden'); }

// ─── LOBBY WIRING ─────────────────────────────────────────
$('btn-quickplay').onclick = () => {
    myName = $('my-name-input').value.trim() || 'Player';
    setText('btn-quickplay', '⏳ Mencari lawan...');
    $('btn-quickplay').disabled = true;
    socket.emit('findPublicMatch', { name: myName });
};
$('btn-create').onclick = () => showMenu('menu-create');
$('btn-join').onclick   = () => showMenu('menu-join');
$('btn-create-back').onclick = () => { showMenu('menu-main'); resetQuickplayBtn(); };
$('btn-join-back').onclick   = () => { showMenu('menu-main'); resetQuickplayBtn(); };

function resetQuickplayBtn() {
    const btn = $('btn-quickplay');
    btn.textContent = '🚀 Main Cepat';
    btn.disabled = false;
}

$('btn-create-confirm').onclick = () => {
    myName = $('my-name-input').value.trim() || 'Player';
    socket.emit('createRoom', { name: myName });
};
$('btn-join-confirm').onclick = () => {
    myName = $('my-name-input').value.trim() || 'Player';
    const code = $('join-code').value.replace(/\s+/g, '').toUpperCase();
    if (code.length < 5) return showError('Masukkan kode yang valid (min 5 karakter)');
    socket.emit('joinRoom', { roomId: code, name: myName });
};
$('btn-start-game').onclick = () => socket.emit('startGame', myRoomId);

// ─── SOCKET EVENTS ────────────────────────────────────────
socket.on('roomJoined', data => {
    myRoomId = data.roomId;
    myIndex  = data.playerIndex;
    isHost   = data.isHost;
    resetQuickplayBtn();
    setText('room-code-display', data.roomId);
    setText('room-type-label', data.isPublic ? '🌍 Publik' : '🔒 Privat');
    showMenu('menu-waiting');
    if (isHost) { showEl('host-controls'); hideEl('guest-hint'); }
    else        { hideEl('host-controls'); showEl('guest-hint'); }
    showScreen('lobby-screen');
});

socket.on('updateLobby', players => {
    const list = $('player-list');
    list.innerHTML = '';
    players.forEach((p) => {
        const li = document.createElement('li');
        const isMe = p.index === myIndex;
        li.innerHTML = `<span class="pl-dot ${COLORS[p.index]}"></span>
            <span>${p.name}</span>
            ${isMe ? '<span class="pl-you">KAMU</span>' : ''}`;
        list.appendChild(li);
    });
    const countEl = $('player-list-count');
    if (countEl) setText('player-list-count', `${players.length}/4`);
    
    // Voice chat auto-connect if mic is on
    if (typeof micEnabled !== 'undefined' && micEnabled) {
        players.forEach(p => {
            if (p.id !== socket.id && !peerConnections[p.id]) initiateCall(p.id);
        });
    }
});

socket.on('error', msg => { resetQuickplayBtn(); showError(msg); });

socket.on('playerLeft', data => {
    showToast(`⚠️ ${data.name} meninggalkan game`);
});

// ─── CONNECTION STATUS ────────────────────────────────────
function setConnStatus(ok) {
    const el = $('conn-status');
    if (!el) return;
    if (ok) {
        el.textContent = '🟢 Terhubung ke server';
        el.className   = 'conn-status connected';
    } else {
        el.textContent = '🔴 Server offline — jalankan: node server.js';
        el.className   = 'conn-status disconnected';
    }
}
socket.on('connect',       () => setConnStatus(true));
socket.on('disconnect',    () => setConnStatus(false));
socket.on('connect_error', () => setConnStatus(false));

socket.on('roundStarted', state => {
    gameState = state;
    pendingTile = null;
    hideOverlay('round-overlay');
    hideOverlay('gameover-overlay');
    hideOverlay('side-overlay');
    showScreen('game-screen');
    renderGame(state);
    showToast(`🎲 Ronde ${state.round} dimulai!`);
});

socket.on('gameStateUpdate', state => {
    gameState = state;
    if (state.turn !== myIndex) {
        pendingTile = null;
        hideOverlay('side-overlay');
    }
    renderGame(state);
});

socket.on('timerTick', ({ turn, turnTime }) => {
    if (!gameState) return;
    gameState.turn = turn;
    gameState.turnTime = turnTime;
    updateTimer(turn, turnTime);
});

socket.on('roundEnd', data => {
    if (gameState) gameState.status = data.status;
    renderRoundEnd(data);
    showOverlay('round-overlay');
});

// ─── TOAST NOTIFICATIONS ─────────────────────────────────
function showToast(msg, duration = 2500) {
    let toast = $('toast-msg');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-msg';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ─── GAME RENDER ──────────────────────────────────────────
function renderGame(gs) {
    if (!gs) return;
    renderScoreBar(gs);
    renderOpponents(gs);
    renderBoard(gs);
    renderMyHand(gs);
    renderActions(gs);
    updateTimer(gs.turn, gs.turnTime);
    setText('boneyard-info', `📦 ${gs.boneyard}`);
    setText('round-label', `Ronde ${gs.round}`);
    if (gs.status === 'game-end') {
        renderGameEnd(gs);
        showOverlay('gameover-overlay');
    }
}

// ── Score Bar ──
function renderScoreBar(gs) {
    const scores = gs.scores;
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    let html = '';
    for (let i = 0; i < 4; i++) {
        const p = gs.players.find(p => p.index === i) || { name: `AI ${i+1}`, index: i };
        const isT  = i === gs.turn;
        const isLo = scores[i] === min;
        const isHi = scores[i] === max && max > 0;
        const allSame = scores.every(s => s === min);
        const ptsClass = isLo && !allSame ? 'low' : isHi ? 'high' : '';
        html += `<div class="s-chip ${isT?'is-turn':''} ${isLo&&!allSame?'is-lowest':''} ${isHi&&!isLo?'is-highest':''}">
            <div class="s-chip-av ${COLORS[i]}">${initials(p.name)}</div>
            <span class="s-chip-pts ${ptsClass}">${scores[i]}</span>
            ${isLo&&!allSame?'🟢':''}${isHi&&!isLo?'🔴':''}
        </div>`;
    }
    setInner('score-chips', html);
    const cp = gs.players.find(p => p.index === gs.turn) || { name: `AI ${gs.turn+1}` };
    setText('turn-player-name', cp.name + (gs.turn === myIndex ? ' (Kamu!)' : ''));
}

// ── Opponents ──
function renderOpponents(gs) {
    const n = 4;
    const seats = {
        left:  (myIndex + 1) % n,
        top:   (myIndex + 2) % n,
        right: (myIndex + 3) % n,
    };
    Object.entries(seats).forEach(([pos, idx]) => {
        const p = gs.players.find(p => p.index === idx) || { name: `AI ${idx+1}`, index: idx };
        const hand = gs.hands[idx] || [];
        const av = $(`av-${pos}`);
        if (!av) return;
        av.className   = `opp-avatar ${COLORS[idx]} ${idx===gs.turn?'is-turn':''}`;
        av.textContent = initials(p.name);
        setText(`nm-${pos}`, p.name);
        setText(`sc-${pos}`, `${gs.scores[idx]} pts`);
        setText(`cc-${pos}`, `🂠 ${hand.length}`);

        const handEl = $(`hand-${pos}`);
        if (!handEl) return;
        handEl.innerHTML = '';
        hand.forEach(() => {
            const d = document.createElement('div');
            d.className = 'fd-card';
            handEl.appendChild(d);
        });
    });
}

// ── Board snake layout ──
function renderBoard(gs) {
    const boardEl = $('board');
    if (!boardEl) return;
    boardEl.innerHTML = '';
    const tiles = gs.board.tiles;
    if (!tiles.length) {
        boardEl.innerHTML = '<div class="board-empty-msg">Letakkan kartu pertama...</div>';
        boardEl.style.width = '';
        boardEl.style.height = '';
        return;
    }

    // Ukuran tile (dinamis berdasarkan layar HP)
    const isMobile = window.innerWidth <= 600;
    const TW = isMobile ? 42 : 52; // tile H width
    const TH = isMobile ? 22 : 28; // tile H height  
    const DW = isMobile ? 22 : 28; // tile V (double) width
    const DH = isMobile ? 42 : 52; // tile V (double) height

    // Hitung lebar area yang tersedia
    const scrollEl = $('board-scroll');
    const areaW = scrollEl ? scrollEl.clientWidth - 40 : 600; // padding 20px kiri+kanan
    const MARGIN = 10; // margin dari tepi sebelum belok

    // dir: 1 = kiri ke kanan, -1 = kanan ke kiri
    let dir = 1;
    let cx = 0; // posisi X saat ini
    let cy = 0; // posisi Y saat ini
    let rowH = 0; // tinggi baris tertinggi di baris ini
    const positions = []; // {x, y, w, h, ori} untuk setiap tile

    tiles.forEach((t, i) => {
        const isDouble = (t.l === t.r);
        const w = isDouble ? DW : TW;
        const h = isDouble ? DH : TH;

        // Cek apakah tile ini melewati batas
        let nextEdge = dir === 1 ? (cx + w) : (cx - w);
        let needTurn = false;
        if (dir === 1 && nextEdge > areaW - MARGIN && i > 0) needTurn = true;
        if (dir === -1 && cx - w < MARGIN && i > 0) needTurn = true;

        if (needTurn) {
            // Naik ke baris baru (ke atas) agar tidak tertutup area tangan
            const gap = isMobile ? 12 : 8;
            cy -= (Math.max(rowH, DH) + gap); // gap vertikal antar baris
            dir *= -1; // balik arah
            rowH = 0;
            // Reset posisi horizontal
            if (dir === 1) { cx = 0; }
            else { cx = areaW - MARGIN; }
        }

        // Posisikan tile
        let x, y;
        if (dir === 1) {
            x = cx;
            y = cy + (DH - h) / 2; // center vertikal terhadap tinggi double
            cx += w; // gerak ke kanan
        } else {
            x = cx - w;
            y = cy + (DH - h) / 2;
            cx -= w; // gerak ke kiri
        }

        rowH = Math.max(rowH, h);
        positions.push({ x, y, w, h, ori: isDouble ? 'V' : 'H', t, dir });
    });

    // Hitung ukuran total board dan normalisasi Y
    let minX = 0, minY = 0, maxX = 0, maxY = 0;
    if (positions.length > 0) {
        minX = positions[0].x; minY = positions[0].y;
        maxX = positions[0].x + positions[0].w; maxY = positions[0].y + positions[0].h;
    }
    positions.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + p.w);
        maxY = Math.max(maxY, p.y + p.h);
    });

    // Normalisasi posisi agar tidak ada yang negatif (karena naik ke atas)
    positions.forEach(p => {
        p.x -= minX;
        p.y -= minY;
    });

    boardEl.style.position = 'relative';
    boardEl.style.width = (maxX - minX) + 'px';
    boardEl.style.height = (maxY - minY) + 'px';
    boardEl.style.margin = 'auto';

    // Render semua tile di posisi absolut
    positions.forEach(p => {
        const renderL = p.dir === 1 ? p.t.l : p.t.r;
        const renderR = p.dir === 1 ? p.t.r : p.t.l;
        const el = makeTile(renderL, renderR, p.ori, '');
        el.style.position = 'absolute';
        el.style.left = p.x + 'px';
        el.style.top = p.y + 'px';
        boardEl.appendChild(el);
    });
}

// ── My Hand ──
function renderMyHand(gs) {
    if (myIndex < 0) return;
    const handEl = $('my-hand');
    if (!handEl) return;

    const board    = gs.board;
    const isMyTurn = gs.turn === myIndex && gs.status === 'playing';

    // Bangun daftar kartu berdasarkan urutan custom (drag)
    let hand = gs.hands[myIndex] || [];

    // Urutkan sesuai custom order; kartu baru ditambah di akhir
    const orderedHand = [];
    const unordered   = [...hand];
    myHandOrder.forEach(key => {
        const idx = unordered.findIndex(t => `${t.l}-${t.r}` === key || `${t.r}-${t.l}` === key);
        if (idx !== -1) { orderedHand.push(unordered.splice(idx, 1)[0]); }
    });
    // Kartu baru (belum ada di order) ditambah di ujung
    hand = [...orderedHand, ...unordered];

    // Update order tracker dengan hand terbaru
    myHandOrder = hand.map(t => `${t.l}-${t.r}`);

    // Hitung playable
    const playable = new Map();
    hand.forEach(t => {
        const sides = getPlayableSides(t, board, board.tiles.length === 0);
        if (sides.length) playable.set(`${t.l}-${t.r}`, sides);
    });

    const pips = hand.reduce((s, t) => s + (t.l === 0 && t.r === 0 ? 25 : t.l + t.r), 0);
    setText('my-pip-info', `${hand.length} kartu • ${pips} pip`);

    const myPlayer = gs.players.find(p => p.index === myIndex) || { name: myName, index: myIndex };
    const myAv = $('my-avatar');
    if (myAv) {
        myAv.className   = `opp-avatar ${COLORS[myIndex]} ${myIndex === gs.turn ? 'is-turn' : ''}`;
        myAv.textContent = initials(myPlayer.name);
    }
    setText('my-name-display', myPlayer.name + ' (Kamu)');
    setText('my-score-display', `${gs.scores[myIndex]} pts`);

    // Destroy Sortable lama dulu sebelum rebuild DOM
    if (sortableInstance) { try { sortableInstance.destroy(); } catch(e){} sortableInstance = null; }
    handEl.innerHTML = '';

    hand.forEach(tile => {
        const key   = `${tile.l}-${tile.r}`;
        const sides = playable.get(key);
        const canPlay = isMyTurn && !!sides;

        const el = makeTile(tile.l, tile.r, 'hand', canPlay ? 'ok' : 'no');
        el.dataset.key = key;
        if (canPlay) {
            el.onpointerup = () => { if (!isDragging) handleTileClick(tile, sides); };
            el.onclick = (e) => e.preventDefault(); // cegah klik ganda di mobile
        }
        handEl.appendChild(el);
    });

    // Init Sortable baru
    if (window.Sortable) {
        sortableInstance = Sortable.create(handEl, {
            animation: 200,
            ghostClass: 'tile-ghost',
            chosenClass: 'tile-chosen',
            dragClass: 'tile-drag',
            // Native HTML5 drag API — klik tetap bekerja normal
            // Geser mouse/touch ≥5px = drag reorder
            delay: 200,
            delayOnTouchOnly: true,    // delay HANYA di touch, desktop native drag
            onStart: () => { isDragging = true; },
            onEnd: function () {
                setTimeout(() => { isDragging = false; }, 50);
                const newOrder = [];
                handEl.querySelectorAll('.tile').forEach(el => {
                    newOrder.push(el.dataset.key);
                });
                myHandOrder = newOrder;
            }
        });
    }
}

function getPlayableSides(tile, board, boardEmpty) {
    if (boardEmpty) return ['start'];
    const s = [];
    if (tile.l === board.leftVal || tile.r === board.leftVal)  s.push('left');
    if (tile.l === board.rightVal || tile.r === board.rightVal) s.push('right');
    return s;
}

// ── Actions ──
function renderActions(gs) {
    if (myIndex < 0) return;
    const isMyTurn = gs.turn === myIndex && gs.status === 'playing';
    const hand     = gs.hands[myIndex] || [];
    const board    = gs.board;
    const boardEmpty = board.tiles.length === 0;
    const canPlay  = hand.some(t => getPlayableSides(t, board, boardEmpty).length > 0);

    const drawBtn = $('btn-draw');
    const passBtn = $('btn-pass');
    if (drawBtn) drawBtn.classList.toggle('hidden', !(isMyTurn && !canPlay && gs.boneyard > 0));
    if (passBtn) passBtn.classList.toggle('hidden', !(isMyTurn && !canPlay && gs.boneyard === 0));

    // Auto-draw / Auto-pass logic
    if (isMyTurn && !canPlay) {
        if (gs.boneyard > 0) {
            setTimeout(() => {
                if (gameState && gameState.turn === myIndex) {
                    if (drawBtn) drawBtn.click();
                }
            }, 800);
        } else {
            setTimeout(() => {
                if (gameState && gameState.turn === myIndex) {
                    if (passBtn) passBtn.click();
                }
            }, 800);
        }
    }
}

function updateTimer(turn, time) {
    const isMyTurn = turn === myIndex;
    const pct = Math.max(0, (time / 20) * 100);
    const bar = $('timer-bar');
    const num = $('timer-num');
    if (bar) { bar.style.width = pct + '%'; bar.classList.toggle('crit', time <= 5); }
    if (num) setText('timer-num', isMyTurn ? time + 's' : '-');
}

// ─── TILE CLICK ───────────────────────────────────────────
function handleTileClick(tile, sides) {
    if (!gameState || gameState.turn !== myIndex) return;

    if (sides.length === 1) {
        const side = sides[0] === 'start' ? 'right' : sides[0];
        socket.emit('playTile', { roomId: myRoomId, tile, side });
    } else {
        pendingTile = tile;
        const board = gameState.board;
        setText('left-val',  board.leftVal);
        setText('right-val', board.rightVal);

        const preview = $('pending-tile-preview');
        if (preview) {
            preview.innerHTML = '';
            preview.appendChild(makeTile(tile.l, tile.r, 'hand', ''));
        }
        showOverlay('side-overlay');
    }
}

$('btn-side-left').onclick = () => {
    if (!pendingTile) return;
    socket.emit('playTile', { roomId: myRoomId, tile: pendingTile, side: 'left' });
    pendingTile = null;
    hideOverlay('side-overlay');
};
$('btn-side-right').onclick = () => {
    if (!pendingTile) return;
    socket.emit('playTile', { roomId: myRoomId, tile: pendingTile, side: 'right' });
    pendingTile = null;
    hideOverlay('side-overlay');
};
$('btn-side-cancel').onclick = () => { pendingTile = null; hideOverlay('side-overlay'); };

$('btn-draw').onclick = () => {
    if (!gameState || gameState.turn !== myIndex) return;
    socket.emit('drawTile', myRoomId);
};
$('btn-pass').onclick = () => {
    if (!gameState || gameState.turn !== myIndex) return;
    socket.emit('passTurn', myRoomId);
};

// ─── ROUND END ────────────────────────────────────────────
function renderRoundEnd(data) {
    const { pitus, winnerId, roundScores, scores, players, status, pitusInfo } = data;
    const roundIcon = $('round-icon');
    if (roundIcon) roundIcon.textContent = pitus ? '⚠️' : '🏆';

    const winnerName = players.find(p => p.index === winnerId)?.name || `AI ${(winnerId||0)+1}`;
    setText('round-title', pitus ? 'Angka Habis! (Permainan Buntu)' : `${winnerName} Menang Ronde!`);
    
    let subText = 'Kartu di tangan habis!';
    if (pitus) {
        let ujung = pitusInfo ? `(Ujung meja: ${pitusInfo.left} dan ${pitusInfo.right})` : '';
        subText = `Tidak ada kartu cocok ${ujung}. ${winnerName} menang poin sisa terkecil!`;
    }
    setText('round-sub', subText);

    const allSlots = [];
    for (let i = 0; i < 4; i++)
        allSlots.push(players.find(p => p.index === i) || { name: `AI ${i+1}`, index: i });

    setInner('round-score-list',
        [...allSlots].sort((a, b) => scores[a.index] - scores[b.index]).map(p => {
            const isW  = p.index === winnerId;
            const isDng = scores[p.index] >= 75;
            return `<div class="sc-row ${isW ? 'win' : ''}">
                <div class="sc-av ${COLORS[p.index]}">${initials(p.name)}</div>
                <div class="sc-info">
                    <div class="sc-name">${p.name} ${isW ? '🏆' : ''}</div>
                    <div class="sc-round">+${roundScores[p.index]} poin • Total: ${scores[p.index]}</div>
                </div>
                <div class="sc-total ${isDng ? 'danger' : ''}">${scores[p.index]}</div>
            </div>`;
        }).join('')
    );

    const nextBtn = $('btn-next-round');
    if (!nextBtn) return;

    if (status === 'game-end') {
        nextBtn.textContent = '🏁 Lihat Hasil Akhir';
        nextBtn.onclick = () => {
            hideOverlay('round-overlay');
            renderGameEnd({ scores, players: allSlots });
            showOverlay('gameover-overlay');
        };
    } else {
        nextBtn.textContent = '▶ Ronde Berikutnya';
        nextBtn.onclick = () => {
            hideOverlay('round-overlay');
            // All players can trigger next round
            socket.emit('nextRound', myRoomId);
        };
    }
}

// ─── GAME END ─────────────────────────────────────────────
function renderGameEnd(data) {
    const scores  = data.scores || (gameState && gameState.scores) || [0,0,0,0];
    const players = data.players || (gameState && gameState.players) || [];
    const allSlots = [];
    for (let i = 0; i < 4; i++)
        allSlots.push(players.find(p => p.index === i) || { name: `AI ${i+1}`, index: i });
    allSlots.sort((a, b) => scores[a.index] - scores[b.index]);

    const winner = allSlots[0];
    setText('gameover-title', `${winner.name} Menang! 🥇`);
    setInner('gameover-list',
        allSlots.map((p, rank) => {
            const isDng = scores[p.index] >= 75;
            return `<div class="sc-row ${rank===0?'win':''} ${isDng?'lose':''}">
                <div class="sc-av ${COLORS[p.index]}">${initials(p.name)}</div>
                <div class="sc-info">
                    <div class="sc-name">${['🥇','🥈','🥉','4️⃣'][rank]} ${p.name}</div>
                    <div class="sc-round">${isDng ? '❌ Kalah (≥75 poin)' : '✅ Aman'}</div>
                </div>
                <div class="sc-total ${isDng?'danger':''}">${scores[p.index]}</div>
            </div>`;
        }).join('')
    );
}

$('btn-play-again').onclick = () => {
    hideOverlay('gameover-overlay');
    showScreen('lobby-screen');
    showMenu('menu-main');
    myRoomId = null;
    myIndex  = -1;
    isHost   = false;
    gameState = null;
    pendingTile = null;
    resetQuickplayBtn();
    // Clear player list
    const list = $('player-list');
    if (list) list.innerHTML = '';
};

// ─── TILE BUILDER ─────────────────────────────────────────
function makeTile(l, r, ori, extra) {
    const el = document.createElement('div');
    el.className = `tile ${ori} ${extra}`.trim();
    el.innerHTML = `${makeHalf(l)}<div class="td"></div>${makeHalf(r)}`;
    return el;
}
function makeHalf(n) {
    let dots = '';
    for (let i = 1; i <= n; i++) dots += `<div class="dot d${i}"></div>`;
    return `<div class="th n${n}">${dots}</div>`;
}

// ─── ERROR ────────────────────────────────────────────────
function showError(msg) {
    const el = $('lobby-error');
    if (!el) return;
    el.textContent = msg;
    setTimeout(() => { if (el) el.textContent = ''; }, 3500);
}

// ─── WEBRTC VOICE CHAT ────────────────────────────────────
let localStream = null;
const peerConnections = {}; // socket.id -> RTCPeerConnection
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let micEnabled = false;

const btnMic = $('btn-mic');
if (btnMic) {
    btnMic.onclick = async () => {
        if (!micEnabled) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
                });
                micEnabled = true;
                btnMic.textContent = '🎤 Mic On';
                btnMic.className = 'mic-on';
                
                // Init connection to all existing players in room
                if (gameState && gameState.players) {
                    gameState.players.forEach(p => {
                        if (p.id !== socket.id) initiateCall(p.id);
                    });
                }
            } catch (err) {
                console.error('Mic error:', err);
                showToast('Gagal mengakses Mikrofon. Pastikan Anda mengizinkannya.');
            }
        } else {
            // Turn off mic
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }
            micEnabled = false;
            btnMic.textContent = '🎤 Mic Off';
            btnMic.className = 'mic-off';
            // Close all connections
            Object.values(peerConnections).forEach(pc => pc.close());
            for (let id in peerConnections) delete peerConnections[id];
            const audioContainer = $('audio-streams');
            if (audioContainer) audioContainer.innerHTML = '';
        }
    };
}

function getPeerConnection(targetId) {
    if (peerConnections[targetId]) return peerConnections[targetId];
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[targetId] = pc;

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = e => {
        if (e.candidate) {
            socket.emit('rtc-candidate', { targetId, candidate: e.candidate });
        }
    };

    pc.ontrack = e => {
        const audioContainer = $('audio-streams');
        let audioEl = document.getElementById('audio-' + targetId);
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = 'audio-' + targetId;
            audioEl.autoplay = true;
            if (audioContainer) audioContainer.appendChild(audioEl);
        }
        audioEl.srcObject = e.streams[0];
    };
    
    // Auto-remove when disconnected
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            const audioEl = document.getElementById('audio-' + targetId);
            if (audioEl) audioEl.remove();
            delete peerConnections[targetId];
        }
    };

    return pc;
}

async function initiateCall(targetId) {
    const pc = getPeerConnection(targetId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('rtc-offer', { targetId, sdp: pc.localDescription });
}

socket.on('rtc-offer', async data => {
    if (!micEnabled) return; // ignore if we don't have mic on
    const pc = getPeerConnection(data.callerId);
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('rtc-answer', { targetId: data.callerId, sdp: pc.localDescription });
});

socket.on('rtc-answer', async data => {
    const pc = peerConnections[data.callerId];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
});

socket.on('rtc-candidate', async data => {
    const pc = peerConnections[data.callerId];
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
});

// ─── BACKGROUND MUSIC (Web Audio API) ────────────────────
let audioCtx = null;
let musicPlaying = false;
let musicNodes = [];
let musicScheduled = [];
let musicTimeout = null;

// Nada pentatonik tradisional (sunda/kalimantan nuansa)
const PENTATONIC = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 784.00, 880.00];
const BASS_NOTES = [65.41, 73.42, 82.41, 98.00, 110.00];

function ensureAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playNote(freq, startTime, duration, gainVal, type = 'sine', dest = null) {
    if (!audioCtx || !musicPlaying) return;
    const osc = audioCtx.createOscillator();
    const g   = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, startTime);
    g.gain.linearRampToValueAtTime(gainVal, startTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(g);
    g.connect(dest || audioCtx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
    musicNodes.push(osc);
}

function scheduleBar(barStart) {
    if (!musicPlaying) return;
    const bpm = 80;
    const beat = 60 / bpm;
    const bar = beat * 4;

    // Reverb-like: master gain
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.45;
    masterGain.connect(audioCtx.destination);

    // === BASS (gentle pluck) ===
    const bassPattern = [0, 0, 2, 0, 1, 0, 2, 0];
    bassPattern.forEach((noteIdx, step) => {
        const t = barStart + step * (beat / 2);
        playNote(BASS_NOTES[noteIdx], t, beat * 0.6, 0.35, 'triangle', masterGain);
    });

    // === MELODY (pentatonik, slow) ===
    const melodies = [
        [4, null, 5, null, 3, null, 5, 4],
        [5, null, 6, null, 4, null, 6, 5],
        [3, 4, 5, null, 4, 3, null, 4],
        [5, 6, 7, null, 5, 4, null, 5],
    ];
    const melodyIdx = (Math.floor((barStart / (beat * 4)) % melodies.length));
    const melody = melodies[melodyIdx];
    melody.forEach((noteIdx, step) => {
        if (noteIdx === null) return;
        const t = barStart + step * (beat / 2);
        playNote(PENTATONIC[noteIdx], t, beat * 0.8, 0.18, 'sine', masterGain);
    });

    // === HI-HAT feel (softer, quiet) ===
    for (let step = 0; step < 8; step++) {
        if (step % 2 === 0) {
            const t = barStart + step * (beat / 2);
            const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.04, audioCtx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
            const src = audioCtx.createBufferSource();
            src.buffer = buf;
            const hg = audioCtx.createGain();
            hg.gain.setValueAtTime(0.04, t);
            hg.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
            src.connect(hg);
            hg.connect(masterGain);
            src.start(t);
            musicNodes.push(src);
        }
    }

    // Schedule next bar
    const nextBar = barStart + bar;
    const delay = (nextBar - audioCtx.currentTime) * 1000 - 100;
    musicTimeout = setTimeout(() => scheduleBar(nextBar), Math.max(delay, 0));
}

function startMusic() {
    ensureAudioCtx();
    musicPlaying = true;
    const startAt = audioCtx.currentTime + 0.1;
    scheduleBar(startAt);
}

function stopMusic() {
    musicPlaying = false;
    if (musicTimeout) { clearTimeout(musicTimeout); musicTimeout = null; }
    musicNodes.forEach(n => { try { n.stop(audioCtx.currentTime + 0.05); } catch(e){} });
    musicNodes = [];
}

// Music toggle button
const btnMusic = $('btn-music');
if (btnMusic) {
    btnMusic.onclick = () => {
        ensureAudioCtx();
        if (!musicPlaying) {
            startMusic();
            btnMusic.className = 'music-btn music-on';
            btnMusic.title = 'Musik: Nyala';
            showToast('🎵 Musik dinyalakan');
        } else {
            stopMusic();
            btnMusic.className = 'music-btn music-off';
            btnMusic.title = 'Musik: Mati';
            showToast('🔇 Musik dimatikan');
        }
    };
    // Auto-start music on first game interaction (respects autoplay policy)
    document.addEventListener('click', function startOnce() {
        if (!musicPlaying && audioCtx === null) {
            startMusic();
        }
        document.removeEventListener('click', startOnce);
    }, { once: true });
}
