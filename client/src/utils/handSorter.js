const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function getCardValue(card, levelRank) {
    if (card.type === 'JOKER') return card.val;
    const ri = RANKS.indexOf(card.rank);
    const li = RANKS.indexOf(levelRank);
    if (ri === li) return card.suit === 'H' ? 200 : 99;
    return card.rank === 'A' ? 14 : ri + 2;
}

/**
 * Default sort: by value descending, suit tiebreak (matches server logic)
 */
export function defaultSort(hand, levelRank) {
    return [...hand].sort((a, b) => {
        const va = getCardValue(a, levelRank);
        const vb = getCardValue(b, levelRank);
        if (va !== vb) return vb - va;
        return a.suit.localeCompare(b.suit);
    });
}

/**
 * Smart combo sort: groups cards by optimal combos.
 *
 * Priority:
 *   0. King bomb (2BJ + 2SJ)
 *   1. Bombs (4+ same value) — ghosts enhance the biggest bomb
 *   2. Straight flushes (5 consecutive same suit) — ghosts fill gaps
 *   3. Tubes (3 consecutive pairs)
 *   4. Plates (2 consecutive triples)
 *   5. Full houses (triple + pair)
 *   6. Straights (5 consecutive)
 *   7. Pairs
 *   8. Singles (remaining ghosts placed first)
 */
export function comboSort(hand, levelRank) {
    const getVal = c => getCardValue(c, levelRank);

    const used = new Set();
    const groups = []; // flat result array

    const free = c => !used.has(c.id);
    const consume = cards => { cards.forEach(c => used.add(c.id)); groups.push(...cards); };

    // Separate ghosts (Heart level card, val=200) from normal cards
    const ghosts = hand.filter(c => getVal(c) === 200);
    const normals = hand.filter(c => getVal(c) !== 200);
    let freeGhosts = [...ghosts];

    // Build value -> [available cards] map from unused normals
    const valMap = () => {
        const m = {};
        for (const c of normals) {
            if (free(c)) {
                const v = getVal(c);
                (m[v] || (m[v] = [])).push(c);
            }
        }
        return m;
    };

    // ==========================================
    // 0. KING BOMB (2BJ + 2SJ)
    // ==========================================
    const bjs = normals.filter(c => c.type === 'JOKER' && c.rank === 'BJ');
    const sjs = normals.filter(c => c.type === 'JOKER' && c.rank === 'SJ');
    if (bjs.length >= 2 && sjs.length >= 2) {
        consume([...bjs.slice(0, 2), ...sjs.slice(0, 2)]);
    }

    // ==========================================
    // 1. BOMBS (4+ same value) + ghost enhancement
    // ==========================================
    let vm = valMap();
    const bombEntries = Object.entries(vm)
        .filter(([, cards]) => cards.length >= 4)
        .sort((a, b) => (b[1].length - a[1].length) || (Number(b[0]) - Number(a[0])));

    for (const [, cards] of bombEntries) {
        const bombCards = [...cards];
        // Assign all remaining ghosts to the biggest bomb
        while (freeGhosts.length > 0) {
            bombCards.push(freeGhosts.shift());
        }
        consume(bombCards);
    }

    // ==========================================
    // 2. STRAIGHT FLUSHES (5 consecutive same suit)
    //    Ghosts can fill gaps
    // ==========================================
    for (const suit of ['S', 'H', 'C', 'D']) {
        let found = true;
        while (found) {
            found = false;
            // Build val -> card map for this suit (one card per value)
            const svm = {};
            for (const c of normals) {
                if (free(c) && c.suit === suit && c.type !== 'JOKER') {
                    const v = getVal(c);
                    if (v >= 2 && v <= 14 && !svm[v]) svm[v] = c;
                }
            }
            // Try highest starting value first
            for (let s = 10; s >= 2; s--) {
                const cards = [];
                let ghostsNeeded = 0;
                let ok = true;
                for (let v = s; v < s + 5; v++) {
                    if (svm[v]) {
                        cards.push(svm[v]);
                    } else if (ghostsNeeded < freeGhosts.length) {
                        cards.push(null); // placeholder
                        ghostsNeeded++;
                    } else {
                        ok = false;
                        break;
                    }
                }
                if (ok && cards.length === 5) {
                    const final = cards.map(c => c ?? freeGhosts.shift());
                    consume(final);
                    found = true;
                    break;
                }
            }
        }
    }

    // ==========================================
    // 3. TUBES (3 consecutive pairs)
    // ==========================================
    let go = true;
    while (go) {
        go = false;
        vm = valMap();
        for (let s = 2; s <= 12; s++) {
            if (vm[s]?.length >= 2 && vm[s + 1]?.length >= 2 && vm[s + 2]?.length >= 2) {
                consume([...vm[s].slice(0, 2), ...vm[s + 1].slice(0, 2), ...vm[s + 2].slice(0, 2)]);
                go = true;
                break;
            }
        }
    }

    // ==========================================
    // 4. PLATES (2 consecutive triples)
    // ==========================================
    go = true;
    while (go) {
        go = false;
        vm = valMap();
        for (let s = 2; s <= 13; s++) {
            if (vm[s]?.length >= 3 && vm[s + 1]?.length >= 3) {
                consume([...vm[s].slice(0, 3), ...vm[s + 1].slice(0, 3)]);
                go = true;
                break;
            }
        }
    }

    // ==========================================
    // 5. FULL HOUSES (triple + pair)
    // ==========================================
    go = true;
    while (go) {
        go = false;
        vm = valMap();
        // Find smallest triple
        const triples = Object.entries(vm)
            .filter(([, c]) => c.length >= 3)
            .sort((a, b) => Number(a[0]) - Number(b[0]));

        for (const [tv, tc] of triples) {
            // Find smallest available pair (different value)
            const pair = Object.entries(vm)
                .filter(([v, c]) => Number(v) !== Number(tv) && c.length >= 2)
                .sort((a, b) => Number(a[0]) - Number(b[0]))[0];

            if (pair) {
                consume([...tc.slice(0, 3), ...pair[1].slice(0, 2)]);
                go = true;
                break;
            }
        }
    }

    // ==========================================
    // 6. STRAIGHTS (5 consecutive)
    // ==========================================
    go = true;
    while (go) {
        go = false;
        vm = valMap();
        for (let s = 2; s <= 10; s++) {
            let ok = true;
            const cards = [];
            for (let v = s; v < s + 5; v++) {
                if (vm[v]?.length > 0) {
                    cards.push(vm[v][0]);
                } else {
                    ok = false;
                    break;
                }
            }
            if (ok) {
                consume(cards);
                go = true;
                break;
            }
        }
    }

    // ==========================================
    // 7. PAIRS
    // ==========================================
    vm = valMap();
    const pairEntries = Object.entries(vm)
        .filter(([, c]) => c.length >= 2)
        .sort((a, b) => Number(b[0]) - Number(a[0]));

    for (const [, cards] of pairEntries) {
        // Rebuild to avoid stale data after previous pair consumed
        if (cards.filter(c => free(c)).length >= 2) {
            consume(cards.filter(c => free(c)).slice(0, 2));
        }
    }

    // ==========================================
    // 8. SINGLES (remaining ghosts first, then normals)
    // ==========================================
    const singles = normals.filter(c => free(c)).sort((a, b) => getVal(b) - getVal(a));
    groups.push(...freeGhosts, ...singles);

    return groups;
}
