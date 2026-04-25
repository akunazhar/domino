'use strict';
// ─── STATE ────────────────────────────────────────────────
const socket = io({
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 10,
});
let myIndex = -1;
let myRoomId = null;
let isHost = false;
let myName = 'Player';
let gameState = null;
let pendingTile = null;
let roundReadyCount = 0; // track how many players clicked next round

// ─── DOM HELPERS ──────────────────────────────────────────
const $ = id => document.getElementById(id);
const COLORS = ['c0', 'c1', 'c2', 'c3'];
function showEl(id) { const e = $(id); if (e) e.classList.remove('hidden'); }
function hideEl(id) { const e = $(id); if (e) e.classList.add('hidden'); }
function setInner(id, v) { const e = $(id); if (e) e.innerHTML = v; }
function setText(id, v) { const e = $(id); if (e) e.textContent = v; }

// Show lobby sub-sections
function showMenu(name) {
    ['menu-main', 'menu-create', 'menu-join', 'menu-waiting'].forEach(m =>
        $(m).classList.toggle('hidden', m !== name)
    );
}

function initials(name) {
    return (name || '?').trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

// ─── SCREENS ─────────────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
}
function showOverlay(id) { const e = $(id); if (e) e.classList.remove('hidden'); }
function hideOverlay(id) { const e = $(id); if (e) e.classList.add('hidden'); }

// ─── LOBBY WIRING ─────────────────────────────────────────
$('btn-quickplay').onclick = () => {
    myName = $('my-name-input').value.trim() || 'Player';
    setText('btn-quickplay', '⏳ Mencari lawan...');
    $('btn-quickplay').disabled = true;
    socket.emit('findPublicMatch', { name: myName });
};
$('btn-create').onclick = () => showMenu('menu-create');
$('btn-join').onclick = () => showMenu('menu-join');
$('btn-create-back').onclick = () => { showMenu('menu-main'); resetQuickplayBtn(); };
$('btn-join-back').onclick = () => { showMenu('menu-main'); resetQuickplayBtn(); };

function resetQuickplayBtn() {
    const btn = $('btn-quickplay');
    btn.textContent = '🚀 Main Cepat';
    btn.disabled = false;
}

$('btn-create-confirm').onclick = () => {
    myName = $('my-name-input').value.trim() || 'Player';
    socket.emit('createRoom', { name: myName, password: $('create-pass').value });
};
$('btn-join-confirm').onclick = () => {
    myName = $('my-name-input').value.trim() || 'Player';
    const code = $('join-code').value.trim().toUpperCase();
    if (code.length < 5) return showError('Masukkan kode yang valid (min 5 karakter)');
    socket.emit('joinRoom', { roomId: code, name: myName, password: $('join-pass').value });
};
$('btn-start-game').onclick = () => socket.emit('startGame', myRoomId);

// ─── SOCKET EVENTS ────────────────────────────────────────
socket.on('roomJoined', data => {
    myRoomId = data.roomId;
    myIndex = data.playerIndex;
    isHost = data.isHost;
    resetQuickplayBtn();
    setText('room-code-display', data.roomId);
    setText('room-type-label', data.isPublic ? '🌍 Publik' : '🔒 Privat');
    showMenu('menu-waiting');
    if (isHost) { showEl('host-controls'); hideEl('guest-hint'); }
    else { hideEl('host-controls'); showEl('guest-hint'); }
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
        el.className = 'conn-status connected';
    } else {
        el.textContent = '🔴 Server offline — jalankan: node server.js';
        el.className = 'conn-status disconnected';
    }
}
socket.on('connect', () => setConnStatus(true));
socket.on('disconnect', () => setConnStatus(false));
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
        const p = gs.players.find(p => p.index === i) || { name: `AI ${i + 1}`, index: i };
        const isT = i === gs.turn;
        const isLo = scores[i] === min;
        const isHi = scores[i] === max && max > 0;
        const allSame = scores.every(s => s === min);
        const ptsClass = isLo && !allSame ? 'low' : isHi ? 'high' : '';
        html += `<div class="s-chip ${isT ? 'is-turn' : ''} ${isLo && !allSame ? 'is-lowest' : ''} ${isHi && !isLo ? 'is-highest' : ''}">
            <div class="s-chip-av ${COLORS[i]}">${initials(p.name)}</div>
            <span class="s-chip-pts ${ptsClass}">${scores[i]}</span>
            ${isLo && !allSame ? '🟢' : ''}${isHi && !isLo ? '🔴' : ''}
        </div>`;
    }
    setInner('score-chips', html);
    const cp = gs.players.find(p => p.index === gs.turn) || { name: `AI ${gs.turn + 1}` };
    setText('turn-player-name', cp.name + (gs.turn === myIndex ? ' (Kamu!)' : ''));
}

// ── Opponents ──
function renderOpponents(gs) {
    const n = 4;
    const seats = {
        left: (myIndex + 1) % n,
        top: (myIndex + 2) % n,
        right: (myIndex + 3) % n,
    };
    Object.entries(seats).forEach(([pos, idx]) => {
        const p = gs.players.find(p => p.index === idx) || { name: `AI ${idx + 1}`, index: idx };
        const hand = gs.hands[idx] || [];
        const av = $(`av-${pos}`);
        if (!av) return;
        av.className = `opp-avatar ${COLORS[idx]} ${idx === gs.turn ? 'is-turn' : ''}`;
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
    const board = $('board');
    if (!board) return;
    board.innerHTML = '';
    const tiles = gs.board.tiles;
    if (!tiles.length) {
        board.innerHTML = '<div style="color:rgba(255,255,255,.18);font-size:.72rem;">Letakkan kartu pertama...</div>';
        return;
    }

    // ZIGZAG CONFIG
    const maxPerRow = 5; // Jumlah kartu per baris di HP
    const rows = [];
    for (let i = 0; i < tiles.length; i += maxPerRow) {
        rows.push(tiles.slice(i, i + maxPerRow));
    }

    rows.forEach((rowTiles, rowIndex) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'board-row';
        // Baris genap (indeks 1, 3, ...) arahnya terbalik
        if (rowIndex % 2 !== 0) rowEl.classList.add('reverse');

        rowTiles.forEach((t, i) => {
            const absIdx = rowIndex * maxPerRow + i;
            const isDouble = (t.l === t.r);
            const ori = isDouble ? 'V' : 'H';
            
            let extra = '';
            if (absIdx === 0) extra = 'tile-head';
            if (absIdx === tiles.length - 1 && tiles.length > 1) extra = 'tile-tail';

            const el = makeTile(t.l, t.r, ori, extra);
            rowEl.appendChild(el);
        });
        board.appendChild(rowEl);
    });

    // Auto scroll ke bawah (kartu terbaru)
    const scroll = $('board-scroll');
    if (scroll) {
        requestAnimationFrame(() => {
            scroll.scrollTop = scroll.scrollHeight;
        });
    }
}

// ── My Hand ──
function renderMyHand(gs) {
    if (myIndex < 0) return;
    const hand = gs.hands[myIndex] || [];
    const handEl = $('my-hand');
    if (!handEl) return;
    handEl.innerHTML = '';

    const board = gs.board;
    const isMyTurn = gs.turn === myIndex && gs.status === 'playing';

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
        myAv.className = `opp-avatar ${COLORS[myIndex]} ${myIndex === gs.turn ? 'is-turn' : ''}`;
        myAv.textContent = initials(myPlayer.name);
    }
    setText('my-name-display', myPlayer.name + ' (Kamu)');
    setText('my-score-display', `${gs.scores[myIndex]} pts`);

    hand.forEach(tile => {
        const key = `${tile.l}-${tile.r}`;
        const sides = playable.get(key);
        const canPlay = isMyTurn && !!sides;

        const el = makeTile(tile.l, tile.r, 'hand', canPlay ? 'ok' : 'no');
        if (canPlay) {
            el.onclick = () => handleTileClick(tile, sides);
        }
        handEl.appendChild(el);
    });
}

function getPlayableSides(tile, board, boardEmpty) {
    if (boardEmpty) return ['start'];
    const s = [];
    if (tile.l === board.leftVal || tile.r === board.leftVal) s.push('left');
    if (tile.l === board.rightVal || tile.r === board.rightVal) s.push('right');
    return s;
}

// ── Actions ──
function renderActions(gs) {
    if (myIndex < 0) return;
    const isMyTurn = gs.turn === myIndex && gs.status === 'playing';
    const hand = gs.hands[myIndex] || [];
    const board = gs.board;
    const boardEmpty = board.tiles.length === 0;
    const canPlay = hand.some(t => getPlayableSides(t, board, boardEmpty).length > 0);

    const drawBtn = $('btn-draw');
    const passBtn = $('btn-pass');
    if (drawBtn) drawBtn.classList.toggle('hidden', !(isMyTurn && !canPlay && gs.boneyard > 0));
    if (passBtn) passBtn.classList.toggle('hidden', !(isMyTurn && !canPlay && gs.boneyard === 0));
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

    if (sides[0] === 'start' || sides.length === 1) {
        const side = sides[0] === 'start' ? 'right' : sides[0];
        socket.emit('playTile', { roomId: myRoomId, tile, side });
    } else {
        // Both ends match → show side selector
        pendingTile = tile;
        const board = gameState.board;
        setText('left-val', board.leftVal);
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
    const { pitus, winnerId, roundScores, scores, players, status } = data;
    const roundIcon = $('round-icon');
    if (roundIcon) roundIcon.textContent = pitus ? '⚠️' : '🏆';

    const winnerName = players.find(p => p.index === winnerId)?.name || `AI ${(winnerId || 0) + 1}`;
    setText('round-title', pitus ? 'PITUS! Papan Buntu!' : `${winnerName} Menang Ronde!`);
    setText('round-sub', pitus ? `${winnerName} menang karena poin sisa terkecil!` : 'Kartu habis!');

    const allSlots = [];
    for (let i = 0; i < 4; i++)
        allSlots.push(players.find(p => p.index === i) || { name: `AI ${i + 1}`, index: i });

    setInner('round-score-list',
        [...allSlots].sort((a, b) => scores[a.index] - scores[b.index]).map(p => {
            const isW = p.index === winnerId;
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
    const scores = data.scores || (gameState && gameState.scores) || [0, 0, 0, 0];
    const players = data.players || (gameState && gameState.players) || [];
    const allSlots = [];
    for (let i = 0; i < 4; i++)
        allSlots.push(players.find(p => p.index === i) || { name: `AI ${i + 1}`, index: i });
    allSlots.sort((a, b) => scores[a.index] - scores[b.index]);

    const winner = allSlots[0];
    setText('gameover-title', `${winner.name} Menang! 🥇`);
    setInner('gameover-list',
        allSlots.map((p, rank) => {
            const isDng = scores[p.index] >= 75;
            return `<div class="sc-row ${rank === 0 ? 'win' : ''} ${isDng ? 'lose' : ''}">
                <div class="sc-av ${COLORS[p.index]}">${initials(p.name)}</div>
                <div class="sc-info">
                    <div class="sc-name">${['🥇', '🥈', '🥉', '4️⃣'][rank]} ${p.name}</div>
                    <div class="sc-round">${isDng ? '❌ Kalah (≥75 poin)' : '✅ Aman'}</div>
                </div>
                <div class="sc-total ${isDng ? 'danger' : ''}">${scores[p.index]}</div>
            </div>`;
        }).join('')
    );
}

$('btn-play-again').onclick = () => {
    hideOverlay('gameover-overlay');
    showScreen('lobby-screen');
    showMenu('menu-main');
    myRoomId = null;
    myIndex = -1;
    isHost = false;
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
