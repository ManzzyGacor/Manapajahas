import mess from "../../strings.js"; 
import { findUser, updateUser } from "../../lib/users.js"; 
import Blackjack from "../../lib/games/blackjack.js"; 
import {
  addGame,
  removeGame,
  getGame,
  updateGame,
  isGroupPlaying,
  isUserPlaying,
} from "../../database/temporary_db/blackjack.js"; 

const WAKTU_TANTANGAN = 60; // 60 detik
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 Menit
const cooldowns = {};

function formatHand(hand, hideFirst = false) {
  if (hideFirst) {
    return `🃏 [❓], ${hand.slice(1).join(", ")}`;
  }
  return `🃏 ${hand.join(", ")}`;
}

function getGameStatusMessage(gameData, totalP1, totalP2) {
  const { game, player1, player2, bet, currentPlayer, state, mode } = gameData;
  const { total: totalDealer } = game.getHandValue(game.dealerHand);
  
  const isDealerHidden = state !== 'DEALER_TURN' && state !== 'ENDED';
  const dealerHandText = isDealerHidden 
    ? formatHand(game.dealerHand, true) 
    : formatHand(game.dealerHand);

  return `
━━ *♠️ BLACKJACK PVP ♣️* ━━
            Mode: *${mode.toUpperCase()}*

*💰 POT TARUHAN:* *${bet * 2}* Money

*👤 PLAYER 1 (P1):* @${player1.split('@')[0]}
  ${formatHand(game.playerHands[player1])}
  Total: *${totalP1}* ${totalP1 > 21 ? ' (BUST)' : totalP1 === 21 ? ' (BLACKJACK)' : ''}

*👤 PLAYER 2 (P2):* @${player2.split('@')[0]}
  ${formatHand(game.playerHands[player2])}
  Total: *${totalP2}* ${totalP2 > 21 ? ' (BUST)' : totalP2 === 21 ? ' (BLACKJACK)' : ''}

*🤖 DEALER (RUMAH):*
  ${dealerHandText}
  ${!isDealerHidden ? `Total: *${totalDealer}*` : '_Kartu pertama tertutup_'}

━━━━━━━━━━━━━━━━━━━━
*➡️ GILIRAN:* *@${currentPlayer.split('@')[0]}* (${currentPlayer === player1 ? 'P1' : 'P2'})
  *Aksi:* Ketik *.bj hit* atau *.bj stand*
━━━━━━━━━━━━━━━━━━━━
  `.trim();
}

async function checkWin(gameData, sock, remoteJid, message) {
  const { game, player1, player2, bet, mode } = gameData;

  const { total: totalP1, isBlackjack: bjP1 } = game.getHandValue(game.playerHands[player1]);
  const { total: totalP2, isBlackjack: bjP2 } = game.getHandValue(game.playerHands[player2]);
  
  let totalDealer = game.getHandValue(game.dealerHand).total;

  let winnerJid = null;
  let draw = false;
  let winMessage = `\n━━ *HASIL AKHIR BLACKJACK 🏆* ━━\n`;

  const isBustP1 = totalP1 > 21;
  const isBustP2 = totalP2 > 21;
  const isBustDealer = totalDealer > 21;

  if (bjP1 && bjP2) {
      draw = true;
      winMessage += "🤝 *HASIL IMBANG!* Kedua pemain mendapatkan Blackjack di awal. Taruhan dikembalikan.\n";
  } else if (bjP1) {
      winnerJid = player1;
      winMessage += `🎉 *BLACKJACK!* P1 (@${player1.split('@')[0]}) menang dengan Blackjack.!\n`;
  } else if (bjP2) {
      winnerJid = player2;
      winMessage += `🎉 *BLACKJACK!* P2 (@${player2.split('@')[0]}) menang dengan Blackjack.!\n`;
  } else if (isBustP1 && isBustP2) {
      winnerJid = 'DEALER'; 
      winMessage += "💀 *DEALER MENANG!* Kedua pemain Bust (>21).\n";
  } else {
      let validPlayers = [];
      if (!isBustP1) validPlayers.push({ jid: player1, total: totalP1 });
      if (!isBustP2) validPlayers.push({ jid: player2, total: totalP2 });

      if (validPlayers.length === 0) {
          winnerJid = 'DEALER';
      } else if (validPlayers.length === 1) {
          const singlePlayer = validPlayers[0];
          if (isBustDealer || singlePlayer.total > totalDealer) {
              winnerJid = singlePlayer.jid;
              winMessage += `🎉 *@${singlePlayer.jid.split('@')[0]}* menang! Mengalahkan Dealer. ${isBustDealer ? '(Dealer Bust!)' : ''}\n`;
          } else {
              winnerJid = 'DEALER';
              winMessage += `💀 *DEALER MENANG!* @${singlePlayer.jid.split('@')[0]} kalah dari Dealer.\n`;
          }
      } else { 
          const p1BeatsDealer = isBustDealer || totalP1 > totalDealer;
          const p2BeatsDealer = isBustDealer || totalP2 > totalDealer;

          if (p1BeatsDealer && !p2BeatsDealer) {
              winnerJid = player1;
              winMessage += `🎉 *@${player1.split('@')[0]}* menang! P1 mengalahkan Dealer, sementara P2 kalah.\n`;
          } else if (!p1BeatsDealer && p2BeatsDealer) {
              winnerJid = player2;
              winMessage += `🎉 *@${player2.split('@')[0]}* menang! P2 mengalahkan Dealer, sementara P1 kalah.\n`;
          } else if (p1BeatsDealer && p2BeatsDealer) {
              if (totalP1 > totalP2) {
                  winnerJid = player1;
                  winMessage += `🎉 *@${player1.split('@')[0]}* menang! Keduanya mengalahkan Dealer, namun P1 lebih unggul.\n`;
              } else if (totalP2 > totalP1) {
                  winnerJid = player2;
                  winMessage += `🎉 *@${player2.split('@')[0]}* menang! Keduanya mengalahkan Dealer, namun P2 lebih unggul.\n`;
              } else {
                  draw = true;
                  winMessage += "🤝 *HASIL IMBANG!* Keduanya mengalahkan Dealer dengan skor yang sama. Taruhan dikembalikan.\n";
              }
          } else {
              winnerJid = 'DEALER';
              winMessage += "💀 *DEALER MENANG!* Kedua pemain kalah dari Dealer.\n";
          }
      }
  }

  winMessage += "\n_DETAIL SKOR:_\n";
  winMessage += `P1 (@${player1.split('@')[0]}): *${totalP1}* ${isBustP1 ? "❌(BUST)" : ""}\n`;
  winMessage += `P2 (@${player2.split('@')[0]}): *${totalP2}* ${isBustP2 ? "❌(BUST)" : ""}\n`;
  winMessage += `Dealer: *${totalDealer}* ${isBustDealer ? "❌(BUST)" : ""}\n`;
  winMessage += "━━━━━━━━━━━━━━━━\n";

  const dataUser1 = await findUser(player1);
  const dataUser2 = await findUser(player2);
  const [docId1, userData1] = dataUser1;
  const [docId2, userData2] = dataUser2;
  let currentMoneyP1 = userData1.money || 0;
  let currentMoneyP2 = userData2.money || 0;
  
  let finalMoneyP1 = currentMoneyP1;
  let finalMoneyP2 = currentMoneyP2;
  const pot = bet * 2;
  
  let moneyMessage = '';

  if (winnerJid === player1) {
      finalMoneyP1 += pot;
      moneyMessage += `*💸 P1 (@${player1.split('@')[0]}) Mendapatkan:* +${pot} Money\n`;
  } else if (winnerJid === player2) {
      finalMoneyP2 += pot;
      moneyMessage += `*💸 P2 (@${player2.split('@')[0]}) Mendapatkan:* +${pot} Money\n`;
  } else if (draw) {
      finalMoneyP1 += bet;
      finalMoneyP2 += bet;
      moneyMessage += `*💰 IMBANG!* Taruhan *${bet}* Money dikembalikan ke P1 dan P2.\n`;
  } else if (winnerJid === 'DEALER') {
      moneyMessage += `*💔 Dealer Mengambil:* Taruhan *${pot}* Money hangus ke rumah.\n`;
  }

  await updateUser(player1, { money: finalMoneyP1 });
  await updateUser(player2, { money: finalMoneyP2 });
  
  winMessage += moneyMessage;
  winMessage += `\n*SALDO AKHIR:*\nP1: *${finalMoneyP1}*\nP2: *${finalMoneyP2}*\n`;

  await sock.sendMessage(remoteJid, { text: winMessage.trim(), mentions: [player1, player2] }, { quoted: message });
  removeGame(remoteJid);
}

async function dealerTurn(gameData, sock, remoteJid, message) {
  const { game } = gameData;
  updateGame(remoteJid, { state: 'DEALER_TURN' });

  let dealerMessage = '🤖 *GILIRAN DEALER:*\n';
  const dealerReveal = `\n*Kartu Dealer Terbuka:* ${formatHand(game.dealerHand)}. Total awal: *${game.getHandValue(game.dealerHand).total}*\n\n`;
  
  await sock.sendMessage(
    remoteJid,
    { text: dealerReveal.trim() },
    { quoted: message }
  );
  
  let newCard;
  let counter = 0;
  
  while ((newCard = game.dealerPlay()) !== null && counter < 5) {
    dealerMessage += `  ➡️ Dealer *HIT* dan mendapatkan _${newCard}_. \n`;
    counter++;
  }

  const { total: totalDealer } = game.getHandValue(game.dealerHand);
  
  if (counter === 0) {
    dealerMessage += `  ✋ Dealer *STAND* dengan total *${totalDealer}*.\n`;
  } else if (totalDealer > 21) {
    dealerMessage += `  😭 Dealer *BUST* dengan total *${totalDealer}*.\n`;
  }
  
  dealerMessage += `\n*Kartu Akhir Dealer:* ${formatHand(game.dealerHand)}\n`;

  await sock.sendMessage(
    remoteJid,
    { text: dealerMessage.trim(), mentions: [gameData.player1, gameData.player2] },
    { quoted: message }
  );

  updateGame(remoteJid, { state: 'ENDED' });
  await checkWin(gameData, sock, remoteJid, message);
}


async function handle(sock, messageInfo) {
  const { remoteJid, message, sender, isGroup, content, command, prefix } = messageInfo;
  // BUG SEBELUMNYA: `content` sudah TANPA nama command (".bj 500" -> "500"),
  // tapi kode di bawah menganggap args[0] = command dan args[1] = taruhan.
  // Akibatnya ".bj 500" selalu dibalas "taruhan tidak valid" dan game
  // tidak pernah bisa dimulai. Nama command disisipkan kembali di depan.
  const commandArgs = [
    String(command || "bj").toLowerCase(),
    ...String(content || "").trim().toLowerCase().split(/\s+/).filter(Boolean),
  ];
  
  const betOrAction = commandArgs[1]; 
  const commandToUse = `${prefix || "."}${commandArgs[0]}`;

  const groupOnlyMessage = { text: mess?.game?.isGroup || "Permainan hanya bisa dilakukan di dalam grup." };
  const waitingMessage = (taruhan) => `━━━━ *♠️ TANTANGAN BLACKJACK ♣️* ━━━━\n\n*@${sender.split('@')[0]}* menantang dengan taruhan *${taruhan}* Money.\n\n⏳ _Menunggu lawan (${WAKTU_TANTANGAN} detik)..._\n\n*CARA BERGABUNG:*\nKetik *${commandToUse} ${taruhan}*`;

  if (!isGroup) {
    return sock.sendMessage(remoteJid, groupOnlyMessage, { quoted: message });
  }

  let gameData = getGame(remoteJid);
  const isP1 = gameData?.player1 === sender;
  const isP2 = gameData?.player2 === sender;

  // --- Fase 1: Tantangan / Bergabung ---
  if (!gameData || gameData.state === 'WAITING') {
    if (isUserPlaying(sender)) {
      return sock.sendMessage(remoteJid, { text: "⚠️ _Anda sudah berada dalam permainan Blackjack lain, selesaikan yang itu dulu._" }, { quoted: message });
    }

    const taruhan = parseInt(betOrAction);

    if (gameData?.state === 'WAITING') {
      // P2 bergabung
      if (!isP1 && taruhan === gameData.bet) {
          if (sender === gameData.player1) return; 
          
          const dataUser2 = await findUser(sender);
          if (!dataUser2) return sock.sendMessage(remoteJid, { text: "Data user P2 tidak ditemukan!" }, { quoted: message });
          const [docId2, userData2] = dataUser2;
          const moneyUser2 = userData2.money || 0;
          
          if (moneyUser2 < taruhan) {
            return sock.sendMessage(remoteJid, { text: `Money P2 (@${sender.split('@')[0]}) tidak cukup. Money Anda: *${moneyUser2}*` }, { quoted: message, mentions: [sender] });
          }

          const mode = gameData.mode || 'normal';
          const blackjackInstance = new Blackjack(mode);
          
          blackjackInstance.dealInitialCards(gameData.player1);
          blackjackInstance.dealInitialCards(sender);
          blackjackInstance.dealDealerCards();
          
          const updatedMoneyP2 = moneyUser2 - taruhan;
          await updateUser(sender, { money: updatedMoneyP2 });
          
          const newGameData = {
              ...gameData,
              player2: sender,
              state: 'P1_TURN',
              currentPlayer: gameData.player1,
              game: blackjackInstance,
              moneyP2: updatedMoneyP2, 
              command: commandToUse, 
          };

          updateGame(remoteJid, newGameData);
          
          const totalP1 = blackjackInstance.getHandValue(blackjackInstance.playerHands[gameData.player1]).total;
          const totalP2 = blackjackInstance.getHandValue(blackjackInstance.playerHands[sender]).total;

          const isP1Blackjack = blackjackInstance.getHandValue(blackjackInstance.playerHands[gameData.player1]).isBlackjack;
          const isP2Blackjack = blackjackInstance.getHandValue(blackjackInstance.playerHands[sender]).isBlackjack;
          
          if (isP1Blackjack || isP2Blackjack) {
              updateGame(remoteJid, { state: 'DEALER_TURN' });
              return await dealerTurn(newGameData, sock, remoteJid, message);
          }

          const readyMessage = getGameStatusMessage(newGameData, totalP1, totalP2);

          return await sock.sendMessage(remoteJid, { text: `🎉 *@${sender.split('@')[0]}* bergabung! Taruhan siap dimulai.\n` + readyMessage, mentions: [gameData.player1, sender] }, { quoted: message });

      } else {
        return sock.sendMessage(remoteJid, { text: `❌ Taruhan harus sama dengan P1 (*${gameData.bet || 0}* Money).` }, { quoted: message });
      }

    } else if (taruhan > 0) {
      // --- CEK COOLDOWN SEBELUM MEMBUAT GAME BARU ---
      const now = Date.now();
      if (cooldowns[remoteJid] && now - cooldowns[remoteJid] < COOLDOWN_TIME) {
        const sisaWaktu = cooldowns[remoteJid] + COOLDOWN_TIME - now;
        const menit = Math.floor(sisaWaktu / 60000);
        const detik = Math.floor((sisaWaktu % 60000) / 1000);

        return await sock.sendMessage(remoteJid, { text: `⏳ *Jeda Bermain*\n\nHarap tunggu *${menit} menit ${detik} detik* lagi sebelum membuat room Blackjack baru.\n\n_🚫 Mohon untuk tidak melakukan spam command agar bot tetap stabil._` }, { quoted: message });
      }
      
      // P1 memulai tantangan
      const dataUser1 = await findUser(sender);
      if (!dataUser1) return sock.sendMessage(remoteJid, { text: "Data user P1 tidak ditemukan!" }, { quoted: message });
      const [docId1, userData1] = dataUser1;
      const moneyUser1 = userData1.money || 0;

      if (moneyUser1 < taruhan) {
        return sock.sendMessage(remoteJid, { text: `Money Anda tidak cukup untuk taruhan *${taruhan}* Money. Money Anda: *${moneyUser1}*` }, { quoted: message });
      }
      
      const modeArg = commandArgs[2] ? commandArgs[2].toLowerCase() : 'normal';
      const modeToUse = modeArg === 'hard' ? 'hard' : modeArg === 'setan' ? 'setan' : 'normal';

      // SET COOLDOWN SETELAH BERHASIL CREATE GAME
      cooldowns[remoteJid] = now;

      const updatedMoneyP1 = moneyUser1 - taruhan;
      await updateUser(sender, { money: updatedMoneyP1 });

      addGame(remoteJid, {
          state: 'WAITING',
          player1: sender,
          player2: null,
          bet: taruhan,
          currentPlayer: sender,
          game: null, 
          moneyP1: updatedMoneyP1, 
          moneyP2: 0, 
          mode: modeToUse,
          command: commandToUse, 
      });

      setTimeout(async () => {
        if (isGroupPlaying(remoteJid)) {
          const checkGame = getGame(remoteJid);
          if (checkGame && checkGame.state === 'WAITING') {
            removeGame(remoteJid);
            await updateUser(sender, { money: updatedMoneyP1 + taruhan });
            sock.sendMessage(remoteJid, { text: `⏳ Waktu habis! Tidak ada lawan yang ingin bermain Blackjack. Taruhan *${taruhan}* Money telah dikembalikan kepada @${sender.split('@')[0]}.` }, { quoted: message, mentions: [sender] });
          }
        }
      }, WAKTU_TANTANGAN * 1000);

      return await sock.sendMessage(remoteJid, { text: waitingMessage(taruhan), mentions: [sender] }, { quoted: message });

    } else {
      return sock.sendMessage(remoteJid, { text: `_Masukkan jumlah taruhan yang valid (contoh: *${commandToUse} 500* atau *${commandToUse} 500 hard*)_` }, { quoted: message });
    }
  }


  // --- Fase 2: Permainan Berlangsung (HIT/STAND) ---
  if (gameData && (gameData.state === 'P1_TURN' || gameData.state === 'P2_TURN')) {
    
    if (gameData.currentPlayer !== sender) {
      return sock.sendMessage(remoteJid, { text: `❌ Bukan giliran Anda! Giliran *@${gameData.currentPlayer.split('@')[0]}*` }, { quoted: message, mentions: [gameData.currentPlayer] });
    }

    const playerJid = sender;
    const isCurrentP1 = playerJid === gameData.player1;
    const nextPlayer = isCurrentP1 ? gameData.player2 : gameData.player1;
    
    let actionArg = betOrAction;

    if (actionArg === 'hit') {
      const newCard = gameData.game.hit(playerJid);
      const { total } = gameData.game.getHandValue(gameData.game.playerHands[playerJid]);
      
      let nextState = gameData.state;
      let actionMessage = `➡️ *@${sender.split('@')[0]}* *HIT* dan mendapatkan _${newCard}_. Total: *${total}*.\n\n`;

      if (total > 21) {
        nextState = isCurrentP1 ? 'P2_TURN' : 'DEALER_TURN';
        updateGame(remoteJid, { state: nextState, currentPlayer: nextPlayer });

        actionMessage = `😭 *@${sender.split('@')[0]}* *BUST* (>21) dengan total *${total}*.\n`;
        
        const totalP1 = gameData.game.getHandValue(gameData.game.playerHands[gameData.player1]).total;
        const totalP2 = gameData.game.getHandValue(gameData.game.playerHands[gameData.player2]).total;
        let statusMessage = getGameStatusMessage(gameData, totalP1, totalP2);
        
        await sock.sendMessage(remoteJid, { text: actionMessage + statusMessage, mentions: [sender] }, { quoted: message });

        if (nextState === 'DEALER_TURN') {
          return await dealerTurn(gameData, sock, remoteJid, message);
        }
        return true;

      } else {
        const totalP1 = gameData.game.getHandValue(gameData.game.playerHands[gameData.player1]).total;
        const totalP2 = gameData.game.getHandValue(gameData.game.playerHands[gameData.player2]).total;
        const statusMessage = getGameStatusMessage(gameData, totalP1, totalP2);

        await sock.sendMessage(remoteJid, { text: actionMessage + statusMessage, mentions: [sender] }, { quoted: message });
        return true;
      }

    } else if (actionArg === 'stand') {
      const total = gameData.game.getHandValue(gameData.game.playerHands[playerJid]).total;
      const standMessage = `✋ *@${sender.split('@')[0]}* *STAND* dengan total *${total}*.\n\n`;
      
      let nextState = isCurrentP1 ? 'P2_TURN' : 'DEALER_TURN';
      
      updateGame(remoteJid, { state: nextState, currentPlayer: nextPlayer });

      const totalP1 = gameData.game.getHandValue(gameData.game.playerHands[gameData.player1]).total;
      const totalP2 = gameData.game.getHandValue(gameData.game.playerHands[gameData.player2]).total;
      let statusMessage = getGameStatusMessage(gameData, totalP1, totalP2);
      
      await sock.sendMessage(remoteJid, { text: standMessage + statusMessage, mentions: [sender] }, { quoted: message });

      if (nextState === 'DEALER_TURN') {
        return await dealerTurn(gameData, sock, remoteJid, message);
      }
      return true;

    } else if (actionArg === 'end') {
        if (isP1 || isP2) {
             const { moneyP1, moneyP2, bet, player1, player2 } = gameData;
             removeGame(remoteJid);
             if (player2) {
                const dataUser1 = await findUser(player1);
                const dataUser2 = await findUser(player2);
                if (dataUser1) await updateUser(player1, { money: moneyP1 + bet });
                if (dataUser2) await updateUser(player2, { money: moneyP2 + bet });
             } else {
                 const dataUser1 = await findUser(player1);
                 if (dataUser1) await updateUser(player1, { money: moneyP1 + bet });
             }
             return sock.sendMessage(remoteJid, { text: `Permainan Blackjack dibatalkan oleh *@${sender.split('@')[0]}*. Taruhan telah dikembalikan.` }, { quoted: message, mentions: [sender] });
        }
    } else {
      return sock.sendMessage(remoteJid, { text: `❌ Aksi tidak valid. Giliran Anda! Ketik *${commandToUse} hit* atau *${commandToUse} stand* (atau cukup *hit* / *stand*).` }, { quoted: message });
    }
  }
}

export default {
  handle,
  Commands: ["bj", "blackjack"],
  OnlyPremium: false,
  OnlyOwner: false,
};