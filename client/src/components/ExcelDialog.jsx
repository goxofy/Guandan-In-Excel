import React from 'react';

const ExcelDialog = ({ isOpen, title, message, onConfirm, type = 'error' }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 flex items-center justify-center z-50">
            {/* Overlay */}
            <div className="absolute inset-0 bg-black opacity-20"></div>

            {/* Dialog Box - Windows 95 / Classic Excel Style */}
            <div className="relative bg-[#c0c0c0] border-2 border-white border-r-gray-800 border-b-gray-800 shadow-xl p-1 min-w-[300px] max-w-[400px]">
                {/* Title Bar */}
                <div className="bg-[#000080] text-white px-2 py-1 flex justify-between items-center select-none">
                    <span className="font-bold text-sm">{title || 'Microsoft Excel'}</span>
                    <button
                        onClick={onConfirm}
                        className="bg-[#c0c0c0] text-black w-4 h-4 flex items-center justify-center text-xs font-bold border border-white border-r-gray-800 border-b-gray-800 active:border-gray-800 active:border-r-white active:border-b-white"
                    >
                        X
                    </button>
                </div>

                {/* Content Area */}
                <div className="p-4 flex flex-col items-center gap-4">
                    <div className="flex items-start gap-4 w-full">
                        {/* Icon */}
                        <div className="flex-shrink-0">
                            {type === 'error' && (
                                <div className="w-8 h-8 bg-red-600 rounded-full flex items-center justify-center text-white font-bold border-2 border-white shadow-md">
                                    !
                                </div>
                            )}
                            {type === 'info' && (
                                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold border-2 border-white shadow-md">
                                    i
                                </div>
                            )}
                        </div>

                        {/* Message */}
                        <div className="text-black text-sm pt-1">
                            {message}
                        </div>
                    </div>

                    {/* Buttons */}
                    <div className="flex justify-center w-full mt-2">
                        <button
                            onClick={onConfirm}
                            className="px-6 py-1 bg-[#c0c0c0] border-2 border-white border-r-black border-b-black active:border-black active:border-r-white active:border-b-white focus:outline-none focus:ring-1 focus:ring-black text-sm font-bold min-w-[80px]"
                        >
                            确定
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ExcelDialog;
