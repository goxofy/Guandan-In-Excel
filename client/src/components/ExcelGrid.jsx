import React from 'react';
import CardCell from './CardCell';

const ExcelGrid = ({ socket, myHand, gameState, myPlayerId, selectedCards, onCardClick }) => {
    const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
    const rows = Array.from({ length: 30 }, (_, i) => i + 1);

    // Determine current turn index
    const currentTurnIndex = gameState ? gameState.turnIndex : -1;

    // Helper to get player by relative position
    const getPlayerByPos = (pos) => {
        if (!gameState || !gameState.players) return null;
        const myIndex = gameState.players.findIndex(p => p.id === myPlayerId);
        if (myIndex === -1) return null;

        let targetIndex;
        if (pos === 'SELF') targetIndex = myIndex;
        else if (pos === 'RIGHT') targetIndex = (myIndex + 1) % 4;
        else if (pos === 'TOP') targetIndex = (myIndex + 2) % 4;
        else if (pos === 'LEFT') targetIndex = (myIndex + 3) % 4;

        return gameState.players[targetIndex];
    };

    // Helper to render cell content based on coordinate
    const renderCellContent = (col, row) => {
        const cellId = `${col}${row}`;

        // Player Hand Area: Rows 21-24, Cols E-K (7 cols x 4 rows = 28 cells)
        const playerCols = ['E', 'F', 'G', 'H', 'I', 'J', 'K'];
        const playerStartRow = 21;

        if (row >= playerStartRow && row < playerStartRow + 4 && playerCols.includes(col)) {
            const colIndex = playerCols.indexOf(col);
            const rowIndex = row - playerStartRow;
            const handIndex = rowIndex * 7 + colIndex;

            if (myHand && myHand[handIndex]) {
                return {
                    content: (
                        <CardCell
                            card={myHand[handIndex]}
                            selected={selectedCards && selectedCards.includes(handIndex)}
                            onClick={() => onCardClick && onCardClick(handIndex)}
                        />
                    ),
                    style: {}
                };
            }
        }

        // Render Other Players' Hands (Review Mode)
        // TOP Hand: Rows 3-4, Cols D-L
        const topPlayer = getPlayerByPos('TOP');
        if (topPlayer && Array.isArray(topPlayer.hand)) {
            const topCols = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
            if ((row === 3 || row === 4) && topCols.includes(col)) {
                const colIndex = topCols.indexOf(col);
                const rowIndex = row - 3;
                const handIndex = rowIndex * 9 + colIndex;
                if (topPlayer.hand[handIndex]) {
                    return { content: <CardCell card={topPlayer.hand[handIndex]} />, style: { opacity: 0.8 } };
                }
            }
        }

        // LEFT Hand: Cols C-D, Rows 6-15
        const leftPlayer = getPlayerByPos('LEFT');
        if (leftPlayer && Array.isArray(leftPlayer.hand)) {
            const leftCols = ['C', 'D'];
            if (leftCols.includes(col) && row >= 6 && row <= 15) {
                const colIndex = leftCols.indexOf(col);
                const rowIndex = row - 6;
                const handIndex = rowIndex * 2 + colIndex;
                if (leftPlayer.hand[handIndex]) {
                    return { content: <CardCell card={leftPlayer.hand[handIndex]} />, style: { opacity: 0.8 } };
                }
            }
        }

        // RIGHT Hand: Cols L-M, Rows 6-15
        const rightPlayer = getPlayerByPos('RIGHT');
        if (rightPlayer && Array.isArray(rightPlayer.hand)) {
            const rightCols = ['L', 'M'];
            if (rightCols.includes(col) && row >= 6 && row <= 15) {
                const colIndex = rightCols.indexOf(col);
                const rowIndex = row - 6;
                const handIndex = rowIndex * 2 + colIndex;
                if (rightPlayer.hand[handIndex]) {
                    return { content: <CardCell card={rightPlayer.hand[handIndex]} />, style: { opacity: 0.8 } };
                }
            }
        }

        // Round Plays Rendering
        const renderRoundPlay = (pos, startRow, startColChar, isVertical = false) => {
            const p = getPlayerByPos(pos);
            if (!p || !gameState.roundPlays || !gameState.roundPlays[p.id]) return null;

            const play = gameState.roundPlays[p.id];

            // Check if this is the active "Last Played Hand" that needs to be beaten
            const isLastPlayed = gameState.lastPlayedHand && gameState.lastPlayedHand.playerId === p.id;
            const bgStyle = isLastPlayed ? { backgroundColor: '#fff7ed' } : {}; // Light orange background

            if (play.type === 'PASS') {
                if (row === startRow && col === startColChar) {
                    return { content: <span className="text-gray-400 italic">PASS</span>, style: {} };
                }
                return null;
            }

            const cards = play.cards;

            if (isVertical) {
                // Vertical Layout: All in one column, multiple rows
                if (col === startColChar && row >= startRow && row < startRow + cards.length) {
                    const cIdx = row - startRow;
                    if (cards[cIdx]) {
                        return { content: <CardCell card={cards[cIdx]} />, style: bgStyle };
                    }
                }
            } else {
                // Horizontal Layout: E-K (7 cols)
                const tableCols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
                const startColIndex = tableCols.indexOf(startColChar);

                // Check if current cell is within range (2 rows, 7 cols)
                if (row >= startRow && row < startRow + 2) {
                    const colIndex = tableCols.indexOf(col);
                    if (colIndex >= startColIndex && colIndex < startColIndex + 7) {
                        const cIdx = (row - startRow) * 7 + (colIndex - startColIndex);
                        if (cards[cIdx]) {
                            return { content: <CardCell card={cards[cIdx]} />, style: bgStyle };
                        }
                    }
                }
            }
            return null;
        };

        // Check for round plays for all players
        const topPlay = renderRoundPlay('TOP', 3, 'E');
        if (topPlay) return topPlay;
        const leftPlay = renderRoundPlay('LEFT', 8, 'C', true);
        if (leftPlay) return leftPlay;
        const rightPlay = renderRoundPlay('RIGHT', 8, 'M', true);
        if (rightPlay) return rightPlay;
        const selfPlay = renderRoundPlay('SELF', 19, 'E');
        if (selfPlay) return selfPlay;

        // Finished/Ready Markers & Card Counts
        const isPlaying = gameState && gameState.gameState === 'PLAYING';

        // Helper to get rank text
        const getRankText = (player) => {
            if (!gameState || !gameState.rankings) return '(已出完)';
            const rankIndex = gameState.rankings.indexOf(player.id);
            if (rankIndex === 0) return '头游';
            if (rankIndex === 1) return '二游';
            if (rankIndex === 2) return '三游';
            if (rankIndex === 3) return '末游';
            return '(已出完)';
        };

        if (cellId === 'H1') { // Top Player Card Count
            const p = getPlayerByPos('TOP');
            if (p && isPlaying && typeof p.hand === 'number' && p.hand > 0 && p.hand <= 10) {
                return { content: <span className="text-red-600 font-bold text-xs w-full text-center block">{p.hand}张</span>, style: {} };
            }
        }

        if (cellId === 'H3') { // Top Marker
            const p = getPlayerByPos('TOP');
            if (p) {
                if (!isPlaying) return { content: <span className="text-gray-400 text-xs w-full text-center block">(已就绪)</span>, style: {} };
                if (p.hand === 0) return { content: <span className="text-gray-400 text-xs w-full text-center block">({getRankText(p)})</span>, style: {} };
            }
        }
        if (cellId === 'B11') { // Left Marker & Count
            const p = getPlayerByPos('LEFT');
            if (p) {
                if (!isPlaying) return { content: <span className="text-gray-400 text-xs w-full text-center block">(已就绪)</span>, style: {} };
                if (p.hand === 0) return { content: <span className="text-gray-400 text-xs w-full text-center block">({getRankText(p)})</span>, style: {} };
                if (typeof p.hand === 'number' && p.hand > 0 && p.hand <= 10) {
                    return { content: <span className="text-red-600 font-bold text-xs w-full text-center block">{p.hand}张</span>, style: {} };
                }
            }
        }
        if (cellId === 'N11') { // Right Marker & Count
            const p = getPlayerByPos('RIGHT');
            if (p) {
                if (!isPlaying) return { content: <span className="text-gray-400 text-xs w-full text-center block">(已就绪)</span>, style: {} };
                if (p.hand === 0) return { content: <span className="text-gray-400 text-xs w-full text-center block">({getRankText(p)})</span>, style: {} };
                if (typeof p.hand === 'number' && p.hand > 0 && p.hand <= 10) {
                    return { content: <span className="text-red-600 font-bold text-xs w-full text-center block">{p.hand}张</span>, style: {} };
                }
            }
        }
        if (cellId === 'H20') { // Self Marker (Above Hand)
            const p = getPlayerByPos('SELF');
            if (p) {
                if (!isPlaying) return { content: <span className="text-gray-400 text-xs w-full text-center block">(已就绪)</span>, style: {} };
                if (p.hand.length === 0) return { content: <span className="text-gray-400 text-xs w-full text-center block">({getRankText(p)})</span>, style: {} };
            }
        }

        // Tribute Log Display (Center of Table)
        if (cellId === 'G12' && gameState && gameState.lastTributeLog) {
            const log = gameState.lastTributeLog;
            const fromPlayer = gameState.players.find(p => p.id === log.from);
            const toPlayer = gameState.players.find(p => p.id === log.to);
            const card = log.card;

            if (fromPlayer && toPlayer && card) {
                return {
                    content: (
                        <div className="absolute top-0 left-0 w-[240px] h-[80px] bg-yellow-50 border border-yellow-300 rounded flex items-center justify-center gap-4 shadow-md z-10 pointer-events-none">
                            <div className="text-xs text-center">
                                <span className="font-bold block">{fromPlayer.name}</span>
                                <span className="text-gray-500">{log.type === 'PAY' || log.type === 'PAY_DOUBLE' ? '进贡' : '还牌'}</span>
                            </div>
                            <div className="transform scale-125">
                                <CardCell card={card} />
                            </div>
                            <div className="text-xs text-center">
                                <span className="text-gray-500">给</span>
                                <span className="font-bold block">{toPlayer.name}</span>
                            </div>
                        </div>
                    ),
                    style: { position: 'relative', overflow: 'visible' }
                };
            }
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
                // Determine if this row is part of the player's hand area (21-24)
                const isHandRow = row >= 21 && row <= 24;
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

                            // Render Player Labels with Full Cell Background
                            if (cellId === 'H2' || cellId === 'B10' || cellId === 'N10') {
                                let pos = '';
                                let label = '';
                                if (cellId === 'H2') { pos = 'TOP'; label = '对家 (上)'; }
                                if (cellId === 'B10') { pos = 'LEFT'; label = '上家 (左)'; }
                                if (cellId === 'N10') { pos = 'RIGHT'; label = '下家 (右)'; }

                                const p = getPlayerByPos(pos);
                                const isPlaying = gameState && gameState.gameState === 'PLAYING';
                                const isTurn = isPlaying && p && currentTurnIndex === p.index;

                                return (
                                    <div
                                        key={cellId}
                                        className={`border-r border-b border-gray-200 flex items-center justify-center font-bold text-sm h-[24px] ${isTurn ? 'text-white' : 'text-gray-500'}`}
                                        style={{ backgroundColor: isTurn ? '#217346' : 'white' }}
                                    >
                                        {label}
                                    </div>
                                );
                            }

                            // Render Buttons in Row 25 (Excel Style)
                            if (row === 25) {
                                if (col === 'G') { // Play Button
                                    const disabled = !selectedCards || selectedCards.length === 0;
                                    return (
                                        <div
                                            key={cellId}
                                            className={`border-r border-b border-gray-200 flex items-center justify-center cursor-pointer text-sm font-bold h-[24px] ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'}`}
                                            style={{ backgroundColor: '#217346', color: 'white' }}
                                            onClick={() => !disabled && onCardClick && onCardClick('PLAY')}
                                        >
                                            出
                                        </div>
                                    );
                                }
                                if (col === 'I') { // Pass Button
                                    const disabled = !myHand || myHand.length === 0;
                                    return (
                                        <div
                                            key={cellId}
                                            className={`border-r border-b border-gray-200 flex items-center justify-center cursor-pointer text-sm font-bold h-[24px] ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'}`}
                                            style={{ backgroundColor: '#6b7280', color: 'white' }}
                                            onClick={() => !disabled && onCardClick && onCardClick('PASS')}
                                        >
                                            过
                                        </div>
                                    );
                                }
                            }

                            const cellData = renderCellContent(col, row);
                            const content = cellData ? cellData.content : null;
                            const style = cellData ? cellData.style : {};

                            return (
                                <div key={cellId} className={`border-r border-b border-gray-200 ${handBgClass} px-1 flex items-center justify-center h-[24px]`} style={style}>
                                    {content}
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
