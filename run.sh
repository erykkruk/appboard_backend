#!/bin/bash

# AppBoard Backend - Main Runner Script
# Usage: ./run.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

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

main_menu() {
    while true; do
        clear
        print_logo
        print_header "Main Menu"

        echo "  1. Database"
        echo "  2. Development"
        echo "  3. Code Quality"
        echo "  4. Exit"
        echo ""
        echo -e "Select option: \c"
        read -r choice

        case $choice in
            1) database_menu ;;
            2) development_menu ;;
            3) quality_menu ;;
            4)
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
                echo "  Start the dev server (option 2.1) to apply migrations automatically."
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

development_menu() {
    while true; do
        clear
        print_header "Development"

        echo "  1. Start dev server (bun run dev)"
        echo "  2. Start all services (docker + dev server)"
        echo "  3. Start Docker services only"
        echo "  4. Back to main menu"
        echo ""
        echo -e "Select option: \c"
        read -r choice

        case $choice in
            1)
                echo ""
                cd "$SCRIPT_DIR" && bun run dev
                ;;
            2)
                echo ""
                echo -e "${CYAN}Starting Docker services...${NC}"
                cd "$SCRIPT_DIR" && docker compose up -d
                echo ""
                echo -e "${CYAN}Waiting for database...${NC}"
                local DB_URL="postgresql://appboard:appboard@localhost:5441/appboard"
                local RETRIES=15
                local COUNT=0
                until psql "$DB_URL" -c "SELECT 1;" &>/dev/null; do
                    COUNT=$((COUNT+1))
                    if [[ $COUNT -ge $RETRIES ]]; then
                        echo -e "${YELLOW}  Database not ready yet, starting dev server anyway...${NC}"
                        break
                    fi
                    echo -n "."
                    sleep 1
                done
                echo ""
                echo -e "${GREEN}Services ready. Starting dev server...${NC}"
                echo ""
                cd "$SCRIPT_DIR" && bun run dev
                ;;
            3)
                echo ""
                cd "$SCRIPT_DIR" && docker compose up -d
                echo ""
                echo -e "${GREEN}Docker services started${NC}"
                echo "Press Enter to continue..."
                read -r
                ;;
            4) return 0 ;;
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
