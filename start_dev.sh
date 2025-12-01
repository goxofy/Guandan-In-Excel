#!/bin/bash

# Function to kill processes on exit
cleanup() {
    echo "Stopping processes..."
    kill $SERVER_PID $CLIENT_PID
    exit
}

trap cleanup SIGINT

echo "Starting Server..."
cd server
# Check if nodemon is available locally, otherwise use node
if [ -f "node_modules/.bin/nodemon" ]; then
    ./node_modules/.bin/nodemon server.js &
else
    node server.js &
fi
SERVER_PID=$!
cd ..

echo "Starting Client..."
cd client
npm run dev &
CLIENT_PID=$!
cd ..

echo "Server PID: $SERVER_PID"
echo "Client PID: $CLIENT_PID"
echo "Press Ctrl+C to stop both."

wait
