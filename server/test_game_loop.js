const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3001';
const ROOM_ID = 'test_room_' + Date.now();

const clients = [];
const players = [];

function createClient(index) {
    return new Promise((resolve, reject) => {
        const socket = io(SERVER_URL);

        socket.on('connect', () => {
            console.log(`Client ${index} connected: ${socket.id}`);
            socket.emit('createRoom', ROOM_ID); // Everyone tries to create, first one wins, others fail/ignore
            socket.emit('joinRoom', { roomId: ROOM_ID, playerName: `Bot${index}` });
        });

        socket.on('playerJoined', (roomPlayers) => {
            console.log(`Client ${index} received playerJoined. Total: ${roomPlayers.length}`);
            if (roomPlayers.length === 4 && index === 0) {
                console.log('Room full. Starting game...');
                setTimeout(() => {
                    socket.emit('startGame', ROOM_ID);
                }, 1000);
            }
        });

        socket.on('gameStarted', (gameState) => {
            console.log(`Client ${index} received gameStarted. My Hand: ${gameState.myHand.length}`);

            // If it's my turn, play a card
            if (gameState.players[gameState.turnIndex].id === socket.id) {
                console.log(`It is Client ${index}'s turn!`);
                // Play first card
                setTimeout(() => {
                    console.log(`Client ${index} playing card...`);
                    socket.emit('playCards', { roomId: ROOM_ID, cardIndices: [0] });
                }, 1000);
            }
        });

        socket.on('error', (err) => {
            console.error(`Client ${index} error:`, err);
        });

        clients.push(socket);
        resolve(socket);
    });
}

async function runTest() {
    console.log('Starting test...');
    for (let i = 0; i < 4; i++) {
        await createClient(i);
        await new Promise(r => setTimeout(r, 200)); // Stagger connections
    }
}

runTest();
