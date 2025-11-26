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

    // Check if card is a Ghost (Heart Level Card)
    isGhost(card, currentLevelRank) {
        if (card.type === 'JOKER') return false;
        return card.rank === currentLevelRank && card.suit === 'H';
    }

    // Validate if a set of cards is a valid Guandan hand
    validateHand(cards, currentLevelRank) {
        if (!cards || cards.length === 0) return { isValid: false, type: 'EMPTY' };

        // Separate Ghosts and Normals
        const ghosts = [];
        const normals = [];

        cards.forEach(c => {
            if (this.isGhost(c, currentLevelRank)) {
                ghosts.push(c);
            } else {
                normals.push(c);
            }
        });

        const ghostCount = ghosts.length;

        // Sort normals
        normals.sort((a, b) => this.getCardValue(a, currentLevelRank) - this.getCardValue(b, currentLevelRank));
        const normalValues = normals.map(c => this.getCardValue(c, currentLevelRank));
        const len = cards.length;

        // --- Logic with Ghosts ---

        // 1. Single
        if (len === 1) {
            // If it's a ghost, it's a single Level Card (value 200)
            // If normal, normal value
            return { isValid: true, type: 'SINGLE', rank: normalValues.length > 0 ? normalValues[0] : 200 };
        }

        // 2. Pair
        if (len === 2) {
            if (ghostCount === 2) return { isValid: true, type: 'PAIR', rank: 200 }; // Pair of Ghosts
            if (ghostCount === 1) return { isValid: true, type: 'PAIR', rank: normalValues[0] }; // Ghost + Normal
            if (normalValues[0] === normalValues[1]) return { isValid: true, type: 'PAIR', rank: normalValues[0] };
        }

        // 3. Triplet
        if (len === 3) {
            if (ghostCount === 3) return { isValid: true, type: 'TRIPLET', rank: 200 };
            if (ghostCount === 2) return { isValid: true, type: 'TRIPLET', rank: normalValues[0] };
            if (ghostCount === 1 && normalValues[0] === normalValues[1]) return { isValid: true, type: 'TRIPLET', rank: normalValues[0] };
            if (ghostCount === 0 && normalValues[0] === normalValues[1] && normalValues[1] === normalValues[2]) return { isValid: true, type: 'TRIPLET', rank: normalValues[0] };
        }

        // 4. Bomb (4+ cards)
        // Rule: All normals must be same rank. Ghosts fill the rest.
        // Exception: King Bomb (4 Jokers) - handled separately or check here?
        // King Bomb check first
        const jokerCount = cards.filter(c => c.type === 'JOKER').length;
        if (jokerCount === 4 && len === 4) return { isValid: true, type: 'KING_BOMB', rank: 999 };

        // Normal Bomb Logic
        // If all ghosts -> Bomb of Level Cards (200)
        // If normals exist, they must all be same rank.
        const isAllNormalsSame = normalValues.every(v => v === normalValues[0]);
        if (len >= 4 && isAllNormalsSame) {
            const rank = normalValues.length > 0 ? normalValues[0] : 200;
            return { isValid: true, type: 'BOMB', rank: rank, count: len };
        }

        // 5. Full House (5 cards)
        // AAA BB
        if (len === 5) {
            // We need to split normals into two groups (or less).
            // Possible normal counts:
            // 5 normals: 3+2 (Standard)
            // 4 normals: 3+1, 2+2 (Ghost fills 1)
            // 3 normals: 3+0, 2+1, 1+1+1(Invalid)
            // ...
            // Strategy: Count frequencies of normals.
            const counts = {};
            normalValues.forEach(v => counts[v] = (counts[v] || 0) + 1);
            const distinctRanks = Object.keys(counts);

            if (distinctRanks.length === 2) {
                // Two ranks of normals. e.g. 333 44 (0 ghost), 33 44 (1 ghost), 33 4 (2 ghosts)
                // We need to form 3 of A and 2 of B.
                // Total cards = 5.
                // We just need to check if we can reach 3 and 2 with available ghosts.
                // Actually, since len=5, if we have 2 distinct ranks, we just need to ensure we can make them into Full House.
                // Any 2 distinct ranks + ghosts can form Full House as long as we don't violate "max 3 of one, max 2 of other"?
                // Wait, 3333 4 is NOT Full House, it's Bomb + Single (Invalid).
                // So we need to target 3 and 2.
                const countA = counts[distinctRanks[0]];
                const countB = counts[distinctRanks[1]];
                // We need (3-countA) + (2-countB) <= ghostCount OR (2-countA) + (3-countB) <= ghostCount
                // Since countA + countB + ghostCount = 5
                // And we want final counts to be 3 and 2.
                // If countA <= 3 and countB <= 3 (and one <=2), it's valid.
                // Actually, simpler: if countA <= 3 and countB <= 3, it's valid Full House.
                // Because we can always fill the rest with ghosts to reach 3 and 2.
                // Example: 333 4 (1 ghost). A=3, B=1. 3<=3, 1<=2? Yes.
                // Example: 3333 4 (0 ghost). A=4. Invalid.
                if (countA <= 3 && countB <= 3) {
                    // Which is the Triplet?
                    // If countA + ghosts >= 3, could be A.
                    // If countB + ghosts >= 3, could be B.
                    // Usually bigger triplet determines rank? Or context?
                    // For auto-validation, if ambiguous (e.g. 3 4 + 3 ghosts -> 333 44 or 444 33), pick higher rank as triplet?
                    // Let's pick rank of the one that has more natural cards first, then value.
                    let rank = 0;
                    if (countA > countB) rank = parseInt(distinctRanks[0]);
                    else if (countB > countA) rank = parseInt(distinctRanks[1]);
                    else rank = Math.max(parseInt(distinctRanks[0]), parseInt(distinctRanks[1])); // 33 44 + ghost -> 444 33

                    return { isValid: true, type: 'FULL_HOUSE', rank: rank };
                }
            } else if (distinctRanks.length === 1) {
                // Only 1 rank of normals. e.g. 333 + 2 ghosts.
                // This is a Bomb (5 cards).
                // But logic above caught it as Bomb.
                // Can it be Full House? 333 (Ghosts) -> 333 200 200?
                // Usually Bomb > Full House. So we prefer Bomb.
                // So if we are here, it's NOT a bomb (already returned).
                // Ah, `isAllNormalsSame` check handles this.
                // So we won't reach here if distinctRanks=1.
            }
        }

        // 6. Straight (5 cards)
        if (len === 5) {
            // Normals must be unique
            const uniqueNormals = new Set(normalValues);
            if (uniqueNormals.size === normalValues.length) {
                // No pairs in normals
                // Check span
                const min = normalValues[0];
                const max = normalValues[normalValues.length - 1];
                // If span < 5, we can fill with ghosts
                // Example: 3, 5, 6 (2 ghosts). Min 3, Max 6. Span = 6-3+1 = 4. 4 <= 5. Valid.
                // Example: 3, 7 (3 ghosts). Min 3, Max 7. Span = 5. Valid.
                // Example: 3, 8 (3 ghosts). Min 3, Max 8. Span = 6. Invalid.

                // Special case: A (14) can be 1 in A2345.
                // If normals contain 14, try treating it as 1.
                // But `normalValues` is sorted. 14 is at end.
                // If we have 14, try checking span with 14 as 1.
                // 14, 2, 3 -> 1, 2, 3.

                // Check Standard (A=14)
                // Check Standard (A=14)
                if (max - min < 5) {
                    // Check for Straight Flush
                    const isFlush = normals.every(c => c.suit === normals[0].suit);
                    // If ghosts exist, they can match any suit.
                    // So if all normals are same suit, it's a flush.
                    const type = isFlush ? 'STRAIGHT_FLUSH' : 'STRAIGHT';

                    // Max of the straight is Min + 4 (assuming we shift window to maximize rank)
                    return { isValid: true, type: type, rank: min + 4 };
                }

                // Check A2345 (A=1)
                if (normalValues.includes(14)) {
                    // Replace 14 with 1 and re-sort
                    const valuesA1 = normalValues.map(v => v === 14 ? 1 : v).sort((a, b) => a - b);
                    const minA = valuesA1[0];
                    const maxA = valuesA1[valuesA1.length - 1];
                    if (maxA - minA < 5) {
                        const isFlush = normals.every(c => c.suit === normals[0].suit);
                        const type = isFlush ? 'STRAIGHT_FLUSH' : 'STRAIGHT';
                        return { isValid: true, type: type, rank: 5 }; // A2345 rank is 5
                    }
                }
            }
        }

        // 7. Tube (3 consecutive pairs) - 6 cards
        // e.g. 33 44 55
        if (len === 6) {
            // Strategy: Check if we can form 3 pairs.
            // Then check if those pairs are consecutive.

            // First, can we form 3 pairs?
            // Count frequencies
            const counts = {};
            normalValues.forEach(v => counts[v] = (counts[v] || 0) + 1);
            const distinctRanks = Object.keys(counts).map(Number).sort((a, b) => a - b);

            // We need 3 ranks.
            // If distinctRanks.length > 3, impossible (unless ghosts used weirdly, but usually we need 3 bases).
            // If distinctRanks.length < 1, impossible (all ghosts? 6 ghosts? unlikely).

            // Case A: 3 distinct ranks. e.g. 33 44 55 (0 ghost), 3 44 55 (1 ghost), 3 4 55 (2 ghosts)
            // We need each count + ghost contribution >= 2.
            // And ranks must be consecutive.

            // Helper to check if ranks are consecutive
            const areRanksConsecutive = (ranks) => {
                for (let i = 0; i < ranks.length - 1; i++) {
                    if (ranks[i + 1] !== ranks[i] + 1) return false;
                }
                return true;
            };

            // Try to find 3 consecutive ranks that cover our normal values
            // If we have normals [3, 3, 4, 4, 5, 5], ranks are 3,4,5.
            // If we have [3, 4, 5] + 3 ghosts, ranks 3,4,5.
            // If we have [3, 5] + ghosts? -> 3,4,5?

            // Let's iterate through possible start ranks based on normals.
            // Min normal could be start, start+1, or start+2.
            // Max normal could be end, end-1, end-2.

            if (normalValues.length > 0) {
                const min = normalValues[0];
                const max = normalValues[normalValues.length - 1];

                // Possible consecutive sequences of 3 pairs involving these values.
                // Sequence must include all normals.
                // So sequence range [start, start+2] must cover [min, max].
                // i.e. start <= min AND start+2 >= max.
                // So start <= min AND start >= max - 2.
                // So max - 2 <= start <= min.

                const possibleStarts = [];
                for (let s = max - 2; s <= min; s++) {
                    possibleStarts.push(s);
                }

                for (let start of possibleStarts) {
                    // Check if we can form pairs for start, start+1, start+2
                    const targetRanks = [start, start + 1, start + 2];

                    // A (14) handling? Tube usually doesn't wrap. AA 22 33 is valid?
                    // In Guandan, A is high (14). A 2 3 is usually not valid Tube.
                    // Only Q K A.
                    // But 2 is low (2). 2 3 4 is valid.
                    // So just check values.

                    let ghostsNeeded = 0;
                    let validSequence = true;

                    for (let r of targetRanks) {
                        const count = counts[r] || 0;
                        if (count > 2) { validSequence = false; break; } // Can't have 3 of same rank in Tube (that would be Plate?)
                        // Actually Tube is 3 pairs. 333 444 is Plate.
                        // If we have 333, we can use 33 as pair, 1 left over? No, must use all cards.
                        // So count must be <= 2.
                        ghostsNeeded += (2 - count);
                    }

                    if (validSequence && ghostsNeeded <= ghostCount) {
                        // Check if we used all normals?
                        // We iterated targetRanks. If normals had a rank NOT in targetRanks, it wouldn't be in counts[r] loop?
                        // Wait, we need to ensure NO other normals exist.
                        // We enforced start <= min and start+2 >= max, so all normals are within range.
                        // And we checked counts[r] for r in range.
                        // If there was a normal not in range, min/max logic would fail?
                        // Yes. e.g. 3, 8. Max=8, Min=3. Max-2=6. 6 <= 3 is False. Loop empty.

                        return { isValid: true, type: 'TUBE', rank: start + 2 }; // Rank is the highest pair
                    }
                }
            } else {
                // All ghosts? 6 ghosts -> Tube of Level Cards?
                // Or Tube of A (highest)?
                // Rare case. Let's say valid, rank A.
                if (len === 6 && ghostCount === 6) return { isValid: true, type: 'TUBE', rank: 14 };
            }
        }

        // 7. Plate & Tube (6 cards)
        // Too complex for this step?
        // Let's stick to Single, Pair, Triplet, Bomb, Full House, Straight for now.
        // Plate/Tube with ghosts is rare but possible.
        // e.g. 33 44 + 2 ghosts -> 33 44 55.

        // 8. Plate (2 consecutive triplets) - 6 cards
        // e.g. 333 444
        if (len === 6) {
            // Check for Plate (2 consecutive triplets)
            // Strategy: Check if we can form 2 triplets.
            // Then check if those triplets are consecutive.

            const counts = {};
            normalValues.forEach(v => counts[v] = (counts[v] || 0) + 1);

            if (normalValues.length > 0) {
                const min = normalValues[0];
                const max = normalValues[normalValues.length - 1];

                // Possible consecutive sequences of 2 triplets.
                // Range [start, start+1] must cover [min, max].
                // start <= min AND start+1 >= max.

                const possibleStarts = [];
                for (let s = max - 1; s <= min; s++) {
                    possibleStarts.push(s);
                }

                for (let start of possibleStarts) {
                    const targetRanks = [start, start + 1];
                    let ghostsNeeded = 0;
                    let validSequence = true;

                    for (let r of targetRanks) {
                        const count = counts[r] || 0;
                        if (count > 3) { validSequence = false; break; } // Can't have 4 (Bomb)
                        ghostsNeeded += (3 - count);
                    }

                    if (validSequence && ghostsNeeded <= ghostCount) {
                        return { isValid: true, type: 'PLATE', rank: start + 1 }; // Rank is the highest triplet
                    }
                }
            } else {
                // All ghosts? 6 ghosts -> Plate of Level Cards?
                if (len === 6 && ghostCount === 6) return { isValid: true, type: 'PLATE', rank: 14 };
            }
        }

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

        // Hierarchy:
        // 1. King Bomb (4 Jokers)
        // 2. Bomb (6+ cards)
        // 3. Straight Flush
        // 4. Bomb (5 cards)
        // 5. Bomb (4 cards)
        // 6. Other (Same type only)

        const getPower = (hand) => {
            if (hand.type === 'KING_BOMB') return 100;
            if (hand.type === 'BOMB') {
                if (hand.count >= 6) return 90; // 6+ Bomb
                if (hand.count === 5) return 70; // 5 Bomb
                return 60; // 4 Bomb
            }
            if (hand.type === 'STRAIGHT_FLUSH') return 80; // Straight Flush
            return 0; // Regular
        };

        const powerA = getPower(handA);
        const powerB = getPower(handB);

        // If both are special types (Power > 0)
        if (powerA > 0 || powerB > 0) {
            if (powerA > powerB) return true;
            if (powerA < powerB) return false;

            // Same power level
            if (handA.type === 'BOMB' && handB.type === 'BOMB') {
                if (handA.count > handB.count) return true;
                if (handA.count < handB.count) return false;
                return handA.rank > handB.rank;
            }
            if (handA.type === 'STRAIGHT_FLUSH' && handB.type === 'STRAIGHT_FLUSH') {
                return handA.rank > handB.rank;
            }
            // King Bomb vs King Bomb (Impossible usually, only 1 set)
            return false;
        }

        // Normal Comparison
        if (handA.type !== handB.type) return false;
        if (handA.type === 'STRAIGHT' && handA.rank !== handB.rank) return handA.rank > handB.rank; // Straight rank check
        // For others (Pair, Triplet, etc.)
        // Count check?
        // Tube/Plate have fixed counts.
        return handA.rank > handB.rank;
    }
    // AI: Find the best move
    findBestMove(hand, lastHand, currentLevelRank) {
        // 1. Analyze Hand
        const analysis = this.analyzeHand(hand, currentLevelRank);

        // 2. If Free Turn (Lead)
        if (!lastHand) {
            // Priority:
            // 1. Smallest Single (if not part of larger structure)
            // 2. Smallest Pair
            // 3. Smallest Triplet
            // 4. ...
            // For MVP, just dump smallest available unit that isn't a bomb.

            // Try Single
            if (analysis.singles.length > 0) return analysis.singles[0];
            // Try Pair
            if (analysis.pairs.length > 0) return analysis.pairs[0];
            // Try Triplet
            if (analysis.triplets.length > 0) return analysis.triplets[0];
            // Try Bomb (if nothing else)
            if (analysis.bombs.length > 0) return analysis.bombs[0];

            // Fallback: just play first card
            return [hand[0]];
        }

        // 3. Follow Turn
        const targetType = lastHand.type;
        const targetRank = lastHand.rank;

        // Helper to check if a candidate beats target
        const beats = (candidateCards) => {
            const candidateHand = this.validateHand(candidateCards, currentLevelRank);
            if (!candidateHand.isValid) return false;
            return this.compareHands(candidateHand, lastHand, currentLevelRank);
        };

        // Try to beat with same type
        let candidates = [];
        if (targetType === 'SINGLE') candidates = analysis.singles;
        else if (targetType === 'PAIR') candidates = analysis.pairs;
        else if (targetType === 'TRIPLET') candidates = analysis.triplets;
        else if (targetType === 'BOMB') candidates = analysis.bombs; // Will need special filtering
        else if (targetType === 'FULL_HOUSE') candidates = []; // TODO: Implement Full House finder
        else if (targetType === 'STRAIGHT') candidates = []; // TODO: Implement Straight finder
        // ... other types

        // Find smallest candidate that wins
        for (let cand of candidates) {
            if (beats(cand)) return cand;
        }

        // If target is NOT a bomb, try to bomb it
        if (targetType !== 'BOMB' && targetType !== 'KING_BOMB') {
            for (let bomb of analysis.bombs) {
                if (beats(bomb)) return bomb;
            }
        } else if (targetType === 'BOMB') {
            // Try bigger bombs
            for (let bomb of analysis.bombs) {
                if (beats(bomb)) return bomb;
            }
        }

        // Pass
        return null;
    }

    // Helper: Group hand into logical units
    analyzeHand(hand, currentLevelRank) {
        const counts = {};
        const ghosts = [];
        const normals = [];

        hand.forEach(c => {
            if (this.isGhost(c, currentLevelRank)) {
                ghosts.push(c);
            } else {
                const val = this.getCardValue(c, currentLevelRank);
                if (!counts[val]) counts[val] = [];
                counts[val].push(c);
                normals.push(c);
            }
        });

        const sortedVals = Object.keys(counts).map(Number).sort((a, b) => a - b);

        const singles = [];
        const pairs = [];
        const triplets = [];
        const bombs = [];

        // First pass: Identify Bombs (Natural)
        // Also check King Bomb
        const jokers = hand.filter(c => c.type === 'JOKER');
        if (jokers.length === 4) bombs.push(jokers);

        for (let val of sortedVals) {
            const cards = counts[val];
            if (cards.length >= 4) {
                bombs.push(cards);
            }
        }

        // Second pass: Identify smaller units (ignoring cards used in bombs? No, allow breaking for now or just list all possibilities)
        // For simple AI, let's list all disjoint possibilities.
        // Actually, listing ALL valid singles/pairs is better.

        for (let val of sortedVals) {
            const cards = counts[val];
            if (cards.length === 1) singles.push(cards);
            if (cards.length === 2) pairs.push(cards);
            if (cards.length === 3) triplets.push(cards);

            // Also allow breaking larger sets?
            if (cards.length > 1) singles.push([cards[0]]);
            if (cards.length > 2) pairs.push(cards.slice(0, 2));
            if (cards.length > 3) triplets.push(cards.slice(0, 3));
        }

        return { singles, pairs, triplets, bombs };
    }


}

module.exports = new GuandanLogic();
