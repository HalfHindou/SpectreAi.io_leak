#!/bin/bash
# Spectre Dev Servers - Auto-restart on crash
# Usage: ./dev.sh

PROJECT_DIR="/Users/sunny/Desktop/Spectre Vibe"
cd "$PROJECT_DIR"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Spectre AI - Development Servers                  ║${NC}"
echo -e "${GREEN}║     Auto-restart enabled                              ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"

# Kill any existing servers (by port and process name)
kill $(lsof -ti:3001) 2>/dev/null
kill $(lsof -ti:5180) 2>/dev/null
pkill -9 -f "vite" 2>/dev/null
pkill -9 -f "server/index.js" 2>/dev/null
sleep 2
echo -e "${YELLOW}Cleared ports 3001 and 5180${NC}"

# Function to run and restart Vite
run_vite() {
  while true; do
    echo -e "${YELLOW}[Vite] Starting frontend server...${NC}"
    cd "$PROJECT_DIR" && npm run dev
    echo -e "${RED}[Vite] Crashed! Restarting in 2 seconds...${NC}"
    sleep 2
  done
}

# Function to run and restart backend
run_backend() {
  while true; do
    echo -e "${YELLOW}[Backend] Starting API server...${NC}"
    cd "$PROJECT_DIR" && npm run server
    echo -e "${RED}[Backend] Crashed! Restarting in 2 seconds...${NC}"
    sleep 2
  done
}

# Trap to clean up on exit
cleanup() {
  echo -e "\n${YELLOW}Shutting down servers...${NC}"
  pkill -f "vite" 2>/dev/null
  pkill -f "node.*server/index.js" 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

# Start both in background
run_vite &
VITE_PID=$!

run_backend &
BACKEND_PID=$!

echo -e "${GREEN}Servers started:${NC}"
echo -e "  Frontend: http://localhost:5180/"
echo -e "  Backend:  http://localhost:3001/"
echo -e "${YELLOW}Press Ctrl+C to stop all servers${NC}"
echo ""

# Wait for both
wait $VITE_PID $BACKEND_PID
