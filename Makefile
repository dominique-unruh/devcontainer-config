.PHONY: build install_all

build: node_modules
	npm run build

node_modules: package.json package-lock.json
	npm install
	@touch node_modules

install_all:
	git pull --ff-only
	make build
	make -C claude-split-container install

