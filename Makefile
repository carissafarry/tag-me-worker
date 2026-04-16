.PHONY: help install start dev stop clean test enqueue status

help:
	@echo "Tag Me Worker - Available commands:"
	@echo "  make install   - Install dependencies"
	@echo "  make start   - Start the worker"
	@echo "  make dev     - Start with watch mode"
	@echo "  make stop    - Stop all node processes"
	@echo "  make test   - Run tests"
	@echo "  make enqueue <msg> - Enqueue a test notification"
	@echo "  make status - Check Redis connection"

install:
	npm install

start:
	node index.js

dev:
	node --watch index.js

stop:
	pkill -f "node index.js" || true

test:
	node test.js

enqueue:
ifneq ($(MSG),)
	node enqueue.js "$(MSG)"
else
	node enqueue.js "Test notification"
endif

status:
	@redis-cli -u $(REDIS_URL) ping || echo "Redis not responding"