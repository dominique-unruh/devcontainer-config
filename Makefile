.PHONY: build

build: node_modules
	npm run build

node_modules: package.json package-lock.json
	npm install
	@touch node_modules
