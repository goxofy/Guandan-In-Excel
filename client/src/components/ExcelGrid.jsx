import React from 'react';
import CardCell from './CardCell';

const ExcelGrid = ({ socket, myHand, gameState, myPlayerId, selectedCards, onCardClick }) => {
    const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
    const rows = Array.from({ length: 30 }, (_, i) => i + 1);

    // Helper to render cell content based on coordinate
    const renderCellContent = (col, row) => {
        const cellId = `${col}${row}`;

        // Player Hand Area: Rows 15-20, Cols C-H (6x6 = 36 cells)
        // Map hand index to cells
        const playerCols = ['C', 'D', 'E', 'F', 'G', 'H'];
        const playerStartRow = 15;

        if (row >= playerStartRow && row < playerStartRow + 6 && playerCols.includes(col)) {
            const colIndex = playerCols.indexOf(col);
            const rowIndex = row - playerStartRow;
            const handIndex = rowIndex * 6 + colIndex;

            if (myHand && myHand[handIndex]) {
                return (
                    <CardCell
                        card={myHand[handIndex]}
                        selected={selectedCards && selectedCards.includes(handIndex)}
                        onClick={() => onCardClick && onCardClick(handIndex)}
                    />
                );
            }
        }

        // Determine current turn index
        const currentTurnIndex = gameState ? gameState.turnIndex : -1;
        const myIndex = gameState && gameState.players ? gameState.players.findIndex(p => p.id === myPlayerId) : -1;

        // Calculate opponent indices relative to me
        // Right (下家) = (myIndex + 1) % 4
        // Top (对家) = (myIndex + 2) % 4
        // Left (上家) = (myIndex + 3) % 4

        const rightIndex = myIndex !== -1 ? (myIndex + 1) % 4 : -1;
        const topIndex = myIndex !== -1 ? (myIndex + 2) % 4 : -1;
        const leftIndex = myIndex !== -1 ? (myIndex + 3) % 4 : -1;

        // Opponent Areas (Simple placeholders for now)
        if (cellId === 'D2') {
            const isTurn = currentTurnIndex === topIndex;
            return <span className={`font-bold text-gray-500 ${isTurn ? 'bg-[#e6f4ea] px-2' : ''}`}>对家 (上)</span>;
        }
        if (cellId === 'A6') {
            const isTurn = currentTurnIndex === leftIndex;
            return <span className={`font-bold text-gray-500 ${isTurn ? 'bg-[#e6f4ea] px-2' : ''}`}>上家 (左)</span>;
        }
        if (cellId === 'J6') {
            const isTurn = currentTurnIndex === rightIndex;
            return <span className={`font-bold text-gray-500 ${isTurn ? 'bg-[#e6f4ea] px-2' : ''}`}>下家 (右)</span>;
        }

        // Table Area (Center): Rows 6-9, Cols D-G
        // Let's render played cards here
        const tableCols = ['D', 'E', 'F', 'G', 'H', 'I'];
        const tableStartRow = 6;

        if (row >= tableStartRow && row < tableStartRow + 2 && tableCols.includes(col)) {
            const colIndex = tableCols.indexOf(col);
            const rowIndex = row - tableStartRow;
            const cardIndex = rowIndex * 6 + colIndex;

            if (gameState && gameState.tableCards && gameState.tableCards[cardIndex]) {
                return <CardCell card={gameState.tableCards[cardIndex]} />;
            }
        }

        if (cellId === 'D6' && (!gameState || !gameState.tableCards || gameState.tableCards.length === 0)) {
            return <span className="text-gray-400 italic">出牌区</span>;
        }

        return null;
    };

    return (
        <div className="grid" style={{ gridTemplateColumns: '40px repeat(15, 80px)' }}>
            {/* Header Row */}
            <div className="bg-gray-100 border-r border-b border-gray-300"></div> {/* Corner */}
            {cols.map(col => (
                <div key={col} className="bg-gray-100 border-r border-b border-gray-300 text-center font-bold text-gray-600 flex items-center justify-center">
                    {col}
                </div>
            ))}

            {/* Data Rows */}
            {rows.map(row => {
                // Determine if this row is part of the player's hand area (15-20)
                const isHandRow = row >= 15 && row <= 20;
                // Check if it's my turn
                const isMyTurn = gameState && gameState.players && gameState.players[gameState.turnIndex]?.id === myPlayerId;
                const handBgClass = isHandRow && isMyTurn ? 'bg-[#e6f4ea]' : 'bg-white'; // Light green if my turn

                return (
                    <React.Fragment key={row}>
                        {/* Row Number */}
                        <div className="bg-gray-100 border-r border-b border-gray-300 text-center text-gray-600 flex items-center justify-center">
                            {row}
                        </div>
                        {/* Cells */}
                        {cols.map(col => {
                            const cellId = `${col}${row}`;

                            // Render Buttons in Row 21
                            if (row === 21) {
                                if (col === 'D') {
                                    return (
                                        <div key={cellId} className="border-r border-b border-gray-200 bg-white px-1 flex items-center justify-center">
                                            <button
                                                onClick={() => onCardClick && onCardClick('PLAY')} // Special signal or just use onPlay prop? Let's use a new prop or reuse onCardClick with special arg?
                                                // Better: Pass onPlay and onPass as props to ExcelGrid
                                                className="bg-[#217346] text-white px-4 py-0.5 rounded text-xs hover:bg-[#1e6b41] disabled:opacity-50 disabled:cursor-not-allowed"
                                                disabled={!selectedCards || selectedCards.length === 0}
                                            >
                                                出
                                            </button>
                                        </div>
                                    );
                                }
                                if (col === 'F') {
                                    return (
                                        <div key={cellId} className="border-r border-b border-gray-200 bg-white px-1 flex items-center justify-center">
                                            <button
                                                onClick={() => onCardClick && onCardClick('PASS')}
                                                className="bg-gray-500 text-white px-4 py-0.5 rounded text-xs hover:bg-gray-600"
                                            >
                                                过
                                            </button>
                                        </div>
                                    );
                                }
                            }

                            return (
                                <div
                                    key={cellId}
                                    className={`border-r border-b border-gray-200 px-1 text-gray-800 whitespace-nowrap overflow-hidden text-[11px] hover:border-2 hover:border-[#217346] cursor-cell h-[24px] flex items-center ${handBgClass}`}
                                >
                                    {renderCellContent(col, row)}
                                </div>
                            );
                        })}
                    </React.Fragment>
                );
            })}
        </div>
    );
};

export default ExcelGrid;
