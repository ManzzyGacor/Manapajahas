/**
 * Kelas inti untuk Logika Permainan Blackjack.
 */
class Blackjack {
  /**
   * Mendefinisikan deck kartu berdasarkan mode kesulitan.
   * @param {'normal'|'hard'|'setan'} mode - Mode permainan.
   */
  constructor(mode = 'normal') {
    this.mode = mode;
    this.initialDeck = this._defineDeck();
    this.playerHands = {}; // { jid: ['A', '5'] }
    this.dealerHand = [];
    this.usedCards = [];
    this.isGameActive = false;
  }

  /**
   * Menentukan kartu yang tersedia berdasarkan mode.
   * Kartu: A (Ace), 2-9, J, Q, K
   * @returns {string[]}
   */
  _defineDeck() {
    const fullDeck = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "J", "K", "Q"];

    if (this.mode === "normal") {
      return fullDeck;
    } else if (this.mode === "hard") {
      // Dealer cenderung mendapatkan kartu besar (8-A, J, Q, K)
      // Kita akan gunakan fullDeck, tetapi dealer akan memiliki kecenderungan kartu 'hard' di logika plugin.
      // Untuk tujuan lib, kita tetap sediakan full deck untuk pengambilan kartu acak.
      return fullDeck;
    } else if (this.mode === "setan") {
      // Player cenderung mendapatkan kartu kecil, dealer kartu besar
      return fullDeck; 
    }
    return fullDeck;
  }

  /**
   * Mengambil kartu secara acak dari deck yang tersedia.
   * Dalam mode 'hard' dan 'setan', ini akan digunakan di logika plugin untuk
   * memberikan kartu yang lebih baik/buruk. Di sini, kita hanya mengambil acak.
   * @param {boolean} isDealer - Apakah kartu ini untuk dealer.
   * @returns {string} Kartu acak.
   */
  getRandomCard(isDealer = false) {
    const deck = this._defineDeck();
    let card;
    
    // Logika pemilihan kartu yang lebih "fair" jika mode 'setan' tidak diterapkan di plugin
    if (this.mode === 'setan' && isDealer) {
      const highCards = ["J", "Q", "K"]; // Kartu bernilai 10
      card = highCards[Math.floor(Math.random() * highCards.length)];
    } else if (this.mode === 'setan' && !isDealer) {
      const lowCards = ["A", "2", "3", "4", "5", "6", "7", "8", "9"]; // Kartu bernilai < 10
      card = lowCards[Math.floor(Math.random() * lowCards.length)];
    } else if (this.mode === 'hard' && isDealer) {
        // Dealer lebih sering dapat kartu 8 ke atas
        const preferredCards = ["A", "8", "9", "J", "Q", "K"];
        card = preferredCards[Math.floor(Math.random() * preferredCards.length)];
    } else {
      card = deck[Math.floor(Math.random() * deck.length)];
    }

    // Walaupun ada 'usedCards', karena ini adalah permainan chat, kita biarkan pengulangan kartu
    // agar game tidak terlalu cepat kehabisan kartu dan lebih sederhana.
    return card;
  }

  /**
   * Menghitung nilai total kartu. Menggunakan Ace (A) sebagai 11
   * jika totalnya tidak melebihi 21, jika tidak, Ace bernilai 1.
   * @param {string[]} hand - Array kartu ('A', '2', 'K', dll.).
   * @returns {{total: number, isBlackjack: boolean}} Nilai total dan status Blackjack.
   */
  getHandValue(hand) {
    let total = 0;
    let numAces = 0;

    for (const card of hand) {
      if (["J", "Q", "K"].includes(card)) {
        total += 10;
      } else if (card === "A") {
        numAces += 1;
        total += 11; // Hitung Ace sebagai 11 secara default
      } else {
        total += (parseInt(card) || 0);
      }
    }

    // Sesuaikan nilai Ace dari 11 menjadi 1 jika total melebihi 21
    while (total > 21 && numAces > 0) {
      total -= 10;
      numAces -= 1;
    }

    const isBlackjack = (total === 21 && hand.length === 2);

    return { total, isBlackjack };
  }

  /**
   * Memberikan dua kartu awal kepada pemain dan dealer.
   * @param {string} jid - JID pemain.
   * @returns {string[]} Kartu yang diberikan.
   */
  dealInitialCards(jid) {
    const card1 = this.getRandomCard(false);
    const card2 = this.getRandomCard(false);
    this.playerHands[jid] = [card1, card2];
    return this.playerHands[jid];
  }

  /**
   * Memberikan dua kartu awal kepada Dealer.
   * @returns {string[]} Kartu Dealer.
   */
  dealDealerCards() {
    const card1 = this.getRandomCard(true);
    const card2 = this.getRandomCard(true);
    this.dealerHand = [card1, card2];
    return this.dealerHand;
  }

  /**
   * Pemain mengambil kartu tambahan ('Hit').
   * @param {string} jid - JID pemain.
   * @returns {string} Kartu baru yang diambil.
   */
  hit(jid) {
    const newCard = this.getRandomCard(false);
    this.playerHands[jid].push(newCard);
    return newCard;
  }
  
  /**
   * Dealer mengambil kartu tambahan.
   * Dealer harus 'Hit' jika totalnya <= 16 dan 'Stand' jika totalnya >= 17.
   * @returns {string | null} Kartu baru yang diambil, atau null jika Dealer Stand.
   */
  dealerPlay() {
    const { total } = this.getHandValue(this.dealerHand);
    if (total <= 16) {
      const newCard = this.getRandomCard(true);
      this.dealerHand.push(newCard);
      return newCard;
    }
    return null;
  }
}

export default Blackjack;