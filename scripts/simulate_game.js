const { io } = require("socket.io-client");
const GuandanLogic = require("../server/game/GuandanLogic");

const SERVER_URL = "http://localhost:3001";
const ROOM_ID = "test_room_" + Math.floor(Math.random() * 1000);

console.log(`Starting simulation for room: ${ROOM_ID}`);

const bots = [];
const NUM_BOTS = 4;

// Helper to find playable hand
function findPlayableHand(myHand, lastHand, currentLevelRank, myPlayerId) {
    // Group cards by rank
    const counts = {};
    myHand.forEach(c => {
        const val = GuandanLogic.getCardValue(c, currentLevelRank);
        if (!counts[val]) counts[val] = [];
        counts[val].push(c);
    });

    const sortedVals = Object.keys(counts).map(Number).sort((a, b) => a - b);

    // If free turn, play smallest available
    if (!lastHand || lastHand.playerId === myPlayerId) {
        // Just play smallest single
        const smallestVal = sortedVals[0];
        const cards = counts[smallestVal];
        // Try single
        return [cards[0]];
    }

    // If following
    const targetType = lastHand.type;
    const targetRank = lastHand.rank;
    const targetCount = lastHand.count; // For bombs

    // Try to beat with same type
    if (targetType === 'SINGLE') {
        for (let val of sortedVals) {
            if (val > targetRank) return [counts[val][0]];
        }
    }
    else if (targetType === 'PAIR') {
        for (let val of sortedVals) {
            if (val > targetRank && counts[val].length >= 2) return counts[val].slice(0, 2);
        }
    }
    else if (targetType === 'TRIPLET') {
        for (let val of sortedVals) {
            if (val > targetRank && counts[val].length >= 3) return counts[val].slice(0, 3);
        }
    }
    else if (targetType === 'BOMB') {
        for (let val of sortedVals) {
            const count = counts[val].length;
            if (count >= 4) {
                // Check if beats
                // 1. Count > targetCount
                // 2. Count == targetCount && Rank > targetRank
                if (count > targetCount || (count === targetCount && val > targetRank)) {
                    return counts[val];
                }
            }
        }
    }

    // Try to bomb it (if target is not bomb or smaller bomb)
    if (targetType !== 'BOMB' && targetType !== 'KING_BOMB') {
        for (let val of sortedVals) {
            if (counts[val].length >= 4) return counts[val];
        }
    }

    return null; // Pass
}

// Bot Class
class Bot {
    constructor(index, userId) {
        this.index = index;
        this.userId = userId;
        this.socket = io(SERVER_URL);
        this.name = `Bot ${index}`;
        this.hand = [];
        this.myPlayerId = null;

        this.setupEvents();
    }

    setupEvents() {
        this.socket.on("connect", () => {
            console.log(`${this.name} connected (${this.socket.id})`);
            this.myPlayerId = this.socket.id;
            this.socket.emit("joinRoom", { roomId: ROOM_ID, playerName: this.name, userId: this.userId });
        });

        this.socket.on("gameError", (msg) => {
            console.error(`${this.name} Error:`, msg);
        });

        this.socket.on("playerJoined", (players) => {
            if (players.length === 4 && this.index === 0) {
                // console.log("Room full, starting game...");
                // this.socket.emit("startGame", ROOM_ID);
            }
        });

        this.socket.on("gameReady", () => {
            if (this.index === 0) {
                console.log("Room full, starting game...");
                this.socket.emit("startGame", ROOM_ID);
            }
        });

        this.socket.on("gameStarted", (data) => {
            // console.log(`${this.name}: Game State Update. Turn: ${data.turnIndex}`);
            if (this.index === 0) {
                console.log(`\n--- Round Info ---`);
                console.log(`Current Level Rank: ${data.currentLevelRank}`);
                if (data.teamLevels) {
                    console.log(`Team Levels: A=${data.teamLevels.A}, B=${data.teamLevels.B}`);
                }
            }

            this.hand = data.myHand;
            const myPlayer = data.players.find(p => p.userId === this.userId);
            if (myPlayer) {
                this.myPlayerId = myPlayer.id; // Update socket id if changed
                if (data.turnIndex === myPlayer.index) {
                    // My turn!
                    setTimeout(() => this.playTurn(data), 1000);
                }
            }
        });

        this.socket.on("gameEnded", (data) => {
            console.log(`${this.name}: Game Ended! Winner: ${data.finalWinner || data.rankings[0]}`);
            if (data.teamLevels) {
                console.log(`New Team Levels: A=${data.teamLevels.A}, B=${data.teamLevels.B}`);
                console.log(`Next Level Rank: ${data.nextLevel}`);
            }
            if (this.index === 0) process.exit(0);
        });
    }

    playTurn(gameState) {
        console.log(`${this.name} thinking... Hand size: ${this.hand.length}`);

        // Check if I am the leader (free play)
        // gameState.lastPlayedHand is null OR lastPlayedHand.playerId === myPlayerId
        let lastHand = gameState.lastPlayedHand;
        if (lastHand && lastHand.playerId === this.myPlayerId) {
            lastHand = null;
        }

        const cardsToPlay = findPlayableHand(this.hand, lastHand, gameState.currentLevelRank, this.myPlayerId);

        if (cardsToPlay) {
            // Convert to indices
            // We need to find indices of these cards in our hand
            // Since hand objects might be different instances, match by ID
            const indices = [];
            const handIds = this.hand.map(c => c.id);

            cardsToPlay.forEach(c => {
                const idx = handIds.indexOf(c.id);
                if (idx !== -1) {
                    indices.push(idx);
                    handIds[idx] = null; // Mark used to avoid double counting
                }
            });

            console.log(`${this.name} plays ${cardsToPlay.length} cards`);
            this.socket.emit("playCards", { roomId: ROOM_ID, cardIndices: indices });
        } else {
            console.log(`${this.name} passes`);
            this.socket.emit("passTurn", { roomId: ROOM_ID });
        }
    }

    disconnect() {
        this.socket.disconnect();
    }

    reconnect() {
        this.socket = io(SERVER_URL);
        this.setupEvents();
    }
}

// Create Bots
for (let i = 0; i < NUM_BOTS; i++) {
    const userId = `bot_${i}_${Date.now()}`;
    const bot = new Bot(i, userId);
    bots.push(bot);
}

// Reconnection Test (Optional, commented out for full game sim)
/*
setTimeout(() => {
    console.log("\n--- Starting Reconnection Test ---");
    console.log("Disconnecting Bot 0...");
    bots[0].disconnect();
    
    setTimeout(() => {
        console.log("Reconnecting Bot 0...");
        bots[0].reconnect();
    }, 2000);
}, 5000);
*/

// Keep script running
setInterval(() => { }, 1000);
