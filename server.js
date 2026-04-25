'use strict';
const express = require('express');
const http    = require('http');
const path    = require('path');
const { Server } = require('socket.io');

const compression = require('compression');

const app    = express();
app.use(compression()); // Kecilkan ukuran data agar lebih cepat terkirim
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── TILE ────────────────────────────────────────────────
class Tile {
    constructor(l, r) {
        this.l = l; this.r = r;
        this.isDouble = l === r;
    }
    get pips() { 
        if (this.l === 0 && this.r === 0) return 25;
        return this.l + this.r; 
    }
    matches(v)  { return this.l === v || this.r === v; }
    flipped()   { return new Tile(this.r, this.l); }
    toJSON()    { return { l: this.l, r: this.r, isDouble: this.isDouble }; }
}

// ─── BOARD ───────────────────────────────────────────────
class Board {
    constructor() { this.tiles = []; this.leftVal = null; this.rightVal = null; }
    isEmpty() { return this.tiles.length === 0; }

    place(tile, side) {
        if (this.isEmpty()) {
            this.tiles.push({ l: tile.l, r: tile.r, ori: tile.isDouble ? 'V' : 'H' });
            this.leftVal = tile.l; this.rightVal = tile.r; return;
        }

        // --- CEK POTONG TENGAH (PRIORITAS) ---
        // Potong Tengah diutamakan jika side === 'middle' ATAU match ditemukan di tengah (bukan ujung)
        let midIndex = -1;
        let matchVal = -1;

        // Jika side === 'middle', cari di mana pun
        // Jika side normal, cari hanya di internal (untuk menghindari salah potong saat sambung biasa)
        const startIdx = (side === 'middle') ? this.tiles.length - 1 : this.tiles.length - 2;
        const endIdx   = (side === 'middle') ? 0 : 1;

        for (let i = startIdx; i >= endIdx; i--) {
            const t = this.tiles[i];
            if (tile.l === t.l || tile.l === t.r) { midIndex = i; matchVal = tile.l; break; }
            if (tile.r === t.l || tile.r === t.r) { midIndex = i; matchVal = tile.r; break; }
        }

        if (midIndex !== -1) {
            this.tiles = this.tiles.slice(midIndex);

            let newT = tile;
            if (newT.r !== matchVal) newT = newT.flipped();

            if (this.tiles[0].l !== matchVal) {
                const old = this.tiles[0];
                this.tiles[0] = { l: old.r, r: old.l, ori: old.ori };
            }

            this.tiles.unshift({ l: newT.l, r: newT.r, ori: newT.isDouble ? 'V' : 'H' });

            // UPDATE ENDS
            this.updateEnds();
            
            this.checkAutoCut();
            return;
        }

        // --- ATURAN NORMAL ---
        if (side === 'left') {
            let t = tile;
            if (t.r !== this.leftVal) t = t.flipped();
            this.tiles.unshift({ l: t.l, r: t.r, ori: t.isDouble ? 'V' : 'H' });
            this.leftVal = t.l;
        } else {
            let t = tile;
            if (t.l !== this.rightVal) t = t.flipped();
            this.tiles.push({ l: t.l, r: t.r, ori: t.isDouble ? 'V' : 'H' });
            this.rightVal = t.r;
        }

        this.checkAutoCut();
    }

    checkAutoCut() {
        if (this.tiles.length < 3) return;

        let changed = false;

        // 1. Jika leftVal ada di kartu mana pun di tengah, buang bagian depannya
        // Cari dari belakang agar membuang sebanyak mungkin
        for (let i = this.tiles.length - 1; i >= 1; i--) {
            if (this.leftVal === this.tiles[i].l || this.leftVal === this.tiles[i].r) {
                this.tiles = this.tiles.slice(i);
                if (this.tiles[0].l !== this.leftVal) {
                    const old = this.tiles[0];
                    this.tiles[0] = { l: old.r, r: old.l, ori: old.ori };
                }
                changed = true;
                break;
            }
        }

        // 2. Jika rightVal ada di kartu mana pun di tengah, buang bagian belakangnya
        // Cari dari depan agar membuang sebanyak mungkin
        for (let i = 0; i <= this.tiles.length - 2; i++) {
            if (this.rightVal === this.tiles[i].l || this.rightVal === this.tiles[i].r) {
                this.tiles = this.tiles.slice(0, i + 1);
                if (this.tiles[this.tiles.length - 1].r !== this.rightVal) {
                    const old = this.tiles[this.tiles.length - 1];
                    this.tiles[this.tiles.length - 1] = { l: old.r, r: old.l, ori: old.ori };
                }
                changed = true;
                break;
            }
        }

        if (changed) this.updateEnds();
    }

    updateEnds() {
        if (this.isEmpty()) {
            this.leftVal = null;
            this.rightVal = null;
        } else {
            this.leftVal  = this.tiles[0].l;
            this.rightVal = this.tiles[this.tiles.length - 1].r;
        }
    }

    getPlayableSides(tile, boardEmpty) {
        if (boardEmpty) return ['start'];
        const sides = [];
        
        // Cek kecocokan di seluruh kartu (Potong Tengah)
        for (let i = 0; i < this.tiles.length; i++) {
            if (tile.matches(this.tiles[i].l) || tile.matches(this.tiles[i].r)) {
                if (!sides.includes('middle')) sides.push('middle');
                break; 
            }
        }

        // Tetap tambahkan left/right untuk kompatibilitas UI
        if (tile.matches(this.leftVal))  sides.push('left');
        if (tile.matches(this.rightVal)) sides.push('right');
        return sides;
    }

    isBlocked(hands) {
        if (this.isEmpty()) return false;
        return hands.every(hand =>
            hand.every(t => {
                const sides = this.getPlayableSides(t, false);
                return sides.length === 0;
            })
        );
    }

    reset() { this.tiles = []; this.leftVal = null; this.rightVal = null; }
    toJSON() { return { tiles: this.tiles, leftVal: this.leftVal, rightVal: this.rightVal }; }
}

// ─── HELPERS ─────────────────────────────────────────────
function generateDeck() {
    const d = [];
    for (let i = 0; i <= 6; i++)
        for (let j = i; j <= 6; j++) d.push(new Tile(i, j));
    return d;
}
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
function findStartingPlayer(hands) {
    // Find player with highest double
    for (let d = 6; d >= 0; d--)
        for (let i = 0; i < hands.length; i++)
            if (hands[i].some(t => t.l === d && t.r === d)) return i;
    // If no doubles found, player with highest single tile starts
    let best = 0, bestVal = -1;
    for (let i = 0; i < hands.length; i++) {
        const maxPip = Math.max(...hands[i].map(t => t.l + t.r));
        if (maxPip > bestVal) { bestVal = maxPip; best = i; }
    }
    return best;
}

// ─── ROOMS ───────────────────────────────────────────────
const rooms = {};

function makeRoom(roomId, isPublic) {
    return {
        id: roomId, isPublic,
        password: null,
        players: [],              // [{id, name, index}]
        scores: [0, 0, 0, 0],    // total scores per seat
        round: 0,
        status: 'lobby',          // lobby | playing | round-end | game-end
        board: new Board(),
        hands: [[], [], [], []],
        boneyard: [],
        turn: 0,
        turnTime: 20,
        timerInterval: null,
        aiTimeout: null,
        lastRoundWinner: null,
        passCount: 0,             // count consecutive passes (for stuck detection)
    };
}

function startRound(room) {
    room.round++;
    room.board.reset();
    room.passCount = 0;

    // For < 4 human players, deal 7 to each of 4 seats, rest to boneyard
    const deck = shuffle(generateDeck());
    room.hands = [[], [], [], []];
    for (let i = 0; i < 4; i++)
        for (let c = 0; c < 7; c++) room.hands[i].push(deck.pop());
    room.boneyard = deck; // Will be empty for exactly 4 players (28 tiles total)

    // For games with <4 human players we add extra tiles to boneyard
    // by only dealing 6 cards to some seats if needed - actually standard is 7 each
    // The boneyard is empty for 4 players which is correct per standard domino rules

    if (room.lastRoundWinner !== null) {
        room.turn = room.lastRoundWinner;
    } else {
        room.turn = findStartingPlayer(room.hands);
    }
    room.turnTime = 20;
    room.status   = 'playing';
    io.to(room.id).emit('roundStarted', buildState(room));
    startTimer(room.id);
    scheduleAI(room);
}

function buildState(room) {
    return {
        board:    room.board.toJSON(),
        hands:    room.hands.map(h => h.map(t => t.toJSON())),
        boneyard: room.boneyard.length,
        turn:     room.turn,
        turnTime: room.turnTime,
        scores:   room.scores,
        round:    room.round,
        status:   room.status,
        players:  room.players,
    };
}

// ─── MOVE EXECUTION ──────────────────────────────────────
function executeMove(room, pIdx, tileData, side) {
    const hand = room.hands[pIdx];
    // Find tile - match both orientations since client may send as-is
    const tileObj = hand.find(t =>
        (t.l === tileData.l && t.r === tileData.r) ||
        (t.l === tileData.r && t.r === tileData.l)
    );
    if (!tileObj) return false;

    // RULE: In Round 1, the very first move MUST be the Double 6 (6-6)
    if (room.round === 1 && room.board.isEmpty()) {
        if (!(tileObj.l === 6 && tileObj.r === 6)) {
            // If they tried to play something else, we could reject it
            // but for better UX, let's just find the 6-6 in their hand and play that instead
            // OR return false so the client knows it's invalid.
            // Let's return false and the client can show an error or we can just force it here.
            // Actually, returning false is safer.
            return false;
        }
    }

    room.hands[pIdx] = hand.filter(t => t !== tileObj);
    room.board.place(tileObj, side === 'start' ? 'right' : side);
    room.passCount = 0; // Reset pass counter on successful play

    if (room.hands[pIdx].length === 0) {
        // Winner gets 0 additional points — end round now
        endRound(room, pIdx, false); return true;
    }

    // ── Cek KEPOTONG / PITUS (Aturan Kalimantan) ──────────────────
    // Jika ujung kiri dan ujung kanan papan bernilai sama → LANGSUNG KEPOTONG
    // Tidak perlu semua kartu keluar, cukup kedua ujung sama
    const lv = room.board.leftVal;
    const rv = room.board.rightVal;
    if (lv !== null && rv !== null && lv === rv) {
        console.log(`KEPOTONG! Ujung kiri = ${lv}, ujung kanan = ${rv}`);
        endRound(room, null, true);
        return true;
    }


    nextTurn(room);
    return true;
}

function nextTurn(room) {
    room.turn     = (room.turn + 1) % 4;
    room.turnTime = 20;
    io.to(room.id).emit('gameStateUpdate', buildState(room));
    scheduleAI(room);
}

function endRound(room, winnerId, pitus) {
    if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }
    if (room.aiTimeout)     { clearTimeout(room.aiTimeout);      room.aiTimeout     = null; }

    const roundScores = [0, 0, 0, 0];
    
    if (pitus) {
        // Pitus: The player with the lowest pip count wins and gets 0 points!
        const pipCounts = room.hands.map(h => h.reduce((s, t) => s + t.pips, 0));
        const minPips = Math.min(...pipCounts);
        winnerId = pipCounts.indexOf(minPips);
    }

    if (winnerId !== null) {
        // Winner gets 0 points. All other players get their remaining pip count as penalty.
        room.hands.forEach((h, i) => {
            if (i !== winnerId) roundScores[i] = h.reduce((s, t) => s + t.pips, 0);
        });
    }

    roundScores.forEach((s, i) => room.scores[i] += s);
    room.lastRoundWinner = winnerId;

    // Game end if anyone >= 75
    const gameOver = room.scores.some(s => s >= 75);
    room.status = gameOver ? 'game-end' : 'round-end';

    io.to(room.id).emit('roundEnd', {
        pitus, winnerId, roundScores,
        scores: room.scores, status: room.status,
        players: room.players,
    });
}

// ─── TIMER ───────────────────────────────────────────────
function startTimer(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    if (room.timerInterval) clearInterval(room.timerInterval);
    room.timerInterval = setInterval(() => {
        const r = rooms[roomId];
        if (!r || r.status !== 'playing') {
            clearInterval(r?.timerInterval);
            return;
        }
        r.turnTime--;
        if (r.turnTime <= 0) {
            clearInterval(r.timerInterval); r.timerInterval = null;
            autoPlay(r);
        } else {
            io.to(roomId).emit('timerTick', { turn: r.turn, turnTime: r.turnTime });
        }
    }, 1000);
}

function autoPlay(room) {
    if (room.status !== 'playing') return;
    const pIdx = room.turn;
    const hand = room.hands[pIdx];
    const board = room.board;

    let played = false;
    for (const tile of hand) {
        const sides = board.getPlayableSides(tile, board.isEmpty());
        if (sides.length) {
            if (executeMove(room, pIdx, tile, sides[0])) {
                played = true; 
                break;
            }
        }
    }
    if (!played) {
        if (room.boneyard.length) {
            room.hands[pIdx].push(room.boneyard.pop());
            room.turnTime = 20;
            io.to(room.id).emit('gameStateUpdate', buildState(room));
            // Try to play the drawn tile
            const newTile = room.hands[pIdx][room.hands[pIdx].length - 1];
            const sides = board.getPlayableSides(newTile, board.isEmpty());
            if (sides.length) {
                executeMove(room, pIdx, newTile, sides[0]);
            } else {
                // Drew but still can't play — pass to next
                room.passCount = (room.passCount || 0) + 1;
                if (room.passCount >= 4) {
                    endRound(room, null, true); return;
                }
                nextTurn(room);
            }
        } else {
            // Can't play, no boneyard — pass turn, track consecutive passes
            room.passCount = (room.passCount || 0) + 1;
            if (room.passCount >= 4) {
                // All 4 players passed consecutively = true buntu (pitus)
                endRound(room, null, true);
                return;
            }
            nextTurn(room);
        }
    }
    if (room.status === 'playing') startTimer(room.id);
}

// ─── AI ──────────────────────────────────────────────────
function scheduleAI(room) {
    if (room.aiTimeout) { clearTimeout(room.aiTimeout); room.aiTimeout = null; }
    if (room.status !== 'playing') return;

    const pIdx    = room.turn;
    const isHuman = room.players.some(p => p.index === pIdx);
    if (isHuman) return;

    room.aiTimeout = setTimeout(() => {
        const r = rooms[room.id];
        if (!r || r.status !== 'playing' || r.turn !== pIdx) return;
        if (r.timerInterval) { clearInterval(r.timerInterval); r.timerInterval = null; }
        autoPlay(r);
        if (r.status === 'playing') startTimer(r.id);
    }, 1500);
}

// ─── SOCKET.IO ───────────────────────────────────────────
io.on('connection', socket => {
    console.log('Connected:', socket.id);

    socket.on('findPublicMatch', ({ name }) => {
        let room = Object.values(rooms).find(r => r.isPublic && r.players.length < 4 && r.status === 'lobby');
        if (!room) {
            const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
            room = makeRoom(roomId, true);
            rooms[roomId] = room;
        }
        joinRoom(socket, room, name || 'Player');
        if (room.players.length === 4) {
            // Start immediately with 4 players
            clearTimeout(room._startTimer);
            room.status = 'playing';
            startRound(room);
        } else {
            // Wait up to 8 seconds for more players, then start with AI
            clearTimeout(room._startTimer);
            room._startTimer = setTimeout(() => {
                const r = rooms[room.id];
                if (r && r.status === 'lobby') {
                    r.status = 'playing';
                    startRound(r);
                }
            }, 5000);
        }
    });

    socket.on('createRoom', ({ name, password }) => {
        const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
        const room   = makeRoom(roomId, false);
        room.password = password || null;
        rooms[roomId] = room;
        joinRoom(socket, room, name || 'Player');
    });

    socket.on('joinRoom', ({ roomId, name, password }) => {
        const room = rooms[roomId?.toUpperCase()];
        if (!room)                            return socket.emit('error', 'Room tidak ditemukan');
        if (room.status !== 'lobby')          return socket.emit('error', 'Game sudah dimulai');
        if (room.players.length >= 4)         return socket.emit('error', 'Room penuh');
        if (room.password && room.password !== password) return socket.emit('error', 'Password salah');
        joinRoom(socket, room, name || 'Player');
    });

    socket.on('startGame', roomId => {
        const room = rooms[roomId];
        if (!room || room.status !== 'lobby') return;
        const host = room.players[0];
        if (host.id !== socket.id) return;
        clearTimeout(room._startTimer);
        room.status = 'playing';
        startRound(room);
    });

    socket.on('playTile', ({ roomId, tile, side }) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.index !== room.turn) return;
        if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }
        if (room.aiTimeout)     { clearTimeout(room.aiTimeout);      room.aiTimeout     = null; }
        if (executeMove(room, player.index, tile, side) && room.status === 'playing')
            startTimer(roomId);
    });

    socket.on('drawTile', roomId => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.index !== room.turn) return;
        if (!room.boneyard.length) return;

        // Draw up to 3 tiles or until playable
        let drawn = 0;
        const board = room.board;
        while (room.boneyard.length > 0 && drawn < 3) {
            room.hands[player.index].push(room.boneyard.pop());
            drawn++;
            const newTile = room.hands[player.index][room.hands[player.index].length - 1];
            const sides = board.getPlayableSides(newTile, board.isEmpty());
            if (sides.length) break; // Got a playable tile, stop drawing
        }
        io.to(roomId).emit('gameStateUpdate', buildState(room));
    });

    socket.on('passTurn', roomId => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.index !== room.turn) return;

        // Only allow pass if no moves and no boneyard
        const board = room.board;
        const hand = room.hands[player.index];
        const canPlay = hand.some(t => board.getPlayableSides(t, board.isEmpty()).length > 0);
        if (canPlay || room.boneyard.length > 0) return;

        if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }
        if (room.aiTimeout)     { clearTimeout(room.aiTimeout);      room.aiTimeout     = null; }

        // Track consecutive passes — only declare pitus after all 4 pass in a row
        room.passCount = (room.passCount || 0) + 1;
        if (room.passCount >= 4) {
            // All 4 players passed consecutively = true buntu
            endRound(room, null, true);
            return;
        }
        // Otherwise just move to the next player — game continues!
        nextTurn(room);
        if (room.status === 'playing') startTimer(roomId);
    });

    socket.on('nextRound', roomId => {
        const room = rooms[roomId];
        if (!room || room.status !== 'round-end') return;
        // Any player can trigger next round
        room.status = 'starting';
        setTimeout(() => {
            if (rooms[roomId]) startRound(rooms[roomId]);
        }, 300);
    });

    socket.on('disconnect', () => {
        Object.values(rooms).forEach(room => {
            const idx = room.players.findIndex(p => p.id === socket.id);
            if (idx !== -1) {
                const playerName = room.players[idx].name;
                room.players.splice(idx, 1);
                io.to(room.id).emit('updateLobby', room.players);
                io.to(room.id).emit('playerLeft', { name: playerName });

                // If game was playing and no human players left, clean up
                if (room.players.length === 0) {
                    if (room.timerInterval) clearInterval(room.timerInterval);
                    if (room.aiTimeout) clearTimeout(room.aiTimeout);
                    if (room._startTimer) clearTimeout(room._startTimer);
                    delete rooms[room.id];
                }
            }
        });
    });
});

function joinRoom(socket, room, name) {
    const index = room.players.length; // 0–3
    room.players.push({ id: socket.id, name, index });
    socket.join(room.id);
    socket.emit('roomJoined', {
        roomId: room.id,
        playerIndex: index,
        isHost: index === 0,
        isPublic: room.isPublic,
        playerCount: room.players.length,
    });
    io.to(room.id).emit('updateLobby', room.players);
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Domino server → http://0.0.0.0:${PORT}`);
});

module.exports = server;
