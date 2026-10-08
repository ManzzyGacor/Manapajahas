// ==========================================================
// 🧱 ManzzyID VARESA BLOCK (RETRO TETRIS) - DOM HTML
// Command: .tetris / .varesablock
// Auto-delete after 3 minutes to keep chat clean.
// ==========================================================

import { randomUUID } from 'crypto';

async function handle(sock, messageInfo) {
    const { remoteJid, sender, command } = messageInfo;

    const userSender = sender || remoteJid;
    const user = global.db?.data?.users?.[userSender];
    if (user) {
        user.exp = (user.exp || 0) + 100;
        user.coin = (user.coin || 0) + 150;
    }

    const html = String.raw`<style>
* {
    box-sizing: border-box;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    touch-action: none;
}

html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    min-height: 100%;
    background: #0b0a12;
    background: linear-gradient(180deg, #171525 0%, #0b0a12 100%);
    color: #fff;
    font-family: Arial, sans-serif;
    overflow-x: hidden;
}

.wrap {
    width: 100%;
    max-width: 380px;
    margin: 0 auto;
    padding: 15px 10px;
}

.header {
    text-align: center;
    margin-bottom: 12px;
}

.brand {
    font-size: 9px;
    letter-spacing: 2px;
    color: #77748c;
    font-weight: 900;
}

.title {
    font-size: 22px;
    font-weight: 900;
    color: #fff;
    text-shadow: 0 0 10px rgba(108, 92, 231, 0.6);
    margin-top: 2px;
}

.stats {
    display: flex;
    justify-content: space-between;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 10px;
    margin-bottom: 15px;
}

.stat-box {
    text-align: center;
    flex: 1;
}

.stat-label {
    font-size: 8px;
    color: #77748c;
    font-weight: 900;
    letter-spacing: 1px;
}

.stat-value {
    font-size: 16px;
    font-weight: 900;
    color: #63daf5;
    margin-top: 4px;
}

.game-container {
    position: relative;
    width: 200px;
    height: 400px;
    margin: 0 auto;
    background: #000;
    border: 3px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    box-shadow: 0 0 25px rgba(105, 87, 229, 0.2);
}

.board {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    grid-template-rows: repeat(20, 1fr);
    width: 100%;
    height: 100%;
    gap: 1px;
    background: #222;
}

.cell {
    width: 100%;
    height: 100%;
    background: #111;
    border-radius: 1px;
}

.c1 { background: #00cec9; box-shadow: inset 0 0 6px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); }
.c2 { background: #0984e3; box-shadow: inset 0 0 6px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); }
.c3 { background: #e17055; box-shadow: inset 0 0 6px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); }
.c4 { background: #fdcb6e; box-shadow: inset 0 0 6px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); }
.c5 { background: #00b894; box-shadow: inset 0 0 6px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); }
.c6 { background: #6c5ce7; box-shadow: inset 0 0 6px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); }
.c7 { background: #d63031; box-shadow: inset 0 0 6px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); }

.overlay {
    position: absolute;
    inset: 0;
    background: rgba(11, 10, 18, 0.85);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    border-radius: 4px;
    z-index: 10;
}

.overlay.hidden {
    display: none;
}

.msg {
    font-size: 20px;
    font-weight: 900;
    color: #fff;
    margin-bottom: 5px;
}

.sub-msg {
    font-size: 10px;
    color: #a29bfe;
    margin-bottom: 18px;
}

.btn-start {
    background: linear-gradient(135deg, #8b79ff, #5b47cf);
    border: none;
    color: white;
    padding: 10px 20px;
    font-size: 12px;
    font-weight: 900;
    border-radius: 8px;
    box-shadow: 0 5px 15px rgba(105, 87, 229, 0.4);
    cursor: pointer;
}

.btn-start:active {
    transform: scale(0.95);
}

.controls {
    margin: 15px auto 0;
    width: 200px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: auto auto;
    gap: 8px;
}

.ctrl-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: white;
    font-size: 18px;
    border-radius: 8px;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 45px;
    cursor: pointer;
}

.ctrl-btn:active {
    background: rgba(255, 255, 255, 0.15);
    transform: translateY(2px);
}

.btn-up { grid-column: 2; grid-row: 1; background: rgba(108, 92, 231, 0.2); border-color: #6c5ce7; }
.btn-left { grid-column: 1; grid-row: 2; }
.btn-down { grid-column: 2; grid-row: 2; }
.btn-right { grid-column: 3; grid-row: 2; }
.btn-drop { 
    grid-column: 1 / 4; 
    margin-top: 4px; 
    background: rgba(214, 48, 49, 0.2); 
    border-color: #d63031; 
    color: #ff7675; 
    height: 35px; 
    font-size: 12px; 
    font-weight: 900; 
}
</style>

<div class="wrap">
    <div class="header">
        <div class="brand">MANZZYID GAME CENTER</div>
        <div class="title">VARESA BLOCK</div>
    </div>

    <div class="stats">
        <div class="stat-box">
            <div class="stat-label">SCORE</div>
            <div class="stat-value" id="score">0</div>
        </div>
        <div class="stat-box">
            <div class="stat-label">LEVEL</div>
            <div class="stat-value" id="level">1</div>
        </div>
        <div class="stat-box">
            <div class="stat-label">LINES</div>
            <div class="stat-value" id="lines">0</div>
        </div>
    </div>

    <div class="game-container">
        <div class="board" id="board"></div>
        <div class="overlay" id="overlay">
            <div class="msg" id="overlay-msg">READY?</div>
            <div class="sub-msg" id="overlay-sub">Clear lines to score points!</div>
            <button class="btn-start" id="start-btn">PLAY NOW</button>
        </div>
    </div>

    <div class="controls">
        <div class="ctrl-btn btn-up" id="btn-up">↻</div>
        <div class="ctrl-btn btn-left" id="btn-left">◁</div>
        <div class="ctrl-btn btn-down" id="btn-down">▽</div>
        <div class="ctrl-btn btn-right" id="btn-right">▷</div>
        <div class="ctrl-btn btn-drop" id="btn-drop">HARD DROP</div>
    </div>
</div>

<script>
(function() {
    const boardEl = document.getElementById('board');
    const scoreEl = document.getElementById('score');
    const levelEl = document.getElementById('level');
    const linesEl = document.getElementById('lines');
    const overlay = document.getElementById('overlay');
    const overlayMsg = document.getElementById('overlay-msg');
    const overlaySub = document.getElementById('overlay-sub');
    const startBtn = document.getElementById('start-btn');

    const cells = [];
    for (let i = 0; i < 200; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        boardEl.appendChild(cell);
        cells.push(cell);
    }

    const pieces = 'ILJOTSZ';
    function createPiece(type) {
        if (type === 'I') return [[0,1,0,0], [0,1,0,0], [0,1,0,0], [0,1,0,0]];
        if (type === 'L') return [[0,2,0], [0,2,0], [0,2,2]];
        if (type === 'J') return [[0,3,0], [0,3,0], [3,3,0]];
        if (type === 'O') return [[4,4], [4,4]];
        if (type === 'T') return [[0,0,0], [5,5,5], [0,5,0]];
        if (type === 'S') return [[0,6,6], [6,6,0], [0,0,0]];
        if (type === 'Z') return [[7,7,0], [0,7,7], [0,0,0]];
    }

    function createMatrix(w, h) {
        const matrix = [];
        while (h--) { matrix.push(new Array(w).fill(0)); }
        return matrix;
    }

    const arena = createMatrix(10, 20);
    const player = { pos: {x: 0, y: 0}, matrix: null, score: 0, lines: 0, level: 1 };
    
    let dropCounter = 0;
    let dropInterval = 1000;
    let lastTime = Date.now();
    let isPlaying = false;
    let gameTicker = null;

    function draw() {
        for (let i = 0; i < 200; i++) {
            cells[i].className = 'cell';
        }
        
        arena.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    cells[y * 10 + x].classList.add('c' + value);
                }
            });
        });

        if (player.matrix) {
            player.matrix.forEach((row, y) => {
                row.forEach((value, x) => {
                    if (value !== 0) {
                        const currentY = y + player.pos.y;
                        const currentX = x + player.pos.x;
                        if (currentY >= 0 && currentY < 20 && currentX >= 0 && currentX < 10) {
                            cells[currentY * 10 + currentX].classList.add('c' + value);
                        }
                    }
                });
            });
        }
    }

    function merge(arena, player) {
        player.matrix.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    arena[y + player.pos.y][x + player.pos.x] = value;
                }
            });
        });
    }

    function collide(arena, player) {
        const m = player.matrix;
        const o = player.pos;
        for (let y = 0; y < m.length; ++y) {
            for (let x = 0; x < m[y].length; ++x) {
                if (m[y][x] !== 0 && (arena[y + o.y] && arena[y + o.y][x + o.x]) !== 0) {
                    return true;
                }
            }
        }
        return false;
    }

    function playerReset() {
        player.matrix = createPiece(pieces[Math.floor(Math.random() * pieces.length)]);
        player.pos.y = 0;
        player.pos.x = Math.floor((arena[0].length / 2) - (player.matrix[0].length / 2));
        
        if (collide(arena, player)) {
            gameOver();
        }
    }

    function playerDrop() {
        if(!isPlaying) return;
        player.pos.y++;
        if (collide(arena, player)) {
            player.pos.y--;
            merge(arena, player);
            playerReset();
            arenaSweep();
        }
        dropCounter = 0;
        draw();
    }

    function playerHardDrop() {
        if(!isPlaying) return;
        while (!collide(arena, player)) {
            player.pos.y++;
        }
        player.pos.y--;
        merge(arena, player);
        playerReset();
        arenaSweep();
        dropCounter = 0;
        draw();
    }

    function playerMove(offset) {
        if(!isPlaying) return;
        player.pos.x += offset;
        if (collide(arena, player)) {
            player.pos.x -= offset;
        }
        draw();
    }

    function playerRotate() {
        if(!isPlaying) return;
        const pos = player.pos.x;
        let offset = 1;
        rotate(player.matrix);
        while (collide(arena, player)) {
            player.pos.x += offset;
            offset = -(offset + (offset > 0 ? 1 : -1));
            if (offset > player.matrix[0].length) {
                rotate(player.matrix, -1);
                player.pos.x = pos;
                return;
            }
        }
        draw();
    }

    function rotate(matrix, dir = 1) {
        for (let y = 0; y < matrix.length; ++y) {
            for (let x = 0; x < y; ++x) {
                [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
            }
        }
        if (dir > 0) matrix.forEach(row => row.reverse());
        else matrix.reverse();
    }

    function arenaSweep() {
        let rowCount = 1;
        outer: for (let y = arena.length -1; y > 0; --y) {
            for (let x = 0; x < arena[y].length; ++x) {
                if (arena[y][x] === 0) continue outer;
            }
            const row = arena.splice(y, 1)[0].fill(0);
            arena.unshift(row);
            ++y;
            
            player.score += rowCount * 100;
            player.lines += 1;
            rowCount *= 2;
        }
        
        player.level = Math.floor(player.lines / 10) + 1;
        dropInterval = Math.max(100, 1000 - (player.level - 1) * 100);
        updateScore();
    }

    function updateScore() {
        scoreEl.innerText = player.score;
        levelEl.innerText = player.level;
        linesEl.innerText = player.lines;
    }

    function gameLoop() {
        if (!isPlaying) return;
        const now = Date.now();
        const deltaTime = now - lastTime;
        lastTime = now;
        
        dropCounter += deltaTime;
        if (dropCounter > dropInterval) {
            playerDrop();
        }
    }

    function gameOver() {
        isPlaying = false;
        if (gameTicker) clearInterval(gameTicker);
        overlayMsg.innerText = "GAME OVER";
        overlayMsg.style.color = "#ff7675";
        overlaySub.innerText = "Final Score: " + player.score;
        startBtn.innerText = "PLAY AGAIN";
        overlay.classList.remove('hidden');
    }

    function startGame() {
        arena.forEach(row => row.fill(0));
        player.score = 0;
        player.lines = 0;
        player.level = 1;
        dropInterval = 1000;
        updateScore();
        playerReset();
        
        overlay.classList.add('hidden');
        isPlaying = true;
        
        lastTime = Date.now();
        if (gameTicker) clearInterval(gameTicker);
        gameTicker = setInterval(gameLoop, 1000 / 30);
        draw();
    }

    function bindBtn(id, action) {
        const el = document.getElementById(id);
        if (!el) return;
        const trigger = (e) => { e.preventDefault(); action(); };
        el.addEventListener('touchstart', trigger, {passive: false});
        el.addEventListener('mousedown', trigger);
    }

    bindBtn('btn-left', () => playerMove(-1));
    bindBtn('btn-right', () => playerMove(1));
    bindBtn('btn-down', () => playerDrop());
    bindBtn('btn-up', () => playerRotate());
    bindBtn('btn-drop', () => playerHardDrop());

    startBtn.addEventListener('click', startGame);
    startBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startGame(); }, {passive: false});

    updateScore();
    draw();
})();
</script>`;

    const responseId = "ManzzyID-tetris-" + Date.now();

    const sentMessage = await sock.relayMessage(
        remoteJid,
        {
            messageContextInfo: {
                deviceListMetadata: {},
                deviceListMetadataVersion: 2,
                messageSecret: "0cCzjnQ5ERoqM2QrQ7KjmMfxsyeWYu+61/chr2wioyE=",
                botMetadata: {
                    messageDisclaimerText: "",
                    botResponseId: responseId
                }
            },
            botForwardedMessage: {
                message: {
                    richResponseMessage: {
                        messageType: 1,
                        submessages: [
                            {
                                messageType: 2,
                                messageText: "ManzzyID • VARESA BLOCK"
                            }
                        ],
                        unifiedResponse: {
                            data: Buffer.from(
                                JSON.stringify({
                                    response_id: responseId,
                                    sections: [
                                        {
                                            view_model: {
                                                primitive: {
                                                    __typename: "GenAIaeacdsnwHtmlPrimitive",
                                                    payload: html,
                                                    trusted_sources: ["manzzy.web.id"]
                                                },
                                                __typename: "GenAISingleLayoutViewModel"
                                            }
                                        }
                                    ]
                                })
                            ).toString("base64")
                        },
                        contextInfo: {
                            mentionedJid: [],
                            groupMentions: [],
                            statusAttributions: [],
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedAiBotMessageInfo: {
                                botJid: "867051314767696@bot"
                            },
                            forwardOrigin: 4
                        }
                    }
                }
            }
        },
        { messageId: responseId }
    );

    // Auto-delete setelah 3 menit (180,000 milidetik)
    setTimeout(async () => {
        try {
            await sock.sendMessage(remoteJid, {
                delete: {
                    remoteJid: remoteJid,
                    fromMe: true,
                    id: responseId
                }
            });
        } catch (e) {}
    }, 3 * 60 * 1000);
}

export default {
  handle,
  Commands: ["tetris"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 0,
};