const GuandanLogic = require('./game/GuandanLogic');

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ FAILED: ${message}`);
        process.exit(1);
    } else {
        console.log(`✅ PASSED: ${message}`);
    }
}

console.log('Testing GuandanLogic validation...');

const currentLevelRank = '2';

// Helper to create mock cards
const c = (rank, suit = 'S') => ({ rank, suit, type: 'NORMAL' });
const joker = (type) => ({ rank: type, suit: 'JOKER', type: 'JOKER', val: type === 'SJ' ? 100 : 101 });

// 1. Single
assert(GuandanLogic.validateHand([c('3')], currentLevelRank).type === 'SINGLE', 'Single 3');
assert(GuandanLogic.validateHand([joker('SJ')], currentLevelRank).type === 'SINGLE', 'Single Joker');

// 2. Pair
assert(GuandanLogic.validateHand([c('3'), c('3', 'H')], currentLevelRank).type === 'PAIR', 'Pair 3');
assert(GuandanLogic.validateHand([c('3'), c('4')], currentLevelRank).isValid === false, 'Invalid Pair');

// 3. Triplet
assert(GuandanLogic.validateHand([c('3'), c('3', 'H'), c('3', 'D')], currentLevelRank).type === 'TRIPLET', 'Triplet 3');

// 4. Bomb
assert(GuandanLogic.validateHand([c('3'), c('3', 'H'), c('3', 'D'), c('3', 'C')], currentLevelRank).type === 'BOMB', 'Bomb 3 (4 cards)');
assert(GuandanLogic.validateHand([c('3'), c('3', 'H'), c('3', 'D'), c('3', 'C'), c('3', 'S')], currentLevelRank).type === 'BOMB', 'Bomb 3 (5 cards)');

// 5. Full House
assert(GuandanLogic.validateHand([c('3'), c('3', 'H'), c('3', 'D'), c('4'), c('4', 'H')], currentLevelRank).type === 'FULL_HOUSE', 'Full House 33344');

// 6. Straight
assert(GuandanLogic.validateHand([c('3'), c('4'), c('5'), c('6'), c('7')], currentLevelRank).type === 'STRAIGHT', 'Straight 34567');
assert(GuandanLogic.validateHand([c('3'), c('4'), c('5'), c('6'), c('8')], currentLevelRank).isValid === false, 'Invalid Straight');

// 7. Plate
assert(GuandanLogic.validateHand([c('3'), c('3', 'H'), c('3', 'D'), c('4'), c('4', 'H'), c('4', 'D')], currentLevelRank).type === 'PLATE', 'Plate 333444');

// 8. Tube
assert(GuandanLogic.validateHand([c('3'), c('3', 'H'), c('4'), c('4', 'H'), c('5'), c('5', 'H')], currentLevelRank).type === 'TUBE', 'Tube 334455');

console.log('All tests passed!');
