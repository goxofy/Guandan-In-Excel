import React, { useState, useEffect } from 'react';
import Ribbon from './components/Ribbon';
import ExcelGrid from './components/ExcelGrid';
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001');

function App() {
    const [connected, setConnected] = useState(false);
    const [gameState, setGameState] = useState(null);
    const [myHand, setMyHand] = useState([]);
    const [selectedCards, setSelectedCards] = useState([]);
    const [myPlayerId, setMyPlayerId] = useState(null);
    const [roomId, setRoomId] = useState('room1'); // Default room for now

    useEffect(() => {
        socket.on('connect', () => {
            setConnected(true);
            setMyPlayerId(socket.id);
        });

        socket.on('playerJoined', (players) => {
            console.log('Players joined:', players);
            setGameState(prev => ({
                ...prev,
                players: players,
                turnIndex: prev?.turnIndex || 0 // Default to 0 if not set
            }));
        });

        socket.on('gameStarted', (data) => {
            console.log('Game Started:', data);
            setGameState(data);
            setMyHand(data.myHand);
            setSelectedCards([]); // Reset selection
        });

        socket.on('gameError', (msg) => {
            alert(msg);
        });

        return () => {
            socket.off('connect');
            socket.off('playerJoined');
            socket.off('gameStarted');
            socket.off('gameError');
        };
    }, []);

    const handleJoin = () => {
        console.log('handleJoin called');
        socket.emit('joinRoom', { roomId, playerName: 'Me' });
    };

    const handleStart = () => {
        socket.emit('startGame', roomId);
    };

    const handlePlay = () => {
        if (selectedCards.length === 0) return;

        // Convert indices to actual cards (optional, or let server handle indices)
        // Sending indices is safer if state is synced, but sending cards is easier for stateless validation
        // Let's send indices for now
        socket.emit('playCards', { roomId, cardIndices: selectedCards });

        // Optimistic update or wait for server? Wait for server 'cardsPlayed' event
    };

    const handlePass = () => {
        socket.emit('passTurn', { roomId });
        setSelectedCards([]); // Clear selection
    };

    const handleGridClick = (arg) => {
        if (gameState && gameState.gameState === 'TRIBUTE') {
            // Check if it's my turn to pay/return
            const myAction = gameState.tributePending.find(a => a.from === socket.id);
            if (myAction) {
                // arg is card index
                if (typeof arg === 'number') {
                    if (myAction.type === 'PAY') {
                        socket.emit('payTribute', { roomId, cardIndex: arg });
                    } else {
                        socket.emit('returnCard', { roomId, cardIndex: arg });
                    }
                }
            }
            return;
        }

        if (arg === 'PLAY') {
            handlePlay();
        } else if (arg === 'PASS') {
            handlePass();
        } else {
            // It's an index
            toggleCardSelection(arg);
        }
    };

    const toggleCardSelection = (index) => {
        if (selectedCards.includes(index)) {
            setSelectedCards(selectedCards.filter(i => i !== index));
        } else {
            setSelectedCards([...selectedCards, index]);
        }
    };

    return (
        <div className="flex flex-col h-screen w-screen bg-gray-100 overflow-hidden font-sans text-xs">
            {/* Excel Title Bar (Fake) */}
            <div className="h-8 bg-[#217346] flex items-center px-4 justify-between text-white select-none">
                <div className="flex items-center gap-4">
                    <span className="font-bold">自动保存</span>
                    <span>关</span>
                    <span className="mx-4">工作簿1 - Excel</span>
                </div>
                <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                </div>
            </div>

            <Ribbon onJoin={handleJoin} onStart={handleStart} onPlay={handlePlay} />

            <div className="flex-1 overflow-auto relative">
                <ExcelGrid
                    socket={socket}
                    myHand={myHand}
                    gameState={gameState}
                    myPlayerId={myPlayerId}
                    selectedCards={selectedCards}
                    onCardClick={handleGridClick}
                />

                {/* Tribute Modal Overlay */}
                {gameState && gameState.gameState === 'TRIBUTE' && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-white p-6 rounded shadow-lg border border-gray-300">
                            <h2 className="text-lg font-bold mb-4">进贡/还牌阶段</h2>
                            {gameState.tributePending.find(a => a.from === socket.id) ? (
                                <p className="text-red-600 font-bold">
                                    {gameState.tributePending.find(a => a.from === socket.id).type.includes('PAY') ? '请点击一张最大的牌进贡' : '请点击一张牌还给对方'}
                                </p>
                            ) : (
                                <p className="text-gray-600">等待其他玩家操作...</p>
                            )}
                        </div>
                    </div>
                )}

                {/* Game Over Modal */}
                {gameState && gameState.gameState === 'GAME_OVER_WIN' && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-white p-8 rounded shadow-lg border border-gray-300 text-center">
                            <h2 className="text-2xl font-bold mb-4 text-[#217346]">游戏结束</h2>
                            <p className="text-lg mb-6">
                                恭喜 <span className="font-bold text-red-600">队伍 {gameState.finalWinner}</span> 获胜！
                            </p>
                            <button
                                onClick={handleStart}
                                className="px-6 py-2 bg-[#217346] text-white rounded hover:bg-[#1e6b41]"
                            >
                                再来一局
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Status Bar */}
            <div className="h-6 bg-[#217346] text-white flex items-center px-2 text-[10px] gap-4">
                <span>就绪</span>
                {gameState && (
                    <>
                        <span>我是: 玩家 {gameState.players.find(p => p.id === socket.id)?.index + 1}</span>
                        <span>当前回合: 玩家 {gameState.turnIndex + 1}</span>
                        <span>人数: {gameState.players.length}/4</span>
                    </>
                )}
                <span className="flex-1"></span>
                <span>{connected ? '已连接' : '未连接'}</span>
                <span>普通视图</span>
            </div>
        </div>
    );
}

export default App;
