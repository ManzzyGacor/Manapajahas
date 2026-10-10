// ==========================================================
// ⚡ VARESA POCKET MONSTERS (RETRO POKEMON STYLE RPG)
// Command: .pokemon / .mon / .gamepokemon
// Auto-delete after 3 minutes to keep chat clean.
// ==========================================================

import { randomUUID } from 'crypto';

async function handle(sock, messageInfo) {
    const { remoteJid, sender, command } = messageInfo;

    const userSender = sender || remoteJid;
    const user = global.db?.data?.users?.[userSender];
    if (user) {
        // Hadiah uang kecil 1-20 sesuai request
        user.exp = (user.exp || 0) + 50;
        const rewardMoney = Math.floor(Math.random() * 20) + 1;
        user.money = (user.money || 0) + rewardMoney;
    }

    const html = `\
<style>
* {
    box-sizing: border-box;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    touch-action: manipulation;
}

html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    min-height: 100%;
    background: #0b0a12;
    background: linear-gradient(180deg, #171525 0%, #0b0a12 100%);
    color: #fff;
    font-family: 'Courier New', Courier, monospace;
    overflow-x: hidden;
}

.wrap {
    width: 100%;
    max-width: 380px;
    margin: 0 auto;
    padding: 12px;
}

.header {
    text-align: center;
    margin-bottom: 10px;
}

.brand {
    font-size: 8px;
    letter-spacing: 2px;
    color: #77748c;
    font-weight: 900;
}

.title {
    font-size: 20px;
    font-weight: 900;
    color: #f1c40f;
    text-shadow: 0 0 10px rgba(241, 196, 15, 0.4);
    margin-top: 2px;
}

.game-screen {
    position: relative;
    width: 100%;
    height: 240px;
    background: #111;
    border: 3px solid #332d52;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 0 20px rgba(105, 87, 229, 0.2);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 10px;
}

.battle-view {
    display: none;
    height: 100%;
    flex-direction: column;
    justify-content: space-between;
}

.battle-view.active {
    display: flex;
}

.world-view {
    display: flex;
    height: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
}

.world-view.hidden {
    display: none;
}

.stat-box {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 11px;
    width: 100%;
}

.enemy-area, .player-area {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.monster-avatar {
    font-size: 45px;
    text-align: center;
    filter: drop-shadow(0 0 8px rgba(255,255,255,0.2));
}

.hp-bar-container {
    width: 110px;
    background: #444;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    margin-top: 4px;
    border: 1px solid #666;
}

.hp-bar {
    width: 100%;
    height: 100%;
    background: #2ecc71;
    transition: width 0.3s ease;
}

.console-box {
    background: #000;
    border: 2px solid #5541c5;
    border-radius: 6px;
    padding: 8px;
    font-size: 11px;
    min-height: 55px;
    color: #00cec9;
    line-height: 1.4;
}

.controls {
    margin-top: 12px;
    display: grid;
    gap: 8px;
}

.world-controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
}

.battle-controls {
    display: none;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
}

.battle-controls.active {
    display: grid;
}

.btn {
    background: linear-gradient(135deg, #8b79ff, #5b47cf);
    border: none;
    color: white;
    padding: 12px;
    font-size: 11px;
    font-weight: 900;
    border-radius: 8px;
    cursor: pointer;
    box-shadow: 0 4px 10px rgba(105, 87, 229, 0.3);
    font-family: 'Courier New', Courier, monospace;
}

.btn:active {
    transform: scale(0.96);
}

.btn-danger {
    background: linear-gradient(135deg, #ff7675, #d63031);
    box-shadow: 0 4px 10px rgba(214, 48, 49, 0.3);
}

.btn-warning {
    background: linear-gradient(135deg, #fdcb6e, #e17055);
    box-shadow: 0 4px 10px rgba(225, 112, 85, 0.3);
    color: #111;
}
</style>

<div class="wrap">
    <div class="header">
        <div class="brand">MANZZYID POCKET MONSTERS</div>
        <div class="title">VARESA MON</div>
    </div>

    <div class="game-screen">
        <div class="world-view" id="world-view">
            <div style="font-size: 40px; margin-bottom: 8px;">🌲🏕️🌿</div>
            <div style="font-size: 12px; color: #a29bfe; font-weight: bold;">Varesa Route 1</div>
            <div style="font-size: 10px; color: #77748c; margin-top: 4px;">Jelajahi semak-semak untuk mencari monster liar!</div>
        </div>

        <div class="battle-view" id="battle-view">
            <div class="stat-box">
                <div style="display:flex; justify-content:space-between;">
                    <span id="enemy-name">Wild Varesamon</span>
                    <span>Lv.<span id="enemy-lvl">5</span></span>
                </div>
                <div class="hp-bar-container"><div class="hp-bar" id="enemy-hp"></div></div>
            </div>

            <div style="display:flex; justify-content:space-around; align-items:center;">
                <div class="monster-avatar" id="enemy-avatar">🦊</div>
                <div style="font-size: 16px; color: #5541c5; font-weight: bold;">VS</div>
                <div class="monster-avatar" id="player-avatar">🐲</div>
            </div>

            <div class="stat-box">
                <div style="display:flex; justify-content:space-between;">
                    <span>Varesadrake (You)</span>
                    <span>Lv.<span id="player-lvl">5</span></span>
                </div>
                <div class="hp-bar-container"><div class="hp-bar" id="player-hp"></div></div>
            </div>
        </div>
    </div>

    <div class="console-box" id="console-text" style="margin-top: 8px;">
        Selamat datang di dunia Varesa Mon! Pilih 'Jelajah' untuk mulai berpetualang.
    </div>

    <div class="controls">
        <div class="world-controls" id="world-controls">
            <button class="btn" id="btn-explore">🌿 JELAJAH RUMPUT</button>
            <button class="btn btn-warning" id="btn-heal">💊 PULIHKAN HP</button>
        </div>

        <div class="battle-controls" id="battle-controls">
            <button class="btn" id="btn-attack">⚔️ SERANG</button>
            <button class="btn btn-warning" id="btn-skill">🔥 SPECIAL SKILL</button>
            <button class="btn btn-danger" id="btn-run">🏃‍♂️ LARI</button>
        </div>
    </div>
</div>

<script>
(function() {
    const player = { name: "Varesadrake", lvl: 5, maxHp: 50, hp: 50, avatar: "🐲" };
    const monsters = [
        { name: "PikAVAR", lvl: 4, maxHp: 40, hp: 40, avatar: "⚡" },
        { name: "Bulbavars", lvl: 5, maxHp: 45, hp: 45, avatar: "🌱" },
        { name: "Charmarsh", lvl: 6, maxHp: 55, hp: 55, avatar: "🔥" }
    ];
    let currentEnemy = null;
    let isTurn = true;

    const worldView = document.getElementById('world-view');
    const battleView = document.getElementById('battle-view');
    const worldControls = document.getElementById('world-controls');
    const battleControls = document.getElementById('battle-controls');
    const consoleText = document.getElementById('console-text');

    const enemyName = document.getElementById('enemy-name');
    const enemyLvl = document.getElementById('enemy-lvl');
    const enemyHp = document.getElementById('enemy-hp');
    const enemyAvatar = document.getElementById('enemy-avatar');

    const playerHp = document.getElementById('player-hp');
    const playerLvl = document.getElementById('player-lvl');

    function log(msg) {
        consoleText.innerText = msg;
    }

    function updateHP() {
        playerHp.style.width = Math.max(0, (player.hp / player.maxHp) * 100) + '%';
        if (currentEnemy) {
            enemyHp.style.width = Math.max(0, (currentEnemy.hp / currentEnemy.maxHp) * 100) + '%';
        }
    }

    function startExplore() {
        if (player.hp <= 0) {
            log("HP-mu habis! Pulihkan dulu di tombol PULIHKAN HP.");
            return;
        }

        const rand = Math.random();
        if (rand < 0.7) {
            const template = monsters[Math.floor(Math.random() * monsters.length)];
            currentEnemy = { ...template, hp: template.maxHp };
            
            enemyName.innerText = currentEnemy.name;
            enemyLvl.innerText = currentEnemy.lvl;
            enemyAvatar.innerText = currentEnemy.avatar;
            
            worldView.classList.add('hidden');
            battleView.classList.add('active');
            worldControls.style.display = 'none';
            battleControls.classList.add('active');

            updateHP();
            log("Seekor " + currentEnemy.name + " liar muncul menyerang!");
            isTurn = true;
        } else {
            log("Kamu menyusuri semak-semak, tapi tidak ada monster yang muncul...");
        }
    }

    function playerAttack(isSpecial = false) {
        if (!isTurn || !currentEnemy) return;
        isTurn = false;

        let dmg = isSpecial ? Math.floor(Math.random() * 12) + 15 : Math.floor(Math.random() * 8) + 8;
        if (isSpecial) dmg += player.lvl * 2;

        currentEnemy.hp -= dmg;
        updateHP();
        log("Kamu menyerang " + currentEnemy.name + " dan memberikan " + dmg + " damage!");

        if (currentEnemy.hp <= 0) {
            setTimeout(() => {
                log("🏆 Menang! " + currentEnemy.name + " liar berhasil dikalahkan!");
                endBattle();
            }, 1000);
            return;
        }

        setTimeout(enemyTurn, 1200);
    }

    function enemyTurn() {
        if (!currentEnemy) return;
        let edmg = Math.floor(Math.random() * 6) + 6;
        player.hp -= edmg;
        updateHP();
        log(currentEnemy.name + " membalas menyerangmu sebesar " + edmg + " damage!");

        if (player.hp <= 0) {
            setTimeout(() => {
                log("💀 Kamu kalah! Pingsan di tengah jalan...");
                endBattle();
            }, 1000);
            return;
        }
        isTurn = true;
    }

    function endBattle() {
        setTimeout(() => {
            currentEnemy = null;
            battleView.classList.remove('active');
            worldView.classList.remove('hidden');
            battleControls.classList.remove('active');
            worldControls.style.display = 'grid';
            log("Jelajahi kembali rumput liar atau pulihkan HP.");
        }, 2000);
    }

    function healPlayer() {
        player.hp = player.maxHp;
        updateHP();
        log("✨ HP-mu telah dipulihkan secara penuh! Siap bertarung lagi.");
    }

    document.getElementById('btn-explore').addEventListener('click', startExplore);
    document.getElementById('btn-heal').addEventListener('click', healPlayer);
    document.getElementById('btn-attack').addEventListener('click', () => playerAttack(false));
    document.getElementById('btn-skill').addEventListener('click', () => playerAttack(true));
    document.getElementById('btn-run').addEventListener('click', () => {
        log("Berhasil kabur dari pertempuran!");
        endBattle();
    });

    updateHP();
})();
<\/script>`;

    const responseId = "ManzzyID-pokemon-" + Date.now();

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
                                messageText: "ManzzyID • VARESA POCKET MONSTERS"
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
  Commands: ["pokemon", "mon", "gamepokemon", "pocketmon"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 0,
};