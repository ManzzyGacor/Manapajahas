// ==========================================================
// 🐾 VARESA CAT CO-OP (PICO PARK STYLE)
// Command: .catcoop / .picopark
// Physics Fixed • Multi-Level System • Wide Goal
// ==========================================================

import { randomUUID } from 'crypto';

async function handle(sock, messageInfo) {
    const { remoteJid, sender, command } = messageInfo;

    const userSender = sender || remoteJid;
    const user = global.db?.data?.users?.[userSender];
    
    if (user) {
        user.exp = (user.exp || 0) + 30;
        const rewardMoney = Math.floor(Math.random() * 20) + 1; 
        user.money = (user.money || 0) + rewardMoney;
    }

    const html = `\
<style>
* {
    box-sizing: border-box;
    user-select: none;
    touch-action: none;
    margin: 0; padding: 0;
}
body {
    width: 100%;
    background: #ffffff; 
    color: #333;
    font-family: 'Courier New', Courier, monospace;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
}
.wrap {
    width: 100%;
    max-width: 480px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
}
.header {
    text-align: center;
    margin-bottom: 8px;
    width: 100%;
}
.title {
    font-size: 20px;
    font-weight: 900;
    color: #ff964f;
    text-transform: uppercase;
    text-shadow: 1px 1px 0px rgba(0,0,0,0.1);
}
.subtitle {
    font-size: 10px;
    color: #888;
    margin-top: 2px;
}
.game-container {
    width: 100%;
    position: relative;
    border: 3px solid #ff964f;
    border-radius: 8px;
    background: #fff;
    overflow: hidden;
    box-shadow: 0 4px 10px rgba(255, 150, 79, 0.2);
}
canvas {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 16 / 9;
    background: #ffffff;
}
.controls {
    margin-top: 10px;
    display: flex;
    justify-content: space-between;
    width: 100%;
    padding: 0 5px;
}
.ctrl-group {
    display: flex;
    gap: 10px;
}
.ctrl-btn {
    background: #f1f2f6;
    border: 2px solid #ced6e0;
    color: #2f3542;
    font-size: 24px;
    width: 65px;
    height: 50px;
    border-radius: 10px;
    font-weight: bold;
    display: flex;
    justify-content: center;
    align-items: center;
    box-shadow: 0 4px 0 #ced6e0;
}
.ctrl-btn:active, .ctrl-btn.pressed {
    transform: translateY(4px);
    box-shadow: 0 0 0 #ced6e0;
    background: #dfe4ea;
}
.overlay {
    position: absolute;
    inset: 0;
    background: rgba(255,255,255,0.95);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    z-index: 10;
}
.hidden { display: none !important; }

/* LOBBY UI */
input {
    width: 85%;
    padding: 10px;
    margin: 5px 0;
    background: #f1f2f6;
    border: 2px solid #ced6e0;
    color: #2f3542;
    border-radius: 8px;
    text-align: center;
    font-family: inherit;
    font-weight: bold;
    font-size: 14px;
}
.btn-start {
    background: #ff964f;
    border: none;
    color: white;
    padding: 12px 24px;
    font-size: 16px;
    font-weight: 900;
    border-radius: 8px;
    cursor: pointer;
    box-shadow: 0 4px 0 #e17055;
    margin-top: 10px;
}
.btn-start:active {
    transform: translateY(4px);
    box-shadow: 0 0 0 #e17055;
}
.wait-text {
    font-size: 16px;
    font-weight: bold;
    color: #3742fa;
    margin: 10px 0;
}
.count-text {
    font-size: 28px;
    font-weight: 900;
    color: #ff4757;
}
</style>

<div class="wrap">
    <div class="header">
        <div class="title">🐾 VARESA PARK</div>
        <div class="subtitle" id="top-status">Real-Time Multiplayer Room</div>
    </div>

    <div class="game-container" id="game-container">
        <canvas id="gameCanvas" width="640" height="360"></canvas>
        
        <div class="overlay" id="join-screen">
            <h2 style="color: #ff964f; margin-bottom: 8px;">JOIN SERVER</h2>
            <input type="text" id="inp-name" placeholder="Nama Kamu (Max 6)" maxlength="6">
            <input type="number" id="inp-room" placeholder="Kode Room (Angka)">
            <button class="btn-start" id="btn-join">MASUK LOBBY</button>
        </div>

        <div class="overlay hidden" id="wait-screen">
            <h2 style="color: #2f3542;">ROOM: <span id="disp-room">---</span></h2>
            <div class="wait-text">Menunggu Pemain...</div>
            <div class="count-text"><span id="player-count">1</span> / 3</div>
            <p style="font-size: 10px; color: #747d8c; margin-top: 15px; text-align: center;">
                Game otomatis mulai saat 3 orang terkumpul.<br>Ajak temanmu ketik .catcoop!
            </p>
        </div>
    </div>

    <div class="controls">
        <div class="ctrl-group">
            <button class="ctrl-btn" id="btn-left">◀</button>
            <button class="ctrl-btn" id="btn-right">▶</button>
        </div>
        <button class="ctrl-btn" id="btn-up">▲</button>
    </div>
</div>

<script>
(function() {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    
    const joinScreen = document.getElementById('join-screen');
    const waitScreen = document.getElementById('wait-screen');
    const btnJoin = document.getElementById('btn-join');
    const inpName = document.getElementById('inp-name');
    const inpRoom = document.getElementById('inp-room');
    const pCountDisplay = document.getElementById('player-count');
    const dispRoom = document.getElementById('disp-room');
    const topStatus = document.getElementById('top-status');

    let ws = null;
    let isPlaying = false;
    let animFrame = null; 
    let myName = "";
    let myRoom = "";
    let myIndex = -1; 
    let currentLevel = 1;

    const catSize = 24;
    const maxLeash = 120; 

    let players = [
        { x: 30, y: 280, vx: 0, vy: 0, color: '#7bed9f', name: 'Wait..' },
        { x: 70, y: 280, vx: 0, vy: 0, color: '#70a1ff', name: 'Wait..' },
        { x: 110, y: 280, vx: 0, vy: 0, color: '#ff7f50', name: 'Wait..' }
    ];

    let platforms = [];
    let goal = { x: 0, y: 0, w: 0, h: 0 }; 

    function loadLevel(level) {
        // Tembok luar (Tetap ada di semua level)
        platforms = [
            { x: -50, y: 0, w: 50, h: 400 }, 
            { x: 640, y: 0, w: 50, h: 400 },
        ];

        if (level === 1) {
            platforms.push({ x: 0, y: 340, w: 220, h: 20 });
            platforms.push({ x: 320, y: 340, w: 320, h: 20 });
            platforms.push({ x: 220, y: 260, w: 70, h: 20 });
            platforms.push({ x: 100, y: 190, w: 80, h: 20 });
            platforms.push({ x: 250, y: 130, w: 80, h: 20 });
            platforms.push({ x: 420, y: 200, w: 90, h: 20 });
            platforms.push({ x: 350, y: 0, w: 20, h: 100 });
            platforms.push({ x: 480, y: 280, w: 30, h: 60 });
            
            // Goal lebih lebar agar muat 3 pemain (Width 100)
            goal = { x: 520, y: 290, w: 100, h: 50 }; 
        } 
        else if (level === 2) {
            platforms.push({ x: 0, y: 340, w: 150, h: 20 });
            platforms.push({ x: 450, y: 340, w: 200, h: 20 });
            platforms.push({ x: 180, y: 280, w: 60, h: 20 });
            platforms.push({ x: 300, y: 210, w: 80, h: 20 });
            platforms.push({ x: 120, y: 150, w: 100, h: 20 });
            platforms.push({ x: 420, y: 120, w: 80, h: 20 });
            platforms.push({ x: 300, y: 0, w: 40, h: 120 });
            
            goal = { x: 520, y: 290, w: 100, h: 50 };
        }
        else {
            // Level 3 / Custom Infinity
            platforms.push({ x: 0, y: 340, w: 100, h: 20 });
            platforms.push({ x: 500, y: 340, w: 140, h: 20 });
            platforms.push({ x: 150, y: 260, w: 50, h: 20 });
            platforms.push({ x: 250, y: 180, w: 50, h: 20 });
            platforms.push({ x: 350, y: 100, w: 50, h: 20 });
            platforms.push({ x: 450, y: 200, w: 40, h: 20 });
            
            goal = { x: 520, y: 290, w: 100, h: 50 };
        }
    }

    function resetPositions() {
        players[0].x = 30; players[0].y = 300;
        players[1].x = 70; players[1].y = 300;
        players[2].x = 110; players[2].y = 300;
        players.forEach(p => { p.vx = 0; p.vy = 0; });
    }

    // ==========================================
    // WEBSOCKET LOGIC 
    // ==========================================
    function connectWS() {
        const wsUrl = 'wss://sewa.manzzy.web.id/ws-picopark'; 

        try {
            ws = new WebSocket(wsUrl);
            ws.onopen = () => { ws.send(JSON.stringify({ type: 'join', room: myRoom, name: myName })); };
            ws.onmessage = (e) => {
                const data = JSON.parse(e.data);
                
                if (data.type === 'joined') { myIndex = data.index; }
                else if(data.type === 'room_state') {
                    pCountDisplay.innerText = data.count;
                    
                    if (data.names && Array.isArray(data.names)) {
                        for(let i = 0; i < data.names.length; i++) {
                            if(players[i]) players[i].name = data.names[i];
                        }
                    }

                    if (data.count < 3 && isPlaying) {
                        alert("Seseorang keluar dari Room. Game ditunda...");
                        isPlaying = false;
                        if(animFrame) cancelAnimationFrame(animFrame);
                        waitScreen.classList.remove('hidden');
                        resetPositions();
                    }

                    if(data.count === 3 && !isPlaying) {
                        startGame();
                    }
                }
                else if (data.type === 'sync' && isPlaying) {
                    if (data.index !== myIndex && data.index >= 0 && data.index < 3) {
                        players[data.index].x = data.x;
                        players[data.index].y = data.y;
                    }
                }
            };
            ws.onerror = () => { alert("Gagal terhubung ke Server WebSocket. Cek CF Tunnel/Port."); };
        } catch(err) {
            alert("Error inisialisasi WebSocket: " + err.message);
        }
    }

    btnJoin.addEventListener('click', () => {
        const valName = inpName.value.trim() || 'Player';
        const valRoom = inpRoom.value.trim();
        
        if (!valRoom) return alert("Kode Room wajib diisi!");

        myName = valName;
        myRoom = valRoom;
        
        dispRoom.innerText = myRoom;
        joinScreen.classList.add('hidden');
        waitScreen.classList.remove('hidden');

        connectWS();
    });

    // ==========================================
    // GAME ENGINE & CONTROLS
    // ==========================================
    function startGame() {
        waitScreen.classList.add('hidden');
        isPlaying = true;
        topStatus.innerText = "Level " + currentLevel + " - Ayo Maju!";
        loadLevel(currentLevel);
        resetPositions();
        
        if(animFrame) cancelAnimationFrame(animFrame);
        loop();
    }

    let moveDir = 0;
    let isJumping = false;

    const bindBtn = (id, actDown, actUp) => {
        const el = document.getElementById(id);
        const downHandler = (e) => { e.preventDefault(); el.classList.add('pressed'); actDown(); };
        const upHandler = (e) => { e.preventDefault(); el.classList.remove('pressed'); actUp(); };

        el.addEventListener('touchstart', downHandler, {passive: false});
        el.addEventListener('touchend', upHandler, {passive: false});
        el.addEventListener('touchcancel', upHandler, {passive: false});
        
        el.addEventListener('mousedown', downHandler);
        el.addEventListener('mouseup', upHandler);
        el.addEventListener('mouseleave', upHandler); 
    };

    bindBtn('btn-left', ()=>moveDir=-1, ()=>moveDir=0);
    bindBtn('btn-right', ()=>moveDir=1, ()=>moveDir=0);
    bindBtn('btn-up', ()=>isJumping=true, ()=>isJumping=false);

    function rectIntersect(x1, y1, w1, h1, x2, y2, w2, h2) {
        return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
    }

    function applyPhysics() {
        if (myIndex >= 0 && myIndex < 3) {
            let me = players[myIndex];
            
            // Gunakan akselerasi, biarkan gesekan yang memperlambat
            me.vx += moveDir * 1.5; 
            
            if (isJumping && me.isGrounded) {
                me.vy = -10.5;
                me.isGrounded = false;
                isJumping = false;
            }
        }

        players.forEach((p) => {
            // Friction (Gesekan agar tidak mental-mental & nyangkut)
            p.vx *= 0.85; 
            
            // Batas Kecepatan Maksimal (Velocity Cap)
            if (p.vx > 7) p.vx = 7;
            if (p.vx < -7) p.vx = -7;
            if (p.vy > 12) p.vy = 12;
            if (p.vy < -15) p.vy = -15;

            // Gravitasi
            p.vy += 0.6; 
            
            p.x += p.vx;
            for (let b of platforms) {
                if (rectIntersect(p.x, p.y, catSize, catSize, b.x, b.y, b.w, b.h)) {
                    if (p.vx > 0) { p.x = b.x - catSize; p.vx = 0; } 
                    else if (p.vx < 0) { p.x = b.x + b.w; p.vx = 0; }
                }
            }

            p.y += p.vy;
            p.isGrounded = false;
            for (let b of platforms) {
                if (rectIntersect(p.x, p.y, catSize, catSize, b.x, b.y, b.w, b.h)) {
                    if (p.vy > 0) {
                        p.y = b.y - catSize;
                        p.vy = 0;
                        p.isGrounded = true;
                    } else if (p.vy < 0) {
                        p.y = b.y + b.h;
                        p.vy = 0;
                    }
                }
            }

            if (p.y > 400) { resetPositions(); }
        });

        resolveLeash(players[0], players[1]);
        resolveLeash(players[1], players[2]);

        // Cek Pintu Menang
        let w = 0;
        players.forEach(p => {
            if(rectIntersect(p.x, p.y, catSize, catSize, goal.x, goal.y, goal.w, goal.h)) w++;
        });
        
        // Pindah Level jika ketiga kucing berhasil kumpul di pintu
        if (w === 3) {
            currentLevel++;
            topStatus.innerText = "Level " + currentLevel + " - MANTAP!";
            loadLevel(currentLevel);
            resetPositions();
        }

        if (ws && ws.readyState === 1 && myIndex >= 0) {
            ws.send(JSON.stringify({ 
                type: 'sync', 
                room: myRoom, 
                index: myIndex, 
                x: players[myIndex].x, 
                y: players[myIndex].y 
            }));
        }
    }

    function resolveLeash(pA, pB) {
        let dx = pB.x - pA.x;
        let dy = pB.y - pA.y;
        let dist = Math.hypot(dx, dy);
        
        if (dist > maxLeash) {
            let angle = Math.atan2(dy, dx);
            let excess = dist - maxLeash;
            
            let forceX = Math.cos(angle) * (excess * 0.1);
            let forceY = Math.sin(angle) * (excess * 0.1);
            
            pA.vx += forceX; pA.vy += forceY;
            pB.vx -= forceX; pB.vy -= forceY;
        }
    }

    function drawCatBox(p) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, catSize, catSize);
        ctx.fillRect(p.x, p.y - 5, 7, 5);
        ctx.fillRect(p.x + catSize - 7, p.y - 5, 7, 5);

        ctx.fillStyle = '#000';
        let eyeOffset = p.vx > 0.5 ? 4 : (p.vx < -0.5 ? -4 : 0);
        ctx.fillRect(p.x + 5 + eyeOffset, p.y + 7, 4, 4);
        ctx.fillRect(p.x + 15 + eyeOffset, p.y + 7, 4, 4);

        ctx.fillStyle = '#888';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, p.x + (catSize/2), p.y - 10);
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#ff964f';
        platforms.forEach(b => {
            ctx.fillRect(b.x, b.y, b.w, b.h);
            ctx.fillStyle = '#ffb07c';
            ctx.fillRect(b.x, b.y, b.w, 4);
            ctx.fillStyle = '#ff964f';
        });

        // Pintu yang sudah diperlebar
        ctx.fillStyle = '#f1c40f';
        ctx.fillRect(goal.x, goal.y, goal.w, goal.h);
        ctx.fillStyle = '#fff';
        ctx.font = '14px Courier';
        ctx.textAlign = 'center';
        ctx.fillText("IN", goal.x + (goal.w/2), goal.y + 25);

        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(players[0].x + catSize/2, players[0].y + catSize/2);
        ctx.lineTo(players[1].x + catSize/2, players[1].y + catSize/2);
        ctx.lineTo(players[2].x + catSize/2, players[2].y + catSize/2);
        ctx.stroke();

        players.forEach(p => drawCatBox(p));
    }

    function loop() {
        if (!isPlaying) return;
        applyPhysics();
        draw();
        animFrame = requestAnimationFrame(loop);
    }
})();
</script>
`;

    const responseId = "ManzzyID-catcoop-" + Date.now();

    await sock.relayMessage(
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
                        submessages: [{ messageType: 2, messageText: "ManzzyID • VARESA PARK" }],
                        unifiedResponse: {
                            data: Buffer.from(
                                JSON.stringify({
                                    response_id: responseId,
                                    sections: [{
                                        view_model: {
                                            primitive: {
                                                __typename: "GenAIaeacdsnwHtmlPrimitive",
                                                payload: html,
                                                trusted_sources: ["manzzy.web.id"]
                                            },
                                            __typename: "GenAISingleLayoutViewModel"
                                        }
                                    }]
                                })
                            ).toString("base64")
                        },
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedAiBotMessageInfo: { botJid: "867051314767696@bot" },
                            forwardOrigin: 4
                        }
                    }
                }
            }
        },
        { messageId: responseId }
    );

  /*  setTimeout(async () => {
        try {
            await sock.sendMessage(remoteJid, {
                delete: { remoteJid: remoteJid, fromMe: true, id: responseId }
            });
        } catch (e) {}
    }, 3 * 60 * 1000);*/
}

export default {
  handle,
  Commands: ["catcoop", "picopark"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 0,
};