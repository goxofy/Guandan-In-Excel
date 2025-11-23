const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all for dev
        methods: ["GET", "POST"]
    }
});

const GuandanLogic = require('./game/GuandanLogic');

// Simple in-memory storage
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createRoom', (roomId) => {
        if (rooms.has(roomId)) {
            socket.emit('error', 'Room already exists');
            return;
        }
        // Initialize room state
        rooms.set(roomId, {
            id: roomId,
            players: [],
            gameState: 'WAITING', // WAITING, PLAYING
            currentLevelRank: '2', // Start from 2
            deck: [],
            tableCards: [], // Cards played on table
            turnIndex: 0
        });
        socket.emit('roomCreated', roomId);
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        let room = rooms.get(roomId);
        if (!room) {
            // Auto-create room if it doesn't exist
            room = {
                id: roomId,
                players: [],
                gameState: 'WAITING',
                currentLevelRank: '2',
                deck: [],
                tableCards: [],
                turnIndex: 0
            };
            rooms.set(roomId, room);
            console.log(`Auto-created room ${roomId}`);
        }

        if (room.players.length >= 4) {
            socket.emit('error', 'Room is full');
            return;
        }

        // Check if player already in room (reconnect)
        const existingPlayer = room.players.find(p => p.id === socket.id);
        if (existingPlayer) {
            socket.emit('gameState', room);
            return;
        }

        const player = {
            id: socket.id,
            name: playerName || `Player ${room.players.length + 1}`,
            index: room.players.length,
            hand: [],
            team: room.players.length % 2 === 0 ? 'A' : 'B' // 0&2 vs 1&3
        };

        room.players.push(player);
        socket.join(roomId);

        io.to(roomId).emit('playerJoined', room.players);

        if (room.players.length === 4) {
            io.to(roomId).emit('gameReady');
        }
    });

    socket.on('startGame', (roomId) => {
        const room = rooms.get(roomId);
        if (!room) return;

        if (room.players.length < 4) {
            socket.emit('error', 'Need 4 players to start');
            return;
        }

        // Generate and shuffle deck
        const deck = GuandanLogic.createDeck();

        // Deal cards
        for (let i = 0; i < 4; i++) {
            if (room.players[i]) {
                room.players[i].hand = deck.slice(i * 27, (i + 1) * 27);
                GuandanLogic.sortHand(room.players[i].hand, room.currentLevelRank);
            }
        }

        // Check for Tribute Phase
        // If coming from GAME_OVER_WIN, reset everything
        if (room.gameState === 'GAME_OVER_WIN') {
            room.rankings = [];
            room.teamLevels = { 'A': 2, 'B': 2 };
            room.currentLevelRank = '2';
            room.gameState = 'PLAYING';
            // No tribute
        } else if (room.rankings && room.rankings.length === 4) {
            room.gameState = 'TRIBUTE';
            room.tributePending = []; // { from: pid, to: pid, type: 'PAY'|'RETURN'|'PAY_DOUBLE' }
            room.tributeBuffer = []; // Store cards for Double Tribute comparison

            // Determine Tribute Type
            const p1 = room.players.find(p => p.id === room.rankings[0]);
            const p2 = room.players.find(p => p.id === room.rankings[1]);
            const p3 = room.players.find(p => p.id === room.rankings[2]);
            const p4 = room.players.find(p => p.id === room.rankings[3]);

            if (p1.team === p2.team) {
                // Double Tribute (双上)
                // Both losers pay. We don't know destination yet.
                room.tributePending.push({ from: p3.id, type: 'PAY_DOUBLE' });
                room.tributePending.push({ from: p4.id, type: 'PAY_DOUBLE' });
            } else {
                // Single Tribute (单上)
                // p4 -> p1 (PAY)
                room.tributePending.push({ from: p4.id, to: p1.id, type: 'PAY' });
            }
        } else {
            room.gameState = 'PLAYING';
            room.turnIndex = 0; // Randomize?
        }

        // Emit game state
        room.players.forEach(p => {
            io.to(p.id).emit('gameStarted', {
                ...room,
                myHand: p.hand,
                players: room.players.map(op => ({ ...op, hand: op.id === p.id ? op.hand : op.hand.length }))
            });
        });
        broadcastGameState(room);
    });

    socket.on('playCards', ({ roomId, cardIndices }) => {
        const room = rooms.get(roomId);
        if (!room || room.gameState !== 'PLAYING') return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        // Check turn
        if (room.players[room.turnIndex].id !== socket.id) {
            socket.emit('error', 'Not your turn');
            return;
        }

        // Validate indices
        if (!cardIndices || cardIndices.length === 0) return;

        // Get actual cards
        const playedCards = cardIndices.map(idx => player.hand[idx]);

        // Validate hand type using GuandanLogic
        const validationResult = GuandanLogic.validateHand(playedCards, room.currentLevelRank);
        if (!validationResult.isValid) {
            socket.emit('error', 'Invalid hand type');
            return;
        }

        // Validate if hand beats previous hand
        if (room.lastPlayedHand && room.lastPlayedHand.playerId !== socket.id) {
            // If I am not the last one who played (i.e. not a new round started by me after everyone passed)
            // Check if my hand beats the last hand
            if (!GuandanLogic.compareHands(validationResult, room.lastPlayedHand, room.currentLevelRank)) {
                socket.emit('error', 'Your hand is not big enough');
                return;
            }
        }

        // Remove cards from hand
        const indicesToRemove = new Set(cardIndices);
        player.hand = player.hand.filter((_, idx) => !indicesToRemove.has(idx));

        // Update table cards and game state
        room.tableCards = playedCards;
        room.lastPlayedHand = { ...validationResult, playerId: socket.id };
        room.passCount = 0; // Reset pass count

        // Check if player finished
        if (player.hand.length === 0) {
            // Record ranking
            if (!room.rankings) room.rankings = []; // Should be initialized already, but good for safety
            room.rankings.push(player.id);

            // Check if game over (3 players finished, or 2 players from same team finished?)
            // Simple rule: 3 players finished -> Game Over.
            // Or: Team A finished (both players) -> Game Over.

            const teamA = room.players.filter(p => p.team === 'A');
            const teamB = room.players.filter(p => p.team === 'B');
            const teamAFinished = teamA.every(p => p.hand.length === 0);
            const teamBFinished = teamB.every(p => p.hand.length === 0);

            if (room.rankings.length === 3 || teamAFinished || teamBFinished) {
                // Game Over
                // Add last player to rankings if not already
                const lastPlayer = room.players.find(p => !room.rankings.includes(p.id));
                if (lastPlayer) room.rankings.push(lastPlayer.id);

                // Calculate Level Up
                const p1 = room.players.find(p => p.id === room.rankings[0]);
                const p2 = room.players.find(p => p.id === room.rankings[1]);
                const p3 = room.players.find(p => p.id === room.rankings[2]);
                // const p4 = room.players.find(p => p.id === room.rankings[3]);

                let levelJump = 0;
                let winningTeam = p1.team;

                if (p1.team === p2.team) {
                    // Double Victory (1st & 2nd)
                    levelJump = 3;
                } else if (p1.team === p3.team) {
                    // Single Victory (1st & 3rd)
                    levelJump = 2;
                } else {
                    // 1st & 4th
                    levelJump = 1;
                }

                // Update Level
                // Map ranks to values: 2->2 ... A->14
                const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
                let currentVal = ranks.indexOf(room.currentLevelRank) + 2;

                // Who levels up? The winning team.
                // But room.currentLevelRank is global?
                // Actually, level belongs to the team.
                // For MVP, let's assume we track level for the room (current active level).
                // If winning team matches current level holder?
                // Wait, usually:
                // Team A is on Level 2. Team B is on Level 2.
                // If Team A wins, they go to Level 2 + Jump.
                // Next game plays Team A's level.
                // We need to track level per team.

                if (!room.teamLevels) {
                    room.teamLevels = { 'A': 2, 'B': 2 }; // Start at 2
                }

                // Update winner's level
                room.teamLevels[winningTeam] += levelJump;

                // Check Win Condition (Pass A)
                // If level > 14 (A), they win the game?
                // Or must play A and win?
                // "First team to pass level A wins" -> Level > 14.
                if (room.teamLevels[winningTeam] > 14) {
                    room.gameState = 'GAME_OVER_WIN'; // Final Victory
                    io.to(roomId).emit('gameEnded', {
                        rankings: room.rankings,
                        finalWinner: winningTeam,
                        teamLevels: room.teamLevels
                    });
                    return;
                }

                // Set next game level
                const nextLevelVal = room.teamLevels[winningTeam];
                // Map back to rank
                // 2->0, 14->12.
                // If > 14, cap at A (but we handled win above).
                // If jump makes it > 14? e.g. 13 (K) + 3 = 16.
                // If they were at K, and jump 3, they pass A and win.
                // So check above covers it.

                // If they are at A (14), they play A.
                // If they win at A, they pass A (14+jump > 14).

                let nextRankIndex = nextLevelVal - 2;
                if (nextRankIndex >= ranks.length) nextRankIndex = ranks.length - 1; // Should not happen if win check works

                room.currentLevelRank = ranks[nextRankIndex];

                room.gameState = 'ENDED';
                io.to(roomId).emit('gameEnded', {
                    rankings: room.rankings,
                    levelJump,
                    nextLevel: room.currentLevelRank,
                    teamLevels: room.teamLevels
                });
                return; // Stop here
            }
        }

        // Move turn
        // If current player finished, turn goes to next.
        // But if next player also finished, skip.
        let nextTurnIndex = (room.turnIndex + 1) % 4;
        let loopCount = 0;
        while (room.players[nextTurnIndex].hand.length === 0 && loopCount < 4) {
            nextTurnIndex = (nextTurnIndex + 1) % 4;
            loopCount++;
        }
        room.turnIndex = nextTurnIndex;

        broadcastGameState(room);
    });

    socket.on('passTurn', ({ roomId }) => { // Destructure roomId
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('gameError', 'Room not found - Please refresh/rejoin');
            return;
        }

        // Check if it's player's turn
        if (room.players[room.turnIndex].id !== socket.id) {
            socket.emit('gameError', 'Not your turn');
            return;
        }

        // Cannot pass if it's a free play (you must play)
        if (!room.lastPlayedHand || room.lastPlayedHand.playerId === socket.id) {
            socket.emit('gameError', 'Cannot pass on free turn');
            return;
        }

        room.passCount = (room.passCount || 0) + 1;

        // Calculate needed passes to end round
        const activePlayers = room.players.filter(p => p.hand.length > 0);
        const activeCount = activePlayers.length;

        let lastWinnerIsActive = false;
        if (room.lastPlayedHand) {
            const winner = room.players.find(p => p.id === room.lastPlayedHand.playerId);
            if (winner && winner.hand.length > 0) {
                lastWinnerIsActive = true;
            }
        }

        const neededPasses = lastWinnerIsActive ? (activeCount - 1) : activeCount;

        if (room.passCount >= neededPasses) {
            // Round Over
            const winnerId = room.lastPlayedHand.playerId;
            const winner = room.players.find(p => p.id === winnerId);

            room.lastPlayedHand = null;
            room.tableCards = [];
            room.passCount = 0;

            if (winner) {
                if (winner.hand.length > 0) {
                    // Winner still playing, they lead
                    room.turnIndex = winner.index;
                } else {
                    // Winner finished -> Jiefeng (Partner leads)
                    const partnerIndex = (winner.index + 2) % 4;
                    const partner = room.players[partnerIndex];

                    if (partner && partner.hand.length > 0) {
                        room.turnIndex = partnerIndex;
                    } else {
                        // Partner also finished or left
                        let nextIndex = (winner.index + 1) % 4;
                        let loop = 0;
                        while (room.players[nextIndex].hand.length === 0 && loop < 4) {
                            nextIndex = (nextIndex + 1) % 4;
                            loop++;
                        }
                        room.turnIndex = nextIndex;
                    }
                }
            } else {
                // Winner left? Just move to next active
                let nextTurnIndex = (room.turnIndex + 1) % 4;
                let loopCount = 0;
                while (room.players[nextTurnIndex].hand.length === 0 && loopCount < 4) {
                    nextTurnIndex = (nextTurnIndex + 1) % 4;
                    loopCount++;
                }
                room.turnIndex = nextTurnIndex;
            }
        } else {
            // Round continues, move to next active player
            let nextTurnIndex = (room.turnIndex + 1) % 4;
            let loopCount = 0;
            while (room.players[nextTurnIndex].hand.length === 0 && loopCount < 4) {
                nextTurnIndex = (nextTurnIndex + 1) % 4;
                loopCount++;
            }
            room.turnIndex = nextTurnIndex;
        }

        broadcastGameState(room);
    });

    function broadcastGameState(room) {
        room.players.forEach(p => {
            io.to(p.id).emit('gameStarted', {
                ...room,
                myHand: p.hand,
                players: room.players.map(op => ({ ...op, hand: op.id === p.id ? op.hand : op.hand.length }))
            });
        });
    }

    socket.on('payTribute', ({ roomId, cardIndex }) => {
        const room = rooms.get(roomId);
        if (!room || room.gameState !== 'TRIBUTE') return;

        // Find pending action
        const actionIndex = room.tributePending.findIndex(a => a.from === socket.id && (a.type === 'PAY' || a.type === 'PAY_DOUBLE'));
        if (actionIndex === -1) {
            socket.emit('error', 'No tribute required from you');
            return;
        }
        const action = room.tributePending[actionIndex];
        const fromPlayer = room.players.find(p => p.id === action.from);
        const card = fromPlayer.hand[cardIndex];

        if (action.type === 'PAY') {
            const toPlayer = room.players.find(p => p.id === action.to);

            // Move card
            fromPlayer.hand.splice(cardIndex, 1);
            toPlayer.hand.push(card);
            GuandanLogic.sortHand(toPlayer.hand, room.currentLevelRank);

            // Remove pending action
            room.tributePending.splice(actionIndex, 1);

            // Add Return action
            room.tributePending.push({ from: toPlayer.id, to: fromPlayer.id, type: 'RETURN' });
        } else if (action.type === 'PAY_DOUBLE') {
            // Move card to buffer
            fromPlayer.hand.splice(cardIndex, 1);
            if (!room.tributeBuffer) room.tributeBuffer = []; // Initialize if not exists
            room.tributeBuffer.push({ card, from: fromPlayer.id });

            // Remove pending action
            room.tributePending.splice(actionIndex, 1);

            // Check if both paid
            if (room.tributeBuffer.length === 2) {
                // Compare and Distribute
                const t1 = room.tributeBuffer[0];
                const t2 = room.tributeBuffer[1];

                const val1 = GuandanLogic.getCardValue(t1.card, room.currentLevelRank);
                const val2 = GuandanLogic.getCardValue(t2.card, room.currentLevelRank);

                const p1 = room.players.find(p => p.id === room.rankings[0]);
                const p2 = room.players.find(p => p.id === room.rankings[1]);

                let card1ToP1 = false;

                if (val1 > val2) {
                    card1ToP1 = true;
                } else if (val2 > val1) {
                    card1ToP1 = false;
                } else {
                    // Equal: P4's card goes to P1 (Standard interpretation: Biggest loser pays to Biggest winner)
                    // Find who is P4
                    const p4Id = room.rankings[3];
                    if (t1.from === p4Id) card1ToP1 = true;
                    else card1ToP1 = false;
                }

                if (card1ToP1) {
                    p1.hand.push(t1.card);
                    p2.hand.push(t2.card);
                    room.tributePending.push({ from: p1.id, to: t1.from, type: 'RETURN' });
                    room.tributePending.push({ from: p2.id, to: t2.from, type: 'RETURN' });
                } else {
                    p1.hand.push(t2.card);
                    p2.hand.push(t1.card);
                    room.tributePending.push({ from: p1.id, to: t2.from, type: 'RETURN' });
                    room.tributePending.push({ from: p2.id, to: t1.from, type: 'RETURN' });
                }

                GuandanLogic.sortHand(p1.hand, room.currentLevelRank);
                GuandanLogic.sortHand(p2.hand, room.currentLevelRank);

                room.tributeBuffer = [];
            }
        }

        broadcastGameState(room);
    });

    socket.on('returnCard', ({ roomId, cardIndex }) => {
        const room = rooms.get(roomId);
        if (!room || room.gameState !== 'TRIBUTE') return;

        const actionIndex = room.tributePending.findIndex(a => a.from === socket.id && a.type === 'RETURN');
        if (actionIndex === -1) {
            socket.emit('error', 'No return required from you');
            return;
        }
        const action = room.tributePending[actionIndex];

        const fromPlayer = room.players.find(p => p.id === action.from);
        const toPlayer = room.players.find(p => p.id === action.to);

        const card = fromPlayer.hand[cardIndex];

        // Move card
        fromPlayer.hand.splice(cardIndex, 1);
        toPlayer.hand.push(card);
        GuandanLogic.sortHand(toPlayer.hand, room.currentLevelRank);

        // Remove pending action
        room.tributePending.splice(actionIndex, 1);

        // Check if all done
        if (room.tributePending.length === 0) {
            room.gameState = 'PLAYING';
            // Who starts?
            // Single Tribute: Winner (1st) starts?
            // Double Tribute: Winner (1st) starts?
            // Usually 1st place starts.
            const p1 = room.players.find(p => p.id === room.rankings[0]);
            room.turnIndex = p1.index;

            // Clear rankings for next game
            room.rankings = [];
        }

        broadcastGameState(room);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Find room user was in
        for (const [roomId, room] of rooms.entries()) {
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);
                // Re-assign indices/teams? For MVP, just leave gaps or shift?
                // Shifting is safer for now.
                room.players.forEach((p, i) => {
                    p.index = i;
                    p.team = i % 2 === 0 ? 'A' : 'B';
                });

                io.to(roomId).emit('playerJoined', room.players); // Broadcast update
                console.log(`Removed player from room ${roomId}`);

                if (room.players.length === 0) {
                    rooms.delete(roomId);
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
