# MUST — developer shortcuts.
# Mock-first: `make install && make mock && make dev` runs the whole UI locally.

.DEFAULT_GOAL := help
.PHONY: help install mock dev build start test smoke lint typecheck check format clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install JS + Python dependencies
	yarn install
	pip install -r backend/requirements.txt

mock: ## (Re)generate the sample exceedance calendar
	python backend/generate_exceedance_mock.py

dev: ## Run FastAPI mock (:8000) + Next.js (:3000)
	./scripts/start_dev_servers.sh

build: ## Production build
	yarn build

start: ## Serve the production build
	yarn start

test: ## Run unit tests
	npx vitest run

smoke: ## Smoke-test the running APIs (needs `make dev` up)
	./scripts/test_api.sh

typecheck: ## Type-check without emitting
	yarn ts-check

lint: ## Lint
	yarn lint

format: ## Auto-format
	yarn format

check: typecheck lint test ## Typecheck + lint + tests

clean: ## Remove build artifacts and caches
	rm -rf .next out coverage tsconfig.tsbuildinfo backend/__pycache__
