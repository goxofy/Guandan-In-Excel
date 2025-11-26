const io = require('socket.io-client');

const socket = io('http://localhost:3001');

const roomId = 'test_sp_' + Math.random().toString(36).substr(2, 6);

console.log('Connecting to server...');

socket.on('connect', () => {
    console.log('Connected as', socket.id);
    console.log('Creating Single Player Room:', roomId);
    socket.emit('createSinglePlayerRoom', roomId);
});

socket.on('playerJoined', (players) => {
    console.log(`Players in room (${players.length}/4):`);
    players.forEach(p => console.log(`- ${p.name} (${p.id}) [${p.isBot ? 'BOT' : 'HUMAN'}]`));
});

socket.on('gameStarted', (data) => {
    console.log('Game Started!');
    console.log('My Hand:', data.myHand.map(c => c.id).join(', '));
    console.log('Current Level:', data.currentLevelRank);
    console.log('Turn:', data.turnIndex);

    // Check if it's my turn
    const myIndex = data.players.find(p => p.id === socket.id).index;
    if (data.turnIndex === myIndex) {
        console.log('It is MY turn!');
        // Play a random card to keep game moving?
        // Or just wait to see if bots play when it's their turn.
        // If I am start, I must play.
        const hand = data.myHand;
        // Play first card
        const cardIndices = [0];
        console.log('Playing card at index 0');
        socket.emit('playCards', { roomId, cardIndices });
    } else {
        console.log('Waiting for others...');
    }
});

socket.on('gameError', (msg) => {
    console.error('Game Error:', msg);
});

// Listen for state updates to see bot moves
socket.on('gameStarted', (data) => {
    // This event is emitted on every state change
    // We can log who played what
    if (data.lastPlayedHand) {
        console.log(`Last Played: ${data.lastPlayedHand.playerId} played ${data.lastPlayedHand.type} (${data.lastPlayedHand.rank})`);
    }

    const myIndex = data.players.find(p => p.id === socket.id).index;
    if (data.turnIndex === myIndex) {
        console.log('It is MY turn again!');
        // Just pass to let bots play against each other?
        // Cannot pass if free turn.
        if (!data.lastPlayedHand || data.lastPlayedHand.playerId === socket.id) {
            console.log('Free turn, playing single');
            socket.emit('playCards', { roomId, cardIndices: [0] });
        } else {
            console.log('Passing');
            socket.emit('passTurn', { roomId });
        }
    }
});

// Run for 30 seconds then exit
setTimeout(() => {
    console.log('Test finished.');
    process.exit(0);
}, 30000);
