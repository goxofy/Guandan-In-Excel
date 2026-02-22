import React from 'react';
import clsx from 'clsx';

const CardCell = ({ card, selected, onClick }) => {
    if (!card) return null;

    const isRed = card.suit === 'H' || card.suit === 'D' || (card.suit === 'JOKER' && card.rank === 'BJ');

    // Suit mapping
    const suitMap = {
        'S': '♠',
        'H': '♥',
        'C': '♣',
        'D': '♦',
        'JOKER': ''
    };

    return (
        <div
            onClick={onClick}
            className={clsx(
                "w-full h-full flex items-center justify-center cursor-pointer select-none",
                selected ? "bg-[#e8f0fe] border border-blue-500" : "hover:bg-gray-50"
            )}
        >
            <span className={clsx(
                "font-sans text-[11px]",
                isRed ? "text-red-600" : "text-black"
            )}>
                {suitMap[card.suit]}{card.rank}
            </span>
        </div>
    );
};

export default CardCell;
