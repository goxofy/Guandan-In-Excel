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

function getMaskedPlayers(players) {
    return players.map(p => ({
        ...p,
        hand: Array.isArray(p.hand) ? p.hand.length : p.hand
    }));
}

function updatePlayerIds(room, oldId, newId) {
    console.log(`[updatePlayerIds] Updating ${oldId} -> ${newId} in room ${room.id}`);

    // 1. Update lastPlayedHand
    if (room.lastPlayedHand && room.lastPlayedHand.playerId === oldId) {
        room.lastPlayedHand.playerId = newId;
    }

    // 2. Update roundPlays
    if (room.roundPlays && room.roundPlays[oldId]) {
        room.roundPlays[newId] = room.roundPlays[oldId];
        delete room.roundPlays[oldId];
    }

    // 3. Update rankings
    if (room.rankings) {
        const rankIdx = room.rankings.indexOf(oldId);
        if (rankIdx !== -1) {
            room.rankings[rankIdx] = newId;
        }
    }

    // 4. Update tributePending
    if (room.tributePending) {
        room.tributePending.forEach(action => {
            if (action.from === oldId) action.from = newId;
            if (action.to === oldId) action.to = newId;
        });
    }
}

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
            teamLevels: { 'A': 2, 'B': 2 }, // Initialize team levels
            deck: [],
            tableCards: [], // Cards played on table
            teamLevels: { 'A': 2, 'B': 2 }, // Initialize team levels
            deck: [],
            tableCards: [], // Cards played on table
            turnIndex: 0,
            deck: [],
            tableCards: [], // Cards played on table
            turnIndex: 0,
            turnDeadline: 0, // Timestamp for turn timeout
            tributeLogs: [] // Array of { from, to, card, type }
        });
        socket.emit('roomCreated', roomId);
    });

    socket.on('joinSinglePlayerRoom', ({ roomId, userId, playerName }) => {
        // Leave other rooms
        for (const r of socket.rooms) {
            if (r !== socket.id) {
                socket.leave(r);
            }
        }

        let room = rooms.get(roomId);

        if (room) {
            // Room exists - Try to reconnect
            const existingPlayer = room.players.find(p => p.userId === userId);
            if (existingPlayer) {
                console.log(`[SP] Player ${userId} reconnecting to ${roomId}`);
                const oldId = existingPlayer.id;
                updatePlayerIds(room, oldId, socket.id);

                existingPlayer.id = socket.id;
                existingPlayer.connected = true;

                socket.join(roomId);

                // Send state
                socket.emit('gameStarted', {
                    ...room,
                    myHand: existingPlayer.hand,
                    players: room.players.map(op => ({ ...op, hand: op.id === existingPlayer.id ? op.hand : op.hand.length }))
                });
                return;
            } else {
                // Room exists but user not in it.
                // For SP, we only allow 1 human.
                // If the human slot is taken (index 0), reject.
                // Or if we want to allow "taking over" if the other is disconnected? 
                // Let's be strict for now: Room Full.
                socket.emit('gameError', '该单人房间已存在且您不在其中 (Room exists and you are not the owner)');
                return;
            }
        }

        // Create new SP Room
        console.log(`[SP] Creating new room ${roomId} for ${userId}`);
        room = {
            id: roomId,
            players: [],
            gameState: 'WAITING',
            currentLevelRank: '2',
            teamLevels: { 'A': 2, 'B': 2 },
            deck: [],
            tableCards: [],
            turnIndex: 0,
            turnDeadline: 0,
            tributeLogs: [],
            isSinglePlayer: true
        };
        rooms.set(roomId, room);

        // Add Human Player
        const humanPlayer = {
            id: socket.id,
            userId: userId,
            name: playerName || 'You',
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
        io.to(roomId).emit('playerJoined', getMaskedPlayers(room.players));
        startGame(roomId);
    });

    socket.on('joinRoom', ({ roomId, playerName, userId }) => {
        // Leave other rooms
        for (const r of socket.rooms) {
            if (r !== socket.id) {
                socket.leave(r);
            }
        }

        let room = rooms.get(roomId);
        if (!room) {
            // Auto-create room if it doesn't exist
            if (roomId.startsWith('sp_')) {
                // Recreate Single Player Room
                console.log(`Auto-recreating Single Player room ${roomId}`);
                room = {
                    id: roomId,
                    players: [],
                    gameState: 'WAITING',
                    currentLevelRank: '2',
                    teamLevels: { 'A': 2, 'B': 2 },
                    deck: [],
                    tableCards: [],
                    turnIndex: 0,
                    turnDeadline: 0,
                    tributeLogs: []
                };
                rooms.set(roomId, room);

                // Add Human Player (Reconnecting user)
                const humanPlayer = {
                    id: socket.id,
                    userId: userId,
                    name: playerName || 'You',
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
                io.to(roomId).emit('playerJoined', getMaskedPlayers(room.players));
                startGame(roomId);
                return; // Done for SP
            } else {
                // Normal Room
                room = {
                    id: roomId,
                    players: [],
                    gameState: 'WAITING',
                    currentLevelRank: '2',
                    teamLevels: { 'A': 2, 'B': 2 },
                    deck: [],
                    tableCards: [],
                    turnIndex: 0,
                    turnDeadline: 0,
                    tributeLogs: []
                };
                rooms.set(roomId, room);
                console.log(`Auto-created room ${roomId}`);
            }
        }

        // Check if player is already in room (by userId)
        const existingPlayerByUserId = room.players.find(p => p.userId === userId);

        if (existingPlayerByUserId) {
            // Reconnection!
            console.log(`Player ${userId} reconnected`);
            const oldId = existingPlayerByUserId.id;
            updatePlayerIds(room, oldId, socket.id);

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
            io.to(roomId).emit('playerJoined', getMaskedPlayers(room.players));
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

        io.to(roomId).emit('playerJoined', getMaskedPlayers(room.players));

        if (room.players.length === 4) {
            io.to(roomId).emit('gameReady');
        }
    });



    socket.on('startGame', (roomId) => {
        startGame(roomId);
    });

    socket.on('playCards', ({ roomId, cardIndices }) => {
        console.log(`[playCards] Event received from ${socket.id} for room ${roomId} with indices ${cardIndices}`);
        handlePlayCards(roomId, socket.id, cardIndices);
    });

    socket.on('passTurn', ({ roomId }) => {
        handlePassTurn(roomId, socket.id);
    });

    socket.on('payTribute', ({ roomId, cardIndex }) => {
        handlePayTribute(roomId, socket.id, cardIndex);
    });

    socket.on('returnCard', ({ roomId, cardIndex }) => {
        handleReturnCard(roomId, socket.id, cardIndex);
    });

    socket.on('leaveRoom', ({ roomId }) => {
        console.log(`[leaveRoom] User ${socket.id} leaving room ${roomId}`);
        const room = rooms.get(roomId);
        if (!room) return;

        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
            const player = room.players[playerIndex];

            // Remove player from room
            room.players.splice(playerIndex, 1);
            socket.leave(roomId);

            console.log(`Player ${player.userId} left room ${roomId}`);

            // Destruction Logic
            if (roomId.startsWith('sp_')) {
                // Single Player: If human leaves, destroy
                if (player.index === 0) {
                    console.log(`[SP] Human left ${roomId}. Destroying immediately.`);
                    rooms.delete(roomId);
                    botManagers.delete(roomId);
                }
            } else {
                // Multiplayer: If room empty, destroy
                if (room.players.length === 0) {
                    console.log(`[MP] Room ${roomId} empty. Destroying immediately.`);
                    rooms.delete(roomId);
                    botManagers.delete(roomId);
                } else {
                    // Notify others
                    io.to(roomId).emit('playerJoined', getMaskedPlayers(room.players));
                }
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Find room user was in
        for (const [roomId, room] of rooms.entries()) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.connected = false;
                console.log(`Player ${player.userId} disconnected from room ${roomId}`);

                io.to(roomId).emit('playerJoined', getMaskedPlayers(room.players));

                // NO DESTRUCTION ON DISCONNECT
                // This allows refresh to work (reconnect)
                break;
            }
        }
    });
});

// Helper to start game
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

    // Clear Round State
    room.lastPlayedHand = null;
    room.tableCards = [];
    room.roundPlays = {};
    room.passCount = 0;
    room.tributeLogs = []; // Clear previous tribute logs
    room.tributeResult = null; // Clear previous tribute results

    // Check for Tribute Phase
    // If coming from GAME_OVER_WIN, reset everything
    if (room.gameState === 'GAME_OVER_WIN') {
        console.log(`[startGame] Room ${roomId} GAME_OVER_WIN. Resetting.`);
        room.rankings = [];
        room.teamLevels = { 'A': 2, 'B': 2 };
        room.currentLevelRank = '2';
        room.currentLevelRank = '2';
        room.gameState = 'PLAYING';
        room.tributeLogs = [];
        // No tribute
    } else if (room.rankings && room.rankings.length === 4) {
        console.log(`[startGame] Room ${roomId} entering TRIBUTE. Rankings:`, room.rankings);
        room.gameState = 'TRIBUTE';
        room.levelJump = null; // Clear level info
        room.nextLevel = null;
        room.winningTeam = null;
        room.tributePending = []; // { from: pid, to: pid, type: 'PAY'|'RETURN'|'PAY_DOUBLE' }
        room.tributeBuffer = []; // Store cards for Double Tribute comparison

        // Determine Tribute Type
        const p1 = room.players.find(p => p.id === room.rankings[0]);
        const p2 = room.players.find(p => p.id === room.rankings[1]);
        const p3 = room.players.find(p => p.id === room.rankings[2]);
        const p4 = room.players.find(p => p.id === room.rankings[3]);

        if (p1.team === p2.team) {
            // Double Tribute (双上)
            // Anti-Tribute Check: Do p3 and p4 have 2 Red Jokers total?
            const redJokerCount = (p3.hand.filter(c => c.val === 101).length) + (p4.hand.filter(c => c.val === 101).length);
            if (redJokerCount === 2) {
                console.log(`[startGame] Anti-Tribute (Double): Losers have 2 Red Jokers. No tribute.`);
                room.gameState = 'PLAYING';
                room.turnIndex = p1.index; // First Place starts
                room.turnDeadline = Date.now() + 1000;
            } else {
                console.log(`[startGame] Double Tribute detected.`);
                room.tributePending.push({ from: p3.id, type: 'PAY_DOUBLE' });
                room.tributePending.push({ from: p4.id, type: 'PAY_DOUBLE' });
            }
        } else {
            // Single Tribute (单上)
            // Anti-Tribute Check: Does p4 have 2 Red Jokers?
            const redJokerCount = p4.hand.filter(c => c.val === 101).length;
            if (redJokerCount === 2) {
                console.log(`[startGame] Anti-Tribute (Single): Loser has 2 Red Jokers. No tribute.`);
                room.gameState = 'PLAYING';
                room.turnIndex = p1.index; // First Place starts
                room.turnDeadline = Date.now() + 1000;
            } else {
                // p4 -> p1 (PAY)
                console.log(`[startGame] Single Tribute detected. ${p4.name} -> ${p1.name}`);
                room.tributePending.push({ from: p4.id, to: p1.id, type: 'PAY' });
            }
        }
    } else {
        console.log(`[startGame] Room ${roomId} starting normal game. Rankings:`, room.rankings);
        room.gameState = 'PLAYING';
        room.turnIndex = 0; // Randomize?
        room.turnDeadline = Date.now() + 1000; // 1s for first turn
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

function handlePlayCards(roomId, playerId, cardIndices) {
    console.log(`[handlePlayCards] Called for room ${roomId}, player ${playerId}, indices ${cardIndices}`);
    const room = rooms.get(roomId);
    if (!room) {
        console.log(`[handlePlayCards] Room not found`);
        io.to(playerId).emit('gameError', 'Room not found (Game may have restarted)');
        return;
    }
    if (room.gameState !== 'PLAYING') {
        console.log(`[handlePlayCards] Game state is ${room.gameState}, not PLAYING`);
        return;
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        console.log(`[handlePlayCards] Player not found`);
        return;
    }

    // Check turn
    if (room.players[room.turnIndex].id !== playerId) {
        console.log(`[handlePlayCards] Not player's turn. Current turn: ${room.players[room.turnIndex].id}, Requesting: ${playerId}`);
        if (!player.isBot) io.to(playerId).emit('gameError', 'Not your turn');
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
            if (!player.isBot) io.to(playerId).emit('gameError', 'Invalid card index');
            return;
        }
        cardsToPlay.push(hand[idx]);
    }

    // Validate Hand
    const validationResult = GuandanLogic.validateHand(cardsToPlay, room.currentLevelRank);
    if (!validationResult.isValid) {
        if (!player.isBot) io.to(playerId).emit('gameError', 'Invalid hand type');
        return;
    }

    // Compare with last played hand
    if (room.lastPlayedHand) {
        const comparison = GuandanLogic.compareHands(validationResult, room.lastPlayedHand, room.currentLevelRank);
        if (!comparison) {
            if (!player.isBot) io.to(playerId).emit('gameError', 'Your hand is not big enough');
            return;
        }
    }

    // Play is valid
    // Clear tribute logs if this is the first play of the round (or just clear it on any play, it's fine)
    if (room.tributeLogs && room.tributeLogs.length > 0) {
        room.tributeLogs = [];
    }

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
                room.tableCards = []; // Clear table
                io.to(roomId).emit('gameEnded', {
                    rankings: room.rankings,
                    finalWinner: winningTeam,
                    teamLevels: room.teamLevels
                });
                broadcastGameState(room);
                return;
            }

            const nextLevelVal = room.teamLevels[winningTeam];
            let nextRankIndex = nextLevelVal - 2;
            if (nextRankIndex >= ranks.length) nextRankIndex = ranks.length - 1;
            room.currentLevelRank = ranks[nextRankIndex];

            room.gameState = 'ROUND_ENDED';
            room.tableCards = []; // Clear table
            room.levelJump = levelJump; // Persist for broadcast
            room.nextLevel = room.currentLevelRank;
            room.winningTeam = winningTeam;

            io.to(roomId).emit('gameEnded', {
                rankings: room.rankings,
                levelJump,
                nextLevel: room.currentLevelRank,
                teamLevels: room.teamLevels,
                finalWinner: winningTeam
            });
            broadcastGameState(room); // Broadcast to update UI with cleared table and revealed hands
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
    room.turnDeadline = Date.now() + 1000; // 1s for next turn

    broadcastGameState(room);
}

function handlePassTurn(roomId, playerId) {
    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    // Check if it's player's turn
    if (room.players[room.turnIndex].id !== playerId) {
        if (!player.isBot) io.to(playerId).emit('gameError', 'Not your turn');
        return;
    }

    // Cannot pass if it's a free play (you must play)
    if (!room.lastPlayedHand || room.lastPlayedHand.playerId === playerId) {
        if (!player.isBot) io.to(playerId).emit('gameError', 'Cannot pass on free turn');
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
        room.turnDeadline = Date.now() + 1000; // 1s for next turn
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
            // If game is over (ROUND_ENDED or GAME_OVER_WIN), show all hands
            const showAllHands = room.gameState === 'ROUND_ENDED' || room.gameState === 'GAME_OVER_WIN' || room.gameState === 'ENDED';

            // Debug Log
            if (p.id === room.players[0].id) { // Log once per broadcast
                console.log(`[broadcastGameState] Room ${room.id} State: ${room.gameState}, ShowAllHands: ${showAllHands}`);
            }

            io.to(p.id).emit('gameStarted', {
                ...room,
                myHand: p.hand,
                players: room.players.map(op => ({
                    ...op,
                    hand: (op.id === p.id || showAllHands) ? op.hand : op.hand.length
                }))
            });
        }
    });
}

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

    if (action.type === 'PAY' || action.type === 'PAY_DOUBLE') {
        // Validate that the card is the largest (or equal to largest)
        const currentVal = GuandanLogic.getCardValue(card, room.currentLevelRank);

        // Find max value in hand (excluding Red Heart Level Card = 200)
        let maxVal = -1;
        fromPlayer.hand.forEach(c => {
            const v = GuandanLogic.getCardValue(c, room.currentLevelRank);
            if (v !== 200 && v > maxVal) maxVal = v;
        });

        // If hand only has Red Heart Level Cards (rare/impossible if logic correct?), then maxVal remains -1.
        // In that case, maybe they can pay it? Rules say "except Red Heart".
        // If they ONLY have Red Heart Level Cards (e.g. 1 card left), they can't pay?
        // Rules usually imply you pay the next largest.
        // But if maxVal is -1, it means all cards are 200.
        if (maxVal === -1 && fromPlayer.hand.length > 0) {
            // Fallback: If only Red Hearts, allow paying it? Or strict rule?
            // "Except Red Heart" usually means you keep it.
            // But you MUST pay.
            // Let's assume if you only have Red Hearts, you pay it.
            maxVal = 200;
        }

        if (currentVal < maxVal && currentVal !== 200) { // If current is 200, it's definitely not allowed if maxVal < 200. Wait.
            // Rule: Pay Largest (Except Red Heart).
            // So if I have [RedHeart(200), BigJoker(101)], Max Valid is 101.
            // If I pay RedHeart(200), it's invalid (forbidden).
            // If I pay BigJoker(101), it's valid (101 == 101).

            // If I pay SmallJoker(100), invalid (100 < 101).
        }

        // Revised Logic:
        // 1. Check if card is Red Heart Level Card (val 200). If so, FORBIDDEN (unless it's the only option? No, rule says "except").
        // Actually rule says "pay largest (except red heart)". It implies Red Heart is NOT considered for "largest" selection AND cannot be paid.

        if (currentVal === 200) {
            io.to(playerId).emit('gameError', '红桃主牌不能进贡！');
            return;
        }

        if (currentVal < maxVal) {
            console.log(`[handlePayTribute] Invalid tribute. Card ${card.id} (val ${currentVal}) is not the largest (max ${maxVal})`);
            // Debug: Print hand values
            const handVals = fromPlayer.hand.map(c => GuandanLogic.getCardValue(c, room.currentLevelRank));
            console.log(`[handlePayTribute] Hand Values: ${handVals.join(',')}`);

            io.to(playerId).emit('gameError', '必须进贡最大的牌！');
            return;
        }
    }

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

        // Log
        if (!room.tributeLogs) room.tributeLogs = [];
        room.tributeLogs.push({ from: fromPlayer.id, to: toPlayer.id, card, type: 'PAY' });

        // Track for Start Turn Logic (Single Tribute)
        if (!room.tributeResult) room.tributeResult = { type: 'SINGLE', payers: [] };
        room.tributeResult.payers.push({ id: fromPlayer.id, card });
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

                // Log (Double Pay)
                if (!room.tributeLogs) room.tributeLogs = [];
                room.tributeLogs.push({ from: t1.from, to: p1.id, card: t1.card, type: 'PAY_DOUBLE' });
                room.tributeLogs.push({ from: t2.from, to: p2.id, card: t2.card, type: 'PAY_DOUBLE' });

                // Track for Start Turn Logic (Double Tribute)
                if (!room.tributeResult) room.tributeResult = { type: 'DOUBLE', payers: [] };
                room.tributeResult.payers.push({ id: t1.from, card: t1.card });
                room.tributeResult.payers.push({ id: t2.from, card: t2.card });
            } else {
                p1.hand.push(t2.card);
                p2.hand.push(t1.card);
                room.tributePending.push({ from: p1.id, to: t2.from, type: 'RETURN' });
                room.tributePending.push({ from: p2.id, to: t1.from, type: 'RETURN' });

                // Log (Double Pay)
                if (!room.tributeLogs) room.tributeLogs = [];
                room.tributeLogs.push({ from: t1.from, to: p2.id, card: t1.card, type: 'PAY_DOUBLE' });
                room.tributeLogs.push({ from: t2.from, to: p1.id, card: t2.card, type: 'PAY_DOUBLE' });
            }

            GuandanLogic.sortHand(p1.hand, room.currentLevelRank);
            GuandanLogic.sortHand(p2.hand, room.currentLevelRank);

            room.tributeBuffer = [];
        }
    }

    broadcastGameState(room);
}

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

    // Validate Return Card (Must be <= 10)
    const val = GuandanLogic.getCardValue(card, room.currentLevelRank);
    // Rank <= 10 means val <= 10.
    // J=11, Q=12, K=13, A=14.
    // Level Card = 99/200. Joker = 100/101.
    // So val <= 10 check is correct.
    if (val > 10) {
        io.to(playerId).emit('gameError', '还牌必须是 10 及以下的牌！');
        return;
    }

    // Move card
    fromPlayer.hand.splice(cardIndex, 1);
    toPlayer.hand.push(card);
    GuandanLogic.sortHand(toPlayer.hand, room.currentLevelRank);

    // Remove pending action
    room.tributePending.splice(actionIndex, 1);

    // Log
    if (!room.tributeLogs) room.tributeLogs = [];
    room.tributeLogs.push({ from: fromPlayer.id, to: toPlayer.id, card, type: 'RETURN' });

    // Check if all done
    if (room.tributePending.length === 0) {
        console.log(`[handleReturnCard] All tribute actions done. Starting countdown.`);
        room.gameState = 'COUNTDOWN';
        room.countdown = 5; // 5 seconds

        // Start Countdown Timer
        const countdownInterval = setInterval(() => {
            room.countdown--;
            if (room.countdown <= 0) {
                clearInterval(countdownInterval);
                room.gameState = 'PLAYING';
                // Who starts?
                const p1 = room.players.find(p => p.id === room.rankings[0]);

                if (room.tributeResult && room.tributeResult.type === 'SINGLE') {
                    // Single Tribute: Payer (Last Place) starts
                    // Payer is the one in tributeResult
                    const payerId = room.tributeResult.payers[0].id;
                    const payer = room.players.find(p => p.id === payerId);
                    room.turnIndex = payer.index;
                    console.log(`[handleReturnCard] Single Tribute Start: Payer ${payer.name} (Index ${payer.index}) starts.`);
                } else if (room.tributeResult && room.tributeResult.type === 'DOUBLE') {
                    // Double Tribute: Compare cards
                    const t1 = room.tributeResult.payers[0];
                    const t2 = room.tributeResult.payers[1];

                    const val1 = GuandanLogic.getCardValue(t1.card, room.currentLevelRank);
                    const val2 = GuandanLogic.getCardValue(t2.card, room.currentLevelRank);

                    if (val1 > val2) {
                        const p = room.players.find(player => player.id === t1.id);
                        room.turnIndex = p.index;
                    } else if (val2 > val1) {
                        const p = room.players.find(player => player.id === t2.id);
                        room.turnIndex = p.index;
                    } else {
                        // Equal: First Place's next player starts
                        room.turnIndex = (p1.index + 1) % 4;
                    }
                } else {
                    // Fallback (should not happen if tribute occurred)
                    room.turnIndex = p1.index;
                }

                room.turnDeadline = Date.now() + 1000; // 1s

                // Clear rankings for next game
                room.rankings = [];
                room.lastTributeLog = null;
                room.tributeResult = null;

                broadcastGameState(room);
            } else {
                broadcastGameState(room);
            }
        }, 1000);
    }

    broadcastGameState(room);
}

// Periodic Turn Timeout Check
setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms.entries()) {
        if (room.gameState === 'PLAYING' && room.turnDeadline && now > room.turnDeadline) {
            const currentPlayer = room.players[room.turnIndex];
            if (currentPlayer && !currentPlayer.isBot) { // Bots handle themselves usually, but good to enforce
                console.log(`[Timeout] Player ${currentPlayer.name} timed out in room ${roomId}`);

                // Force action
                // If free turn, must play. If not free turn, pass.
                // Simplification: Just pass. If free turn, pass is invalid, so play smallest single.

                let lastHand = room.lastPlayedHand;
                if (lastHand && lastHand.playerId === currentPlayer.id) {
                    lastHand = null; // Free turn
                }

                if (!lastHand) {
                    // Free turn: Play smallest single
                    // Find smallest single
                    // Hand is sorted large to small? Or small to large?
                    // GuandanLogic.sortHand sorts Descending (King -> 2).
                    // So last card is smallest.
                    if (currentPlayer.hand.length > 0) {
                        const smallestCardIndex = currentPlayer.hand.length - 1;
                        handlePlayCards(roomId, currentPlayer.id, [smallestCardIndex]);
                    } else {
                        // Should not happen if turnIndex is correct
                        handlePassTurn(roomId, currentPlayer.id);
                    }
                } else {
                    // Not free turn: Pass
                    handlePassTurn(roomId, currentPlayer.id);
                }
            }
        }
    }
}, 1000);

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
