import React, { useState } from 'react';
import { Play, LogIn, RefreshCw, Save, Clipboard, Scissors, Copy, User, LogOut } from 'lucide-react';

const Ribbon = ({ onJoin, onStart, onPlay, onSinglePlayer, onExit, onSortHand }) => {
    const [activeTab, setActiveTab] = useState('开始');

    const tabs = ['文件', '开始', '插入', '页面布局', '公式', '数据', '审阅', '视图', '帮助'];

    return (
        <div className="bg-white border-b border-gray-300 flex flex-col">
            {/* Tabs */}
            <div className="flex px-2 pt-1 bg-[#217346]">
                {tabs.map(tab => (
                    <div
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-1 text-white cursor-pointer text-xs rounded-t-sm ${activeTab === tab ? 'bg-white text-black font-medium' : 'hover:bg-[#1e6b41]'}`}
                    >
                        {tab}
                    </div>
                ))}
            </div>

            {/* Toolbar */}
            <div className="h-24 bg-[#f3f2f1] flex items-center px-4 gap-4 border-b border-gray-200 shadow-sm">
                {activeTab === '开始' && (
                    <>
                        {/* Fake Clipboard Group */}
                        <div className="flex flex-col items-center gap-1 pr-4 border-r border-gray-300">
                            <div className="flex gap-2">
                                <div className="flex flex-col items-center cursor-pointer hover:bg-gray-200 p-1 rounded">
                                    <Clipboard size={20} className="text-gray-600" />
                                    <span className="text-[10px]">粘贴</span>
                                </div>
                            </div>
                            <div className="flex gap-2 text-gray-600">
                                <Scissors size={14} />
                                <Copy size={14} />
                            </div>
                            <span className="text-[10px] text-gray-400 mt-auto">剪贴板</span>
                        </div>

                        {/* Game Controls Group (Disguised) */}
                        <div className="flex flex-col items-center gap-1 pr-4 border-r border-gray-300">
                            <div className="flex gap-2">
                                <button onClick={() => { console.log('Join button clicked'); onJoin(); }} className="flex flex-col items-center cursor-pointer hover:bg-gray-200 p-1 rounded" title="加入房间">
                                    <LogIn size={24} className="text-blue-600" />
                                    <span className="text-[10px]">加入</span>
                                </button>
                                <button onClick={onStart} className="flex flex-col items-center cursor-pointer hover:bg-gray-200 p-1 rounded" title="开始游戏">
                                    <Play size={24} className="text-green-600" />
                                    <span className="text-[10px]">开始</span>
                                </button>
                                <button onClick={onSinglePlayer} className="flex flex-col items-center cursor-pointer hover:bg-gray-200 p-1 rounded" title="单人模式">
                                    <User size={24} className="text-purple-600" />
                                    <span className="text-[10px]">单人</span>
                                </button>
                                <button onClick={() => { console.log('Ribbon Exit Clicked'); if (onExit) onExit(); else console.error('onExit prop missing'); }} className="flex flex-col items-center cursor-pointer hover:bg-gray-200 p-1 rounded" title="退出房间">
                                    <LogOut size={24} className="text-red-600" />
                                    <span className="text-[10px]">退出</span>
                                </button>
                                <button onClick={onSortHand} className="flex flex-col items-center cursor-pointer hover:bg-gray-200 p-1 rounded" title="理牌">
                                    <RefreshCw size={24} className="text-orange-600" />
                                    <span className="text-[10px]">理牌</span>
                                </button>
                            </div>
                            <span className="text-[10px] text-gray-400 mt-auto">游戏控制</span>
                        </div>

                        {/* Fake Font Group */}
                        <div className="flex flex-col gap-1 pr-4 border-r border-gray-300 opacity-50 pointer-events-none">
                            <div className="flex gap-1">
                                <select className="text-[10px] border border-gray-300"><option>等线</option></select>
                                <select className="text-[10px] border border-gray-300"><option>11</option></select>
                            </div>
                            <div className="flex gap-1">
                                <span className="font-bold px-1 bg-gray-200">B</span>
                                <span className="italic px-1">I</span>
                                <span className="underline px-1">U</span>
                            </div>
                            <span className="text-[10px] text-gray-400 mt-auto text-center">字体</span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default Ribbon;
