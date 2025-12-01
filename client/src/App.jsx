import React, { useState, useEffect, useRef } from 'react';
import Ribbon from './components/Ribbon';
import ExcelGrid from './components/ExcelGrid';
import { io } from 'socket.io-client';

const socketUrl = import.meta.env.PROD ? '/' : 'http://localhost:3001';
const socket = io(socketUrl);

function App() {
    const [connected, setConnected] = useState(false);
    const [gameState, setGameState] = useState(null);
    const [myHand, setMyHand] = useState([]);
    const [selectedCards, setSelectedCards] = useState([]);
    const [myPlayerId, setMyPlayerId] = useState(null);
    // Persistent Room ID
    const [roomId, setRoomId] = useState(() => {
        let stored = localStorage.getItem('guandan_roomId');
        return stored || 'room1';
    });

    const [errorMsg, setErrorMsg] = useState(null); // State for error modal

    // Persistent User ID
    const [userId, setUserId] = useState(() => {
        let stored = localStorage.getItem('guandan_userId');
        if (!stored) {
            stored = 'user_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('guandan_userId', stored);
        }
        return stored;
    });

    const roomIdRef = useRef(roomId); // Ref to track current roomId

    useEffect(() => {
        roomIdRef.current = roomId;
        localStorage.setItem('guandan_roomId', roomId);
        console.log('[App] roomId changed to:', roomId);
    }, [roomId]);

    const myHandRef = useRef(myHand);

    useEffect(() => {
        myHandRef.current = myHand;
    }, [myHand]);

    // Timer update hook
    const [currentTime, setCurrentTime] = useState(Date.now());
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(Date.now());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        socket.on('connect', () => {
            setConnected(true);
            setMyPlayerId(socket.id);

            // Auto-rejoin logic
            const currentRoomId = roomIdRef.current;
            const storedUserId = localStorage.getItem('guandan_userId');

            if (currentRoomId && storedUserId) {
                console.log('[App] Auto-rejoining room:', currentRoomId, 'User:', storedUserId);
                socket.emit('joinRoom', { roomId: currentRoomId, playerName: 'Me', userId: storedUserId });
            } else {
                console.log('[App] Auto-rejoin skipped. Room:', currentRoomId, 'User:', storedUserId);
            }
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
            console.log('Game started/updated:', data);
            // Debug: Check players hands
            if (data.players) {
                console.log('[App] Received players:', data.players.map(p => ({ id: p.id, handType: Array.isArray(p.hand) ? 'Array' : typeof p.hand, handLen: Array.isArray(p.hand) ? p.hand.length : p.hand })));
            }
            setGameState(data);
            setMyHand(data.myHand);
            // Only clear selection if hand changed (i.e. I played cards or new game)
            const prevHand = myHandRef.current;
            const newHand = data.myHand;
            if (JSON.stringify(prevHand) !== JSON.stringify(newHand)) {
                setSelectedCards([]);
            }
        });

        socket.on('gameEnded', (data) => {
            console.log('Game Ended:', data);
            if (data.finalWinner) {
                setGameState(prev => ({
                    ...prev,
                    gameState: 'GAME_OVER_WIN',
                    finalWinner: data.finalWinner,
                    rankings: data.rankings,
                    teamLevels: data.teamLevels
                }));
            } else {
                setGameState(prev => ({
                    ...prev,
                    gameState: 'ROUND_ENDED',
                    levelJump: data.levelJump,
                    nextLevel: data.nextLevel,
                    teamLevels: data.teamLevels,
                    rankings: data.rankings,
                    winningTeam: data.finalWinner // Store winning team for modal
                }));
            }
        });

        socket.on('gameError', (msg) => {
            setErrorMsg(msg); // Show custom modal instead of alert
        });

        return () => {
            socket.off('connect');
            socket.off('playerJoined');
            socket.off('gameStarted');
            socket.off('gameEnded');
            socket.off('gameError');
        };
    }, []);

    const handleJoin = () => {
        console.log('handleJoin called');
        const inputRoomId = prompt('请输入房间号 (留空默认 room1):', roomId);
        const finalRoomId = (inputRoomId && inputRoomId.trim()) ? inputRoomId.trim() : 'room1';
        setRoomId(finalRoomId);
        socket.emit('joinRoom', { roomId: finalRoomId, playerName: 'Me', userId });
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
                    if (myAction.type === 'PAY' || myAction.type === 'PAY_DOUBLE') {
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

    const handleSinglePlayer = () => {
        const spRoomId = prompt('请输入单人模式房间号 (留空自动生成):', '');
        let finalRoomId;
        if (spRoomId && spRoomId.trim()) {
            finalRoomId = 'sp_' + spRoomId.trim();
        } else {
            finalRoomId = 'sp_' + Math.random().toString(36).substr(2, 6);
        }
        setRoomId(finalRoomId);
        socket.emit('joinSinglePlayerRoom', { roomId: finalRoomId, userId, playerName: 'Me' });
    };

    const handleExit = () => {
        console.log('handleExit called');
        if (confirm('确定要退出当前房间吗？')) {
            console.log('Exiting room...');
            if (roomId) {
                socket.emit('leaveRoom', { roomId });
            }
            localStorage.removeItem('guandan_roomId');
            setRoomId(null);
            window.location.reload();
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

            <Ribbon onJoin={handleJoin} onStart={handleStart} onPlay={handlePlay} onSinglePlayer={handleSinglePlayer} onExit={handleExit} />

            <div className="flex-1 overflow-auto relative">
                <ExcelGrid
                    socket={socket}
                    myHand={myHand}
                    gameState={gameState}
                    myPlayerId={myPlayerId}
                    selectedCards={selectedCards}
                    onCardClick={handleGridClick}
                />

                {/* Tribute Status Banner */}
                {gameState && gameState.gameState === 'TRIBUTE' && (
                    <div className="absolute z-50" style={{ left: '640px', top: '170px', transform: 'translateX(-50%)' }}>
                        <div className="bg-white p-4 rounded shadow-lg border border-gray-300 min-w-[300px] text-center">
                            <h2 className="text-lg font-bold mb-2">进贡/还牌阶段</h2>
                            {gameState.tributePending.find(a => a.from === socket.id) ? (
                                <p className="text-red-600 font-bold animate-pulse">
                                    {gameState.tributePending.find(a => a.from === socket.id).type.includes('PAY') ? '请点击一张最大的牌进贡' : '请点击一张牌还给对方'}
                                </p>
                            ) : (
                                <p className="text-gray-600">等待其他玩家操作...</p>
                            )}
                        </div>
                    </div>
                )}

                {/* Countdown Modal */}
                {gameState && gameState.gameState === 'COUNTDOWN' && (
                    <div className="absolute z-50" style={{ left: '640px', top: '170px', transform: 'translateX(-50%)' }}>
                        <div className="bg-white p-8 rounded shadow-lg border border-gray-300 text-center min-w-[300px]">
                            <h2 className="text-xl font-bold mb-4 text-[#217346]">进贡完成</h2>
                            <p className="text-lg mb-4">游戏将在 <span className="text-red-600 font-bold text-2xl">{gameState.countdown}</span> 秒后开始</p>
                        </div>
                    </div>
                )}

                {/* Round Ended Modal */}
                {gameState && gameState.gameState === 'ROUND_ENDED' && (
                    <div className="absolute z-50" style={{ left: '640px', top: '170px', transform: 'translateX(-50%)' }}>
                        <div className="bg-white p-8 rounded shadow-lg border border-gray-300 text-center min-w-[300px]">
                            <h2 className="text-xl font-bold mb-4 text-[#217346]">本局结束</h2>
                            <div className="mb-6 text-left">
                                <p className="mb-2">
                                    {gameState.winningTeam ? `Team ${gameState.winningTeam} 升级` : '赢家升级'}:
                                    <span className="font-bold text-red-600"> +{gameState.levelJump} 级</span>
                                </p>
                                <p className="mb-2">下局打: <span className="font-bold text-blue-600">{gameState.nextLevel}</span></p>
                                <div className="mt-4 border-t pt-2">
                                    <p className="text-gray-600 font-bold">当前等级:</p>
                                    <p>A队: {gameState.teamLevels['A']}</p>
                                    <p>B队: {gameState.teamLevels['B']}</p>
                                </div>
                            </div>
                            <button
                                onClick={handleStart}
                                className="px-6 py-2 bg-[#217346] text-white rounded hover:bg-[#1e6b41] w-full"
                            >
                                继续 (进入进贡)
                            </button>
                        </div>
                    </div>
                )}
                {/* Game Over Modal (Final Victory) */}
                {gameState && gameState.gameState === 'GAME_OVER_WIN' && (
                    <div className="absolute z-50" style={{ left: '640px', top: '170px', transform: 'translateX(-50%)' }}>
                        <div className="bg-white p-8 rounded shadow-lg border border-gray-300 text-center min-w-[300px]">
                            <h2 className="text-2xl font-bold mb-4 text-[#217346]">游戏通关！</h2>
                            <p className="text-lg mb-6">
                                恭喜 <span className="font-bold text-red-600">队伍 {gameState.finalWinner}</span> 率先打过A级！
                            </p>
                            <button
                                onClick={handleStart}
                                className="px-6 py-2 bg-[#217346] text-white rounded hover:bg-[#1e6b41]"
                            >
                                重新开始
                            </button>
                        </div>
                    </div>
                )}

                {/* Error Modal */}
                {errorMsg && (
                    <div className="absolute z-50" style={{ left: '640px', top: '170px', transform: 'translateX(-50%)' }}>
                        <div className="bg-white p-6 rounded shadow-lg border border-gray-300 text-center min-w-[250px]">
                            <h2 className="text-lg font-bold mb-4 text-red-600">提示</h2>
                            <p className="mb-6 text-gray-700">{errorMsg}</p>
                            <button
                                onClick={() => setErrorMsg(null)}
                                className="px-6 py-2 bg-[#217346] text-white rounded hover:bg-[#1e6b41]"
                            >
                                确定
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Status Bar */}
            <div className="h-6 bg-[#217346] text-white flex items-center px-2 text-[10px] gap-4 relative">
                <span>就绪</span>
                <span>房间: {roomId || '未加入'}</span>
                {gameState && (
                    <>
                        <span>我是: 玩家 {gameState.players.find(p => p.id === socket.id)?.index + 1}</span>
                        <span>当前回合: 玩家 {gameState.turnIndex + 1}</span>
                        <span>人数: {gameState.players.length}/4</span>
                    </>
                )}

                {/* Centered Status Info */}
                {gameState && gameState.teamLevels && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="font-bold text-yellow-300">
                            A队: Lv{gameState.teamLevels['A']} &nbsp;&nbsp; B队: Lv{gameState.teamLevels['B']} &nbsp;&nbsp; 当前级牌: {gameState.currentLevelRank}
                        </span>
                        {gameState.gameState === 'PLAYING' && gameState.turnDeadline && (
                            <span className="ml-4 font-mono text-white bg-red-600 px-2 rounded">
                                {Math.max(0, Math.floor((gameState.turnDeadline - currentTime) / 1000))}s
                            </span>
                        )}
                    </div>
                )}

                <span className="flex-1"></span>
                <span>{connected ? '已连接' : '未连接'}</span>
                <span>普通视图</span>
            </div>
        </div>
    );
}

export default App;
