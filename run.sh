#!/bin/bash

# AppBoard - Main Runner Script
# Usage: ./run.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/appboard.config.json"
BACKEND_PORT=6667
PANEL_PORT=6600
BACKEND_PID=""
PANEL_PID=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

print_logo() {
    echo -e "${CYAN}"
    echo "     _                ____                      _ "
    echo "    / \   _ __  _ __ | __ )  ___   __ _ _ __ __| |"
    echo "   / _ \ | '_ \| '_ \|  _ \ / _ \ / _\` | '__/ _\` |"
    echo "  / ___ \| |_) | |_) | |_) | (_) | (_| | | | (_| |"
    echo " /_/   \_\ .__/| .__/|____/ \___/ \__,_|_|  \__,_|"
    echo "         |_|   |_|"
    echo -e "${NC}"
    echo -e "${YELLOW}        Backend Tools${NC}"
    echo ""
}

print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

# --- Config management ---

get_web_path() {
    if [[ -f "$CONFIG_FILE" ]]; then
        local path
        path=$(grep -o '"webPath"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" | sed 's/.*"webPath"[[:space:]]*:[[:space:]]*"\(.*\)"/\1/')
        if [[ -n "$path" && -d "$path" ]]; then
            echo "$path"
            return 0
        fi
    fi
    return 1
}

setup_web_path() {
    echo ""
    echo -e "${YELLOW}Admin panel path not configured.${NC}"
    echo -e "Enter the full path to the appboard_web repository:"
    echo ""
    echo -e "  Path: \c"
    read -r web_path

    # Expand ~ to home directory
    web_path="${web_path/#\~/$HOME}"

    if [[ ! -d "$web_path" ]]; then
        echo -e "${RED}Directory not found: $web_path${NC}"
        echo "Press Enter to continue..."
        read -r
        return 1
    fi

    if [[ ! -f "$web_path/package.json" ]]; then
        echo -e "${RED}No package.json found in: $web_path${NC}"
        echo -e "${RED}Are you sure this is a Next.js project?${NC}"
        echo "Press Enter to continue..."
        read -r
        return 1
    fi

    # Save config
    cat > "$CONFIG_FILE" << EOF
{
	"webPath": "$web_path"
}
EOF

    echo -e "${GREEN}Saved! Panel path: $web_path${NC}"
    echo ""
    return 0
}

# --- Process management (safe - no killing other processes) ---

cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down...${NC}"
    if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill "$BACKEND_PID" 2>/dev/null
        wait "$BACKEND_PID" 2>/dev/null
        echo -e "${GREEN}  Backend stopped${NC}"
    fi
    if [[ -n "$PANEL_PID" ]] && kill -0 "$PANEL_PID" 2>/dev/null; then
        kill "$PANEL_PID" 2>/dev/null
        wait "$PANEL_PID" 2>/dev/null
        echo -e "${GREEN}  Panel stopped${NC}"
    fi
    echo -e "${GREEN}Done.${NC}"
    exit 0
}

check_port() {
    local port=$1
    local name=$2
    if lsof -i :"$port" -sTCP:LISTEN &>/dev/null; then
        echo -e "${RED}Port $port is already in use ($name).${NC}"
        echo -e "${YELLOW}Something else is running on that port. Stop it first or choose a different option.${NC}"
        return 1
    fi
    return 0
}

start_backend_only() {
    if ! check_port "$BACKEND_PORT" "backend"; then
        echo "Press Enter to continue..."
        read -r
        return
    fi

    echo -e "${CYAN}Starting backend on port $BACKEND_PORT...${NC}"
    echo ""
    cd "$SCRIPT_DIR" && PORT=$BACKEND_PORT bun run --watch src/index.ts
}

start_panel_only() {
    local web_path
    if ! web_path=$(get_web_path); then
        setup_web_path || return
        web_path=$(get_web_path) || return
    fi

    if ! check_port "$PANEL_PORT" "panel"; then
        echo "Press Enter to continue..."
        read -r
        return
    fi

    echo -e "${MAGENTA}Starting admin panel on port $PANEL_PORT...${NC}"
    echo -e "${MAGENTA}  Path: $web_path${NC}"
    echo ""
    cd "$web_path" && PORT=$PANEL_PORT bun run dev
}

start_all() {
    local web_path
    if ! web_path=$(get_web_path); then
        setup_web_path || return
        web_path=$(get_web_path) || return
    fi

    # Check ports before starting
    local port_ok=true
    if ! check_port "$BACKEND_PORT" "backend"; then port_ok=false; fi
    if ! check_port "$PANEL_PORT" "panel"; then port_ok=false; fi

    if [[ "$port_ok" == "false" ]]; then
        echo ""
        echo "Press Enter to continue..."
        read -r
        return
    fi

    # Trap to clean up both processes on exit
    trap cleanup SIGINT SIGTERM

    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Starting AppBoard                     ${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "  ${CYAN}Backend:${NC}     http://localhost:$BACKEND_PORT"
    echo -e "  ${MAGENTA}Panel:${NC}       http://localhost:$PANEL_PORT"
    echo ""

    # Start backend in background
    echo -e "${CYAN}[backend]${NC} Starting..."
    cd "$SCRIPT_DIR" && PORT=$BACKEND_PORT bun run --watch src/index.ts 2>&1 | sed "s/^/$(printf "${CYAN}[backend]${NC} ")/" &
    BACKEND_PID=$!

    # Small delay so backend logs don't mix with panel startup
    sleep 1

    # Start panel in background
    echo -e "${MAGENTA}[panel]${NC}   Starting..."
    cd "$web_path" && PORT=$PANEL_PORT bun run dev 2>&1 | sed "s/^/$(printf "${MAGENTA}[panel]${NC}   ")/" &
    PANEL_PID=$!

    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop both services${NC}"
    echo ""

    # Wait for either to exit
    wait -n "$BACKEND_PID" "$PANEL_PID" 2>/dev/null
    cleanup
}

# --- Menus ---

main_menu() {
    while true; do
        clear
        print_logo
        print_header "Main Menu"

        echo "  1. Start All (backend + panel)"
        echo "  2. Start Backend only"
        echo "  3. Start Panel only"
        echo "  4. Database"
        echo "  5. Code Quality"
        echo "  6. Configure panel path"
        echo "  7. Exit"
        echo ""

        # Show current config
        local web_path
        if web_path=$(get_web_path); then
            echo -e "  ${BLUE}Backend:${NC} $SCRIPT_DIR"
            echo -e "  ${BLUE}Panel:${NC}   $web_path"
        else
            echo -e "  ${YELLOW}Panel path: not configured (option 6)${NC}"
        fi
        echo ""
        echo -e "Select option: \c"
        read -r choice

        case $choice in
            1) start_all ;;
            2) start_backend_only ;;
            3) start_panel_only ;;
            4) database_menu ;;
            5) quality_menu ;;
            6) setup_web_path ;;
            7)
                echo ""
                echo -e "${GREEN}Goodbye!${NC}"
                exit 0
                ;;
            *)
                echo -e "${RED}Invalid option${NC}"
                sleep 1
                ;;
        esac
    done
}

database_menu() {
    while true; do
        clear
        print_header "Database"

        echo "  1. Start PostgreSQL (docker compose up)"
        echo "  2. Stop PostgreSQL (docker compose down)"
        echo "  3. Generate migrations (bun run db:generate)"
        echo "  4. View database status"
        echo "  5. Reset database (nuke & fresh)"
        echo "  6. Connect to psql"
        echo "  7. Back to main menu"
        echo ""
        echo -e "Select option: \c"
        read -r choice

        local DB_URL="postgresql://appboard:appboard@localhost:5441/appboard"

        case $choice in
            1)
                echo ""
                cd "$SCRIPT_DIR" && docker compose up -d postgres
                echo ""
                echo -e "${GREEN}PostgreSQL started on port 5441${NC}"
                echo "Press Enter to continue..."
                read -r
                ;;
            2)
                echo ""
                cd "$SCRIPT_DIR" && docker compose down
                echo ""
                echo -e "${GREEN}PostgreSQL stopped${NC}"
                echo "Press Enter to continue..."
                read -r
                ;;
            3)
                echo ""
                cd "$SCRIPT_DIR" && bun run db:generate
                echo ""
                echo "Press Enter to continue..."
                read -r
                ;;
            4)
                echo ""
                echo -e "${CYAN}Container status:${NC}"
                docker ps --filter "name=AppBoardPostgres" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "No container found"
                echo ""
                echo -e "${CYAN}Database connection test:${NC}"
                if psql "$DB_URL" -c "SELECT 1;" &>/dev/null; then
                    echo -e "${GREEN}Connected successfully${NC}"
                    echo ""
                    echo "Tables:"
                    psql "$DB_URL" -c "\dt" 2>/dev/null || echo "No tables yet"
                else
                    echo -e "${RED}Cannot connect to database${NC}"
                fi
                echo ""
                echo "Press Enter to continue..."
                read -r
                ;;
            5)
                echo ""
                echo -e "${RED}WARNING: This will DELETE all data and recreate the database!${NC}"
                echo ""
                echo -e "Type 'yes' to confirm: \c"
                read -r CONFIRM

                if [[ "$CONFIRM" != "yes" ]]; then
                    echo "Aborted."
                    sleep 1
                    continue
                fi

                echo ""
                echo -e "${YELLOW}[1/4] Stopping containers & removing volumes...${NC}"
                cd "$SCRIPT_DIR" && docker compose down -v 2>/dev/null || true
                echo -e "${GREEN}  Done${NC}"

                echo -e "${YELLOW}[2/4] Starting fresh containers...${NC}"
                cd "$SCRIPT_DIR" && docker compose up -d postgres
                echo -e "${GREEN}  Done${NC}"

                echo -e "${YELLOW}[3/4] Waiting for database...${NC}"
                local RETRIES=30
                local COUNT=0
                until psql "$DB_URL" -c "SELECT 1;" &>/dev/null; do
                    COUNT=$((COUNT+1))
                    if [[ $COUNT -ge $RETRIES ]]; then
                        echo -e "${RED}  Database did not become ready in time${NC}"
                        echo "Press Enter to continue..."
                        read -r
                        continue 2
                    fi
                    echo -n "."
                    sleep 1
                done
                echo ""
                echo -e "${GREEN}  Database is ready${NC}"

                echo -e "${YELLOW}[4/4] Running dev server to apply migrations...${NC}"
                echo "  Start the dev server (option 2) to apply migrations automatically."
                echo ""
                echo -e "${GREEN}========================================${NC}"
                echo -e "${GREEN}  Database reset complete!${NC}"
                echo -e "${GREEN}========================================${NC}"
                echo ""
                echo "Press Enter to continue..."
                read -r
                ;;
            6)
                echo ""
                echo -e "${CYAN}Connecting to AppBoard database...${NC}"
                psql "$DB_URL" || echo -e "${RED}Could not connect. Is PostgreSQL running?${NC}"
                echo ""
                echo "Press Enter to continue..."
                read -r
                ;;
            7) return 0 ;;
            *)
                echo -e "${RED}Invalid option${NC}"
                sleep 1
                ;;
        esac
    done
}

quality_menu() {
    while true; do
        clear
        print_header "Code Quality"

        echo "  1. Check all (biome check)"
        echo "  2. Fix all issues (biome check --write)"
        echo "  3. Format only (biome format --write)"
        echo "  4. Lint only (biome lint)"
        echo "  5. TypeScript check (tsc --noEmit)"
        echo "  6. Run tests (bun test)"
        echo "  7. Back to main menu"
        echo ""
        echo -e "Select option: \c"
        read -r choice

        case $choice in
            1)
                echo ""
                cd "$SCRIPT_DIR" && bunx biome check
                echo ""
                echo "Press Enter to continue..."
                read -r
                ;;
            2)
                echo ""
                cd "$SCRIPT_DIR" && bunx biome check --write
                echo ""
                echo -e "${GREEN}Issues fixed${NC}"
                echo "Press Enter to continue..."
                read -r
                ;;
            3)
                echo ""
                cd "$SCRIPT_DIR" && bunx biome format --write
                echo ""
                echo -e "${GREEN}Formatting complete${NC}"
                echo "Press Enter to continue..."
                read -r
                ;;
            4)
                echo ""
                cd "$SCRIPT_DIR" && bunx biome lint
                echo ""
                echo "Press Enter to continue..."
                read -r
                ;;
            5)
                echo ""
                cd "$SCRIPT_DIR" && bunx tsc --noEmit
                echo ""
                echo -e "${GREEN}TypeScript check complete${NC}"
                echo "Press Enter to continue..."
                read -r
                ;;
            6)
                echo ""
                cd "$SCRIPT_DIR" && bun test
                echo ""
                echo "Press Enter to continue..."
                read -r
                ;;
            7) return 0 ;;
            *)
                echo -e "${RED}Invalid option${NC}"
                sleep 1
                ;;
        esac
    done
}

# Run main menu
main_menu
