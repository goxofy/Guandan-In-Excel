class GuandanLogic {
    constructor() {
        this.suits = ['S', 'H', 'C', 'D']; // Spades, Hearts, Clubs, Diamonds
        this.ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    }

    // Generate 2 decks (108 cards)
    // ID: 0-51 (Deck 1), 52-103 (Deck 2), 104-105 (Jokers 1), 106-107 (Jokers 2)
    // Actually, let's use a simpler object representation for logic
    createDeck() {
        let deck = [];
        // 2 Decks
        for (let d = 0; d < 2; d++) {
            // Suits
            for (let s = 0; s < 4; s++) {
                for (let r = 0; r < 13; r++) {
                    deck.push({
                        id: `${d}-${this.suits[s]}-${this.ranks[r]}`,
                        suit: this.suits[s],
                        rank: this.ranks[r],
                        val: r, // 0=2, 12=A (Base value)
                        type: 'NORMAL'
                    });
                }
            }
            // Jokers
            deck.push({ id: `${d}-SJ`, suit: 'JOKER', rank: 'SJ', val: 100, type: 'JOKER' }); // Small Joker
            deck.push({ id: `${d}-BJ`, suit: 'JOKER', rank: 'BJ', val: 101, type: 'JOKER' }); // Big Joker
        }
        return this.shuffle(deck);
    }

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    // Get effective value of a card based on current Level Card
    getCardValue(card, currentLevelRank) {
        if (card.type === 'JOKER') return card.val; // 100 or 101

        // Convert rank string to value index
        const rankIndex = this.ranks.indexOf(card.rank);
        const levelIndex = this.ranks.indexOf(currentLevelRank);

        if (rankIndex === levelIndex) {
            // It's a level card
            if (card.suit === 'H') {
                return 200; // Heart Level Card (Wild/Ghost) - Highest non-joker? Or handled specially
            }
            return 99; // Other Level Cards (just below Small Joker)
        }

        // Normal sorting: 2 is lowest? In Guandan 2 is lowest usually, unless it's level card.
        // But wait, A is high.
        // 2,3,4...10,J,Q,K,A
        // Let's map to 2-14.
        let val = rankIndex + 2;
        if (card.rank === 'A') val = 14;

        return val;
    }

    // Sort hand
    sortHand(hand, currentLevelRank) {
        return hand.sort((a, b) => {
            const valA = this.getCardValue(a, currentLevelRank);
            const valB = this.getCardValue(b, currentLevelRank);
            if (valA !== valB) return valB - valA; // Descending
            // Tie-break by suit (optional, but good for display)
            return a.suit.localeCompare(b.suit);
        });
    }

    // Validate if a set of cards is a valid Guandan hand
    validateHand(cards, currentLevelRank) {
        if (!cards || cards.length === 0) return { isValid: false, type: 'EMPTY' };

        // Sort cards for easier analysis
        const sorted = [...cards].sort((a, b) => this.getCardValue(a, currentLevelRank) - this.getCardValue(b, currentLevelRank)); // Ascending for logic
        const values = sorted.map(c => this.getCardValue(c, currentLevelRank));
        const len = cards.length;

        // 1. Single
        if (len === 1) return { isValid: true, type: 'SINGLE', rank: values[0] };

        // 2. Pair
        if (len === 2 && values[0] === values[1]) return { isValid: true, type: 'PAIR', rank: values[0] };

        // 3. Triplet
        if (len === 3 && values[0] === values[1] && values[1] === values[2]) return { isValid: true, type: 'TRIPLET', rank: values[0] };

        // 4. Bomb (4+ same rank)
        if (len >= 4 && values.every(v => v === values[0])) return { isValid: true, type: 'BOMB', rank: values[0], count: len };

        // 5. Triplet + Pair (Full House) - 5 cards
        if (len === 5) {
            // AAA BB or AA BBB
            if (values[0] === values[1] && values[1] === values[2] && values[3] === values[4]) {
                return { isValid: true, type: 'FULL_HOUSE', rank: values[0] }; // AAA BB
            }
            if (values[0] === values[1] && values[2] === values[3] && values[3] === values[4]) {
                return { isValid: true, type: 'FULL_HOUSE', rank: values[2] }; // AA BBB
            }
        }

        // 6. Straight (5 consecutive cards)
        // Note: A can be 1 (A2345) or 14 (10JQKA). Logic needs to handle A carefully.
        // For now, simple consecutive check on values.
        if (len === 5 && this.isConsecutive(values)) {
            return { isValid: true, type: 'STRAIGHT', rank: values[4] };
        }

        // 7. Plate (2 consecutive triplets) - 6 cards
        // e.g. 333 444
        if (len === 6) {
            if (values[0] === values[1] && values[1] === values[2] &&
                values[3] === values[4] && values[4] === values[5] &&
                values[3] === values[0] + 1) {
                return { isValid: true, type: 'PLATE', rank: values[3] };
            }
        }

        // 8. Tube (3 consecutive pairs) - 6 cards
        // e.g. 33 44 55
        if (len === 6) {
            if (values[0] === values[1] && values[2] === values[3] && values[4] === values[5] &&
                values[2] === values[0] + 1 && values[4] === values[2] + 1) {
                return { isValid: true, type: 'TUBE', rank: values[4] };
            }
        }

        // Joker Bomb (4 Jokers)
        // Check if all are jokers
        const jokerCount = cards.filter(c => c.type === 'JOKER').length;
        if (jokerCount === 4 && len === 4) return { isValid: true, type: 'KING_BOMB', rank: 999 };

        return { isValid: false, type: 'INVALID' };
    }

    isConsecutive(values) {
        for (let i = 0; i < values.length - 1; i++) {
            if (values[i + 1] !== values[i] + 1) return false;
        }
        return true;
    }

    // Compare two hands. Returns true if handA beats handB.
    // handA: New hand (validated)
    // handB: Previous hand (validated)
    compareHands(handA, handB, currentLevelRank) {
        if (!handB) return true; // Free play

        // 1. King Bomb beats everything
        if (handA.type === 'KING_BOMB') return true;
        if (handB.type === 'KING_BOMB') return false;

        // 2. Bomb beats non-Bomb
        if (handA.type === 'BOMB' && handB.type !== 'BOMB') return true;
        if (handA.type !== 'BOMB' && handB.type === 'BOMB') return false;

        // 3. Both Bombs
        if (handA.type === 'BOMB' && handB.type === 'BOMB') {
            if (handA.count > handB.count) return true;
            if (handA.count < handB.count) return false;
            return handA.rank > handB.rank;
        }

        // 4. Same Type Comparison
        if (handA.type !== handB.type) return false; // Must be same type (except bombs)

        // Count must match (except for Bombs, handled above)
        // Note: Full House, Plate, Tube, Straight have fixed counts or implied counts
        // But Straight can be 5 cards.
        // Actually Guandan Straight is always 5.
        // So we can just check rank.

        // Special case: Full House?
        // Rank is the triplet part.

        return handA.rank > handB.rank;
    }
}

module.exports = new GuandanLogic();
