const GuandanLogic = require('./game/GuandanLogic');

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ FAILED: ${message}`);
        process.exit(1);
    } else {
        console.log(`✅ PASSED: ${message}`);
    }
}

console.log('Testing GuandanLogic comparison...');

const currentLevelRank = '2';

// Helper to create mock validated hands
const hand = (type, rank, count = 0) => ({ type, rank, count, isValid: true });

// 1. Single vs Single
assert(GuandanLogic.compareHands(hand('SINGLE', 5), hand('SINGLE', 4), currentLevelRank) === true, 'Single 5 > Single 4');
assert(GuandanLogic.compareHands(hand('SINGLE', 3), hand('SINGLE', 4), currentLevelRank) === false, 'Single 3 < Single 4');

// 2. Pair vs Pair
assert(GuandanLogic.compareHands(hand('PAIR', 14), hand('PAIR', 13), currentLevelRank) === true, 'Pair A > Pair K');

// 3. Bomb vs Normal
assert(GuandanLogic.compareHands(hand('BOMB', 3, 4), hand('STRAIGHT', 10), currentLevelRank) === true, 'Bomb > Straight');
assert(GuandanLogic.compareHands(hand('STRAIGHT', 10), hand('BOMB', 3, 4), currentLevelRank) === false, 'Straight < Bomb');

// 4. Bomb vs Bomb
// More cards better
assert(GuandanLogic.compareHands(hand('BOMB', 3, 5), hand('BOMB', 14, 4), currentLevelRank) === true, 'Bomb(5) > Bomb(4)');
// Same count, higher rank better
assert(GuandanLogic.compareHands(hand('BOMB', 4, 4), hand('BOMB', 3, 4), currentLevelRank) === true, 'Bomb(4, Rank 4) > Bomb(4, Rank 3)');

// 5. King Bomb
assert(GuandanLogic.compareHands(hand('KING_BOMB', 999), hand('BOMB', 14, 10), currentLevelRank) === true, 'King Bomb > 10-card Bomb');

// 6. Free Play
assert(GuandanLogic.compareHands(hand('SINGLE', 3), null, currentLevelRank) === true, 'Free play always valid');

console.log('All comparison tests passed!');
