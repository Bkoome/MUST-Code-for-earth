# MUST developer shortcuts.

.DEFAULT_GOAL := help
.PHONY: help install dev build start lint typecheck check format clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	yarn install

dev: ## Run the dev server (:3000)
	yarn dev

build: ## Production build
	yarn build

start: ## Serve the production build
	yarn start

typecheck: ## Type-check without emitting
	yarn ts-check

lint: ## Lint
	yarn lint

format: ## Auto-format
	yarn format

check: typecheck lint ## Typecheck + lint

clean: ## Remove build artifacts and caches
	rm -rf .next out tsconfig.tsbuildinfo
