# MUST stack shortcuts.
.DEFAULT_GOAL := help
.PHONY: help up down logs build restart ps

help: ## Show targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

up: ## Build and start the stack
	docker compose up -d --build

down: ## Stop the stack
	docker compose down

restart: ## Restart the backend
	docker compose restart titiler-xarray

build: ## Build images without starting
	docker compose build

logs: ## Follow logs
	docker compose logs -f

ps: ## Show service status
	docker compose ps
