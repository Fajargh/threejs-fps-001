// rounds.js — round + match flow for RUSTLINE.
// Freeze (buy) -> live (100 s) -> over (4 s breather) -> next round.
// First to 5 wins the match; max 9 rounds, highest score wins, else draw.

export const ROUND = {
  freeze: 6,
  live: 100,
  winScore: 5,
  maxRounds: 9,
  winMoney: 325,
  lossMoney: 200,
  killMoney: 300,
  plantMoney: 300,
  defuseMoney: 300,
};

export class RoundManager {
  constructor() {
    this.phase = 'freeze'; // 'freeze' | 'live' | 'over'
    this.round = 1;
    this.score = { ember: 0, slate: 0 };
    this.timeLeft = ROUND.freeze;
  }

  startRound() {
    this.phase = 'freeze';
    this.timeLeft = ROUND.freeze;
  }

  beginLive() {
    this.phase = 'live';
    this.timeLeft = ROUND.live;
  }

  endRound(winner, reason) {
    this.score[winner]++;
    this.phase = 'over';
    this.timeLeft = 4;
    return { winner, reason, round: this.round };
  }

  nextRound() {
    this.round++;
    this.startRound();
  }

  update(dt) {
    this.timeLeft -= dt;
    if (this.phase === 'live' && this.timeLeft <= 0) return 'timeout';
    if (this.phase === 'over' && this.timeLeft <= 0) return 'next';
    return null;
  }

  isMatchOver() {
    if (this.score.ember >= ROUND.winScore) return 'ember';
    if (this.score.slate >= ROUND.winScore) return 'slate';
    if (this.round >= ROUND.maxRounds) {
      if (this.score.ember > this.score.slate) return 'ember';
      if (this.score.slate > this.score.ember) return 'slate';
      return 'draw';
    }
    return null;
  }
}
