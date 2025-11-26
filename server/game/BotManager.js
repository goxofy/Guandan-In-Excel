const GuandanLogic = require('./GuandanLogic');

class BotManager {
    constructor(io, room) {
        this.io = io;
        this.room = room;
        this.bots = [];
        this.thinkingTimers = {};
    }

    addBot(botId, name, index) {
        this.bots.push({ id: botId, name, index });
    }

    // Called when game state updates
    onGameStateUpdate() {
        const room = this.room;

        if (room.gameState === 'TRIBUTE') {
            this.handleTribute(room);
            return;
        }

        if (room.gameState !== 'PLAYING') return;

        const currentPlayer = room.players[room.turnIndex];
        // console.log(`[BotManager] Turn: ${currentPlayer.name} (${currentPlayer.id})`);

        const bot = this.bots.find(b => b.id === currentPlayer.id);

        if (bot) {
            // It's a bot's turn
            // console.log(`[BotManager] Scheduling move for ${bot.name}`);
            this.scheduleMove(bot);
        }
    }

    handleTribute(room) {
        // Check if any bot needs to pay tribute or return card
        const pendingActions = room.tributePending || [];

        pendingActions.forEach(action => {
            const bot = this.bots.find(b => b.id === action.from);
            if (bot) {
                // Bot needs to act
                // Check if already scheduled?
                if (this.thinkingTimers[bot.id]) return; // Already thinking

                console.log(`[BotManager] ${bot.name} needs to ${action.type}`);

                this.thinkingTimers[bot.id] = setTimeout(() => {
                    this.makeTributeMove(bot, action);
                }, 1000 + Math.random() * 2000);
            }
        });
    }

    makeTributeMove(bot, action) {
        const room = this.room;
        const player = room.players.find(p => p.id === bot.id);
        if (!player) return;

        // Logic for Tribute/Return
        let cardIndex = -1;

        if (action.type === 'PAY' || action.type === 'PAY_DOUBLE') {
            // Pay largest card (excluding Hearts Level Card if rule says so? Usually just largest)
            // Guandan rule: Pay largest. If Heart Level Card, can keep? 
            // Standard: Pay largest. Red Level Card (Ghost) cannot be paid? 
            // Let's assume pay largest value card.
            // Sort hand first to be sure
            // Actually hand is sorted. 0 is largest?
            // GuandanLogic.sortHand sorts Descending?
            // Let's check sortHand.
            // Yes, valB - valA. So index 0 is largest.
            // But need to avoid paying Ghost if rule says so?
            // Rule: "进贡最大牌（逢人配除外）" (Pay largest, except Ghost).

            for (let i = 0; i < player.hand.length; i++) {
                const card = player.hand[i];
                if (!GuandanLogic.isGhost(card, room.currentLevelRank)) {
                    cardIndex = i;
                    break;
                }
            }
            // If all ghosts? Pay ghost.
            if (cardIndex === -1) cardIndex = 0;

            console.log(`[BotManager] ${bot.name} paying tribute card index ${cardIndex}`);
            if (this.onBotPayTribute) this.onBotPayTribute(bot.id, cardIndex);

        } else if (action.type === 'RETURN') {
            // Return any card (usually small one, or specific strategy)
            // For MVP, return smallest card (last index).
            // But maybe not Level Card?
            // Just return last card.
            cardIndex = player.hand.length - 1;
            console.log(`[BotManager] ${bot.name} returning card index ${cardIndex}`);
            if (this.onBotReturnCard) this.onBotReturnCard(bot.id, cardIndex);
        }

        // Clear timer
        delete this.thinkingTimers[bot.id];
    }

    scheduleMove(bot) {
        // Cancel existing timer if any (though shouldn't happen for same bot)
        if (this.thinkingTimers[bot.id]) clearTimeout(this.thinkingTimers[bot.id]);

        // Simulate thinking time (1-3 seconds)
        const delay = 1000 + Math.random() * 2000;

        this.thinkingTimers[bot.id] = setTimeout(() => {
            this.makeMove(bot);
        }, delay);
    }

    makeMove(bot) {
        const room = this.room;
        const player = room.players.find(p => p.id === bot.id);

        if (!player) return; // Bot removed?

        // Determine last hand
        let lastHand = room.lastPlayedHand;
        if (lastHand && lastHand.playerId === bot.id) {
            lastHand = null; // Free turn
        }

        console.log(`[BotManager] ${bot.name} thinking. LastHand: ${lastHand ? lastHand.type : 'None'}`);

        try {
            // Ask AI
            const cardsToPlay = GuandanLogic.findBestMove(player.hand, lastHand, room.currentLevelRank);

            if (cardsToPlay) {
                console.log(`[BotManager] ${bot.name} found move: ${cardsToPlay.length} cards`);
                // Convert to indices
                const indices = [];
                const handIds = player.hand.map(c => c.id);

                cardsToPlay.forEach(c => {
                    const idx = handIds.indexOf(c.id);
                    if (idx !== -1) {
                        indices.push(idx);
                        handIds[idx] = null; // Avoid double counting
                    }
                });

                // Emit move (simulate socket event)
                // We need to call the handler directly or emit via a fake socket?
                // Since we are on server, we can call a callback or emit to a local emitter.
                // But server.js expects socket events.
                // Better to expose a method in server.js or emit to a special internal channel.
                // Or, we can pass a callback "onMove" to BotManager.

                if (this.onBotMove) {
                    this.onBotMove(bot.id, indices);
                }
            } else {
                console.log(`[BotManager] ${bot.name} passes`);
                // Pass
                if (this.onBotPass) {
                    this.onBotPass(bot.id);
                }
            }
        } catch (e) {
            console.error(`[BotManager] Error in makeMove for ${bot.name}:`, e);
        }
    }

    // Clean up
    destroy() {
        Object.values(this.thinkingTimers).forEach(t => clearTimeout(t));
        this.thinkingTimers = {};
    }
}

module.exports = BotManager;
