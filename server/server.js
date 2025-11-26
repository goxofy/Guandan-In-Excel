const express = require('express');
const path = require('path');
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
const BotManager = require('./game/BotManager');

// Simple in-memory storage
const rooms = new Map();
const botManagers = new Map(); // roomId -> BotManager

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

    socket.on('createSinglePlayerRoom', (roomId) => {
        if (rooms.has(roomId)) {
            socket.emit('error', 'Room already exists');
            return;
        }
        // Initialize room
        const room = {
            id: roomId,
            players: [],
            gameState: 'WAITING',
            currentLevelRank: '2',
            deck: [],
            tableCards: [],
            turnIndex: 0
        };
        rooms.set(roomId, room);

        // Add Human Player
        const humanPlayer = {
            id: socket.id,
            userId: 'human_' + socket.id, // Temporary ID for SP
            name: 'You',
            index: 0,
            hand: [],
            team: 'A',
            connected: true
        };
        room.players.push(humanPlayer);
        socket.join(roomId);

        // Add 3 Bots
        const botManager = new BotManager(io, room);
        botManagers.set(roomId, botManager);

        for (let i = 1; i <= 3; i++) {
            const botId = `bot_${roomId}_${i}`;
            const botName = `Bot ${i}`;
            const botPlayer = {
                id: botId,
                userId: botId,
                name: botName,
                index: i,
                hand: [],
                team: i % 2 === 0 ? 'A' : 'B',
                connected: true,
                isBot: true
            };
            room.players.push(botPlayer);
            botManager.addBot(botId, botName, i);
        }

        // Setup Bot Callbacks
        botManager.onBotMove = (botId, cardIndices) => {
            handlePlayCards(roomId, botId, cardIndices);
        };
        botManager.onBotPass = (botId) => {
            handlePassTurn(roomId, botId);
        };
        botManager.onBotPayTribute = (botId, cardIndex) => {
            handlePayTribute(roomId, botId, cardIndex);
        };
        botManager.onBotReturnCard = (botId, cardIndex) => {
            handleReturnCard(roomId, botId, cardIndex);
        };

        // Start Game Immediately
        io.to(roomId).emit('playerJoined', room.players);
        startGame(roomId);
    });

    socket.on('joinRoom', ({ roomId, playerName, userId }) => {
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

        // Check if player is already in room (by userId)
        const existingPlayerByUserId = room.players.find(p => p.userId === userId);

        if (existingPlayerByUserId) {
            // Reconnection!
            console.log(`Player ${userId} reconnected`);
            existingPlayerByUserId.id = socket.id; // Update socket ID
            existingPlayerByUserId.connected = true;

            socket.join(roomId);

            // Send current state to reconnecting player
            socket.emit('gameStarted', {
                ...room,
                myHand: existingPlayerByUserId.hand,
                players: room.players.map(op => ({ ...op, hand: op.id === existingPlayerByUserId.id ? op.hand : op.hand.length }))
            });

            // Notify others
            io.to(roomId).emit('playerJoined', room.players);
            return;
        }

        if (room.players.length >= 4) {
            socket.emit('gameError', '房间已满 (Room is full)');
            return;
        }

        const player = {
            id: socket.id,
            userId: userId, // Store persistent ID
            name: playerName || `Player ${room.players.length + 1}`,
            index: room.players.length,
            hand: [],
            team: room.players.length % 2 === 0 ? 'A' : 'B', // 0&2 vs 1&3
            connected: true
        };

        room.players.push(player);
        socket.join(roomId);

        io.to(roomId).emit('playerJoined', room.players);

        if (room.players.length === 4) {
            io.to(roomId).emit('gameReady');
        }
    });

    socket.on('startGame', (roomId) => {
        startGame(roomId);
    });

    // Helper to start game (extracted for reuse)
    function startGame(roomId) {
        const room = rooms.get(roomId);
        if (!room) return;

        // If manual start, check player count
        // For SP, we already filled with bots
        if (room.players.length < 4) {
            // socket.emit('error', 'Need 4 players to start'); // No socket here easily
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
            if (!p.isBot) {
                io.to(p.id).emit('gameStarted', {
                    ...room,
                    myHand: p.hand,
                    players: room.players.map(op => ({ ...op, hand: op.id === p.id ? op.hand : op.hand.length }))
                });
            }
        });
        broadcastGameState(room);
    }

    socket.on('playCards', ({ roomId, cardIndices }) => {
        handlePlayCards(roomId, socket.id, cardIndices);
    });

    function handlePlayCards(roomId, playerId, cardIndices) {
        const room = rooms.get(roomId);
        if (!room || room.gameState !== 'PLAYING') return;

        const player = room.players.find(p => p.id === playerId);
        if (!player) return;

        // Check turn
        if (room.players[room.turnIndex].id !== playerId) {
            if (!player.isBot) socket.emit('gameError', 'Not your turn');
            return;
        }

        // Validate indices
        if (!cardIndices || cardIndices.length === 0) return;

        // Get actual cards
        const hand = player.hand;
        const cardsToPlay = [];
        // Sort indices descending to remove from back
        const sortedIndices = [...cardIndices].sort((a, b) => b - a);

        for (let idx of sortedIndices) {
            if (idx < 0 || idx >= hand.length) {
                if (!player.isBot) socket.emit('gameError', 'Invalid card index');
                return;
            }
            cardsToPlay.push(hand[idx]);
        }

        // Validate Hand
        const validationResult = GuandanLogic.validateHand(cardsToPlay, room.currentLevelRank);
        if (!validationResult.isValid) {
            if (!player.isBot) socket.emit('gameError', 'Invalid hand type');
            return;
        }

        // Compare with last played hand
        if (room.lastPlayedHand) {
            const comparison = GuandanLogic.compareHands(validationResult, room.lastPlayedHand, room.currentLevelRank);
            if (!comparison) {
                if (!player.isBot) socket.emit('gameError', 'Your hand is not big enough');
                return;
            }
        }

        // Play is valid
        // Remove cards from hand
        for (let idx of sortedIndices) {
            player.hand.splice(idx, 1);
        }

        // Update room state
        room.lastPlayedHand = {
            playerId: player.id,
            ...validationResult,
            cards: cardsToPlay
        };
        room.tableCards = cardsToPlay;
        room.passCount = 0;

        // Update roundPlays
        if (!room.roundPlays) room.roundPlays = {};
        room.roundPlays[player.id] = { type: 'PLAY', cards: cardsToPlay };

        // Check if player finished
        if (player.hand.length === 0) {
            if (!room.rankings) room.rankings = [];
            room.rankings.push(player.id);

            const teamA = room.players.filter(p => p.team === 'A');
            const teamB = room.players.filter(p => p.team === 'B');
            const teamAFinished = teamA.every(p => p.hand.length === 0);
            const teamBFinished = teamB.every(p => p.hand.length === 0);

            if (room.rankings.length === 3 || teamAFinished || teamBFinished) {
                // Game Over
                // Add all remaining players to rankings
                const remainingPlayers = room.players.filter(p => !room.rankings.includes(p.id));
                // Sort remaining players? No, they are losers. Order doesn't matter for 3rd/4th usually, 
                // but for tribute, we need to know who is last.
                // If team finished, the other team are losers.
                // Just push them.
                remainingPlayers.forEach(p => room.rankings.push(p.id));

                const p1 = room.players.find(p => p.id === room.rankings[0]);
                const p2 = room.players.find(p => p.id === room.rankings[1]);
                const p3 = room.players.find(p => p.id === room.rankings[2]);

                let levelJump = 0;
                let winningTeam = p1.team;

                if (p1.team === p2.team) levelJump = 3;
                else if (p1.team === p3.team) levelJump = 2;
                else levelJump = 1;

                const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
                if (!room.teamLevels) room.teamLevels = { 'A': 2, 'B': 2 };
                room.teamLevels[winningTeam] += levelJump;

                if (room.teamLevels[winningTeam] > 14) {
                    room.gameState = 'GAME_OVER_WIN';
                    io.to(roomId).emit('gameEnded', {
                        rankings: room.rankings,
                        finalWinner: winningTeam,
                        teamLevels: room.teamLevels
                    });
                    return;
                }

                const nextLevelVal = room.teamLevels[winningTeam];
                let nextRankIndex = nextLevelVal - 2;
                if (nextRankIndex >= ranks.length) nextRankIndex = ranks.length - 1;
                room.currentLevelRank = ranks[nextRankIndex];

                room.gameState = 'ENDED';
                io.to(roomId).emit('gameEnded', {
                    rankings: room.rankings,
                    levelJump,
                    nextLevel: room.currentLevelRank,
                    teamLevels: room.teamLevels
                });
                return;
            }
        }

        // Move turn
        let nextTurnIndex = (room.turnIndex + 1) % 4;
        let loopCount = 0;
        while (room.players[nextTurnIndex].hand.length === 0 && loopCount < 4) {
            nextTurnIndex = (nextTurnIndex + 1) % 4;
            loopCount++;
        }
        room.turnIndex = nextTurnIndex;

        broadcastGameState(room);
    }

    socket.on('passTurn', ({ roomId }) => {
        handlePassTurn(roomId, socket.id);
    });

    function handlePassTurn(roomId, playerId) {
        const room = rooms.get(roomId);
        if (!room) return;

        const player = room.players.find(p => p.id === playerId);
        if (!player) return;

        // Check if it's player's turn
        if (room.players[room.turnIndex].id !== playerId) {
            if (!player.isBot) socket.emit('gameError', 'Not your turn');
            return;
        }

        // Cannot pass if it's a free play (you must play)
        if (!room.lastPlayedHand || room.lastPlayedHand.playerId === playerId) {
            if (!player.isBot) socket.emit('gameError', 'Cannot pass on free turn');
            return;
        }

        room.passCount = (room.passCount || 0) + 1;

        // Update roundPlays
        if (!room.roundPlays) room.roundPlays = {};
        room.roundPlays[player.id] = { type: 'PASS' };

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
            room.roundPlays = {}; // Clear round plays for new round

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
    }

    function broadcastGameState(room) {
        // Notify BotManager
        if (botManagers.has(room.id)) {
            botManagers.get(room.id).onGameStateUpdate();
        }

        room.players.forEach(p => {
            if (!p.isBot) {
                io.to(p.id).emit('gameStarted', {
                    ...room,
                    myHand: p.hand,
                    players: room.players.map(op => ({ ...op, hand: op.id === p.id ? op.hand : op.hand.length }))
                });
            }
        });
    }

    socket.on('payTribute', ({ roomId, cardIndex }) => {
        handlePayTribute(roomId, socket.id, cardIndex);
    });

    function handlePayTribute(roomId, playerId, cardIndex) {
        const room = rooms.get(roomId);
        if (!room || room.gameState !== 'TRIBUTE') return;

        // Find pending action
        const actionIndex = room.tributePending.findIndex(a => a.from === playerId && (a.type === 'PAY' || a.type === 'PAY_DOUBLE'));
        if (actionIndex === -1) {
            // socket.emit('error', 'No tribute required from you'); // Bot doesn't listen to socket
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
    }

    socket.on('returnCard', ({ roomId, cardIndex }) => {
        handleReturnCard(roomId, socket.id, cardIndex);
    });

    function handleReturnCard(roomId, playerId, cardIndex) {
        const room = rooms.get(roomId);
        if (!room || room.gameState !== 'TRIBUTE') return;

        const actionIndex = room.tributePending.findIndex(a => a.from === playerId && a.type === 'RETURN');
        if (actionIndex === -1) {
            // socket.emit('error', 'No return required from you');
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
    }

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Find room user was in
        for (const [roomId, room] of rooms.entries()) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.connected = false;
                console.log(`Player ${player.userId} disconnected from room ${roomId}`);

                // Do NOT remove player, just mark as disconnected
                // room.players.splice(playerIndex, 1);

                io.to(roomId).emit('playerJoined', room.players); // Broadcast update (to show offline status if UI supports it)
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3001;

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../client/dist')));

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
