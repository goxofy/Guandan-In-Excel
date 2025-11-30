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
        console.log(`[BotManager] handleTribute called. Pending:`, pendingActions);
        console.log(`[BotManager] Current bots:`, this.bots.map(b => b.id));

        // Clear stale timers if we are just entering tribute?
        // Actually, if we are in TRIBUTE, any previous 'thinking' for PLAYING is invalid.
        // But we don't want to clear the timer we JUST set for tribute.
        // So we should clear timers when state transitions.
        // But here, let's just force clear if we are about to schedule.
        // Or better: clear all timers when entering TRIBUTE?
        // We can't easily detect "entering" here without state tracking.
        // But we can check if the timer exists and if it's "stale".
        // Since we don't track timer type, let's just clear it if we find a bot that needs to act.
        // Because if it has a timer, it's either from PLAYING (stale) or TRIBUTE (already scheduled).
        // If it's already scheduled, we return.
        // But how do we distinguish?
        // We can add a flag to the timer or store tribute timers separately?
        // Or just assume that if handleTribute is called, we should be the one setting the timer.
        // If a timer exists, maybe we should clear it and reset it?
        // But if we call handleTribute repeatedly (on every update), we don't want to reset it constantly.

        // Solution: When game ends (or starts), clear all timers.
        // But we are in BotManager.
        // Let's clear timers for the specific bot if we are about to schedule, 
        // BUT we need to know if it's a "Tribute Timer" or "Playing Timer".
        // Let's use a different property for tribute timers? 
        // Or just clear 'thinkingTimers' in 'onGameStateUpdate' if state changed?
        // We don't track previous state here.

        // Hack: If we find a bot needs to act, and it has a timer, we assume it's STALE if it's been too long?
        // No.

        // Better: In server.js, when state changes to TRIBUTE, call botManager.resetTimers().
        // But let's try to fix it here locally.
        // If we see a pending action for a bot, and it has a timer, we can't be sure.
        // BUT, if the bot is "thinking" about a move, it shouldn't be, because state is TRIBUTE.
        // So any existing timer MUST be stale (or from a previous handleTribute call).
        // If it's from a previous handleTribute call, we shouldn't clear it.
        // How to distinguish?
        // We can tag the timer.

        // Let's just clear ALL timers in `startGame` in server.js? 
        // No, BotManager manages them.

        // Let's add a `reset()` method and call it from server.js when game starts.
        // Or, in `handleTribute`, we can check a flag `tributeScheduled`.

        // Let's try this:
        // If we are in TRIBUTE, we only want to schedule ONCE.
        // We can use a Set `tributeScheduledBots`.

        if (!this.tributeScheduledBots) this.tributeScheduledBots = new Set();

        pendingActions.forEach(action => {
            const bot = this.bots.find(b => b.id === action.from);
            console.log(`[BotManager] Checking action from ${action.from}. Found bot:`, bot ? bot.id : 'undefined');
            if (bot) {
                // If we haven't scheduled this bot for this tribute phase yet
                // But tribute phase can have multiple steps (Pay -> Return).
                // So we need to clear the flag when action completes.

                // Let's just use the fact that if `thinkingTimers[bot.id]` exists, it MIGHT be stale.
                // If we force clear it, we might double schedule if handleTribute is called rapidly.
                // But handleTribute is called on state update.

                // Let's assume the issue IS stale timers from PLAYING.
                // We can clear all timers if we detect we are in TRIBUTE and we haven't cleared them yet?
                // Too complex.

                // Simplest fix: In `makeMove`, if state is TRIBUTE, just exit.
                // AND, in `handleTribute`, if we see a timer, we assume it's valid TRIBUTE timer?
                // No, that's the bug. It assumes it's valid, but it's stale.

                // So we MUST clear stale timers.
                // Let's just clear the timer if we are in TRIBUTE and the timer was set for PLAYING.
                // We can store `timerType` in `thinkingTimers`.
                // this.thinkingTimers[bot.id] = { timer: ..., type: 'PLAYING'|'TRIBUTE' }

                // Refactor thinkingTimers to store object.

                let timerData = this.thinkingTimers[bot.id];
                if (timerData && timerData.type === 'PLAYING') {
                    console.log(`[BotManager] Clearing stale PLAYING timer for ${bot.name}`);
                    clearTimeout(timerData.timer);
                    delete this.thinkingTimers[bot.id];
                    timerData = null;
                }

                if (timerData) return; // Already thinking (TRIBUTE)

                console.log(`[BotManager] ${bot.name} needs to ${action.type}`);

                const timer = setTimeout(() => {
                    this.makeTributeMove(bot, action);
                }, 1000 + Math.random() * 2000);

                this.thinkingTimers[bot.id] = { timer, type: 'TRIBUTE' };
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
        if (this.thinkingTimers[bot.id]) {
            clearTimeout(this.thinkingTimers[bot.id].timer);
        }

        // Simulate thinking time (1-3 seconds)
        const delay = 1000 + Math.random() * 2000;

        const timer = setTimeout(() => {
            this.makeMove(bot);
        }, delay);

        this.thinkingTimers[bot.id] = { timer, type: 'PLAYING' };
    }

    makeMove(bot) {
        const room = this.room;

        // If we are in TRIBUTE, abort!
        if (room.gameState === 'TRIBUTE') {
            console.log(`[BotManager] makeMove called for ${bot.name} but state is TRIBUTE. Aborting.`);
            delete this.thinkingTimers[bot.id];
            return;
        }

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

        delete this.thinkingTimers[bot.id];
    }

    // Clean up
    destroy() {
        Object.values(this.thinkingTimers).forEach(t => clearTimeout(t.timer));
        this.thinkingTimers = {};
    }
}

module.exports = BotManager;
