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

        // Generate and shuffle deck
        const deck = GuandanLogic.createDeck();

        // Deal cards (27 each for 4 players = 108 cards)
        // In Guandan, we deal one by one usually, but for simplicity here we just slice
        for (let i = 0; i < 4; i++) {
            if (room.players[i]) {
                room.players[i].hand = deck.slice(i * 27, (i + 1) * 27);
                // Sort hand
                GuandanLogic.sortHand(room.players[i].hand, room.currentLevelRank);
            }
        }

        room.gameState = 'PLAYING';
        room.turnIndex = 0; // Randomize?

        // Emit game state to everyone
        // Note: Should hide other players' hands in a real app, but sending all for now for simplicity/debugging
        // Or better: send personalized state
        room.players.forEach(p => {
            io.to(p.id).emit('gameStarted', {
                ...room,
                myHand: p.hand,
                players: room.players.map(op => ({ ...op, hand: op.id === p.id ? op.hand : op.hand.length })) // Hide opponent hands
            });
        });
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

        // Move turn
        room.turnIndex = (room.turnIndex + 1) % 4;

        // Broadcast update
        broadcastGameState(room);
    });

    socket.on('passTurn', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room || room.gameState !== 'PLAYING') return;

        // Check turn
        if (room.players[room.turnIndex].id !== socket.id) return;

        // Cannot pass if it's a free play (you must play)
        // Free play happens if lastPlayedHand is null OR lastPlayedHand was played by ME (everyone else passed)
        if (!room.lastPlayedHand || room.lastPlayedHand.playerId === socket.id) {
            socket.emit('error', 'Cannot pass on free turn');
            return;
        }

        room.passCount = (room.passCount || 0) + 1;

        // Move turn
        room.turnIndex = (room.turnIndex + 1) % 4;

        // Check if everyone passed (3 passes)
        if (room.passCount >= 3) {
            // New round
            room.lastPlayedHand = null;
            room.tableCards = []; // Clear table
            room.passCount = 0;
            // Turn is already set to the winner of the last hand (who is the current player now)
            // Wait, if A plays, B pass, C pass, D pass.
            // A played. Turn -> B. B pass (count=1). Turn -> C. C pass (count=2). Turn -> D. D pass (count=3).
            // Now turn is A. A should start new round.
            // So logic is correct.
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
