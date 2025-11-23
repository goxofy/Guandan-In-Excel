# Excel-style Guandan Web App (掼蛋 - 摸鱼神器)

A web-based Guandan (掼蛋) card game disguised as an Excel spreadsheet, perfect for discreet gameplay.

## Features

*   **Excel Disguise**: The UI mimics Microsoft Excel to avoid detection.
*   **Full Game Logic**: Supports all core Guandan rules including:
    *   Single, Pair, Triplet, Bomb, Straight, Tube (3 consecutive pairs), Plate (2 consecutive triplets), Straight Flush, King Bomb.
    *   **Ghost Card (逢人配)**: Heart Level Card acts as a wildcard.
    *   **Tribute (进贡)**: Single and Double Tribute logic with Return (还牌).
    *   **Level Progression (升级)**: Double Victory (+3), Single Victory (+2), Keep (+1).
    *   **Jiefeng (接风)**: Partner leads if winner finishes.
*   **Multiplayer**: Supports 4 players per room via Socket.io.

## Prerequisites

*   Node.js (v14 or higher)
*   npm

## Installation

1.  **Clone the repository** (if applicable) or download the source code.
2.  **Install dependencies** for both server and client:

    ```bash
    # Install server dependencies
    cd server
    npm install

    # Install client dependencies
    cd ../client
    npm install
    ```

## Running the Application

You need to run both the server and the client.

1.  **Start the Server**:
    ```bash
    cd server
    node server.js
    ```
    The server will start on port `3001`.

2.  **Start the Client**:
    ```bash
    cd client
    npm run dev
    ```
    The client will start on `http://localhost:5173`.

3.  **Play**:
    Open `http://localhost:5173` in your browser. Open 4 tabs to simulate 4 players for testing.

## How to Play

*   **Join**: Click "Join" (or refresh) to enter the room.
*   **Start**: When 4 players have joined, click "Start" (开始) in the ribbon.
*   **Select Cards**: Click on cells in the "Player Hand" area (Rows 15-20) to select cards.
*   **Play (出)**: Click the "出" button (Row 21, Col D) to play selected cards.
*   **Pass (过)**: Click the "过" button (Row 21, Col F) to pass your turn.
*   **Tribute**: Follow the on-screen prompts during the Tribute phase.

## License

MIT
