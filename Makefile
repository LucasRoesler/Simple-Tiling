###############################################################################
# Simple-Tiling Extension - Makefile
# Builds TypeScript-based GNOME Shell extension for GNOME 45+
###############################################################################

UUID     := simple-tiling@lucasroesler
VERSION  := 7.2
EXTDIR   := $(HOME)/.local/share/gnome-shell/extensions

# Source and output directories
SRC_DIR  := src
DIST_DIR := dist
BUILD_DIR := $(UUID)

# Files to include in the extension
EXTRA_FILES := README.md LICENSE exceptions.txt
ICON_FILES := icons/tiling-symbolic.svg

.PHONY: all build clean install package typescript

# Default target
all: build

# Build TypeScript
typescript:
	@echo "==> Compiling TypeScript..."
	@npm run build

# Build the extension
build: typescript
	@echo "==> Building extension..."
	@mkdir -p $(BUILD_DIR)
	@mkdir -p $(BUILD_DIR)/icons
	@mkdir -p $(BUILD_DIR)/schemas
	
	# Copy compiled JavaScript from dist
	@cp -r $(DIST_DIR)/* $(BUILD_DIR)/
	
	# Generate metadata.json
	@sed 's/__VERSION__/$(VERSION)/g; s/__UUID__/$(UUID)/g' metadata.json.in > $(BUILD_DIR)/metadata.json
	
	# Copy schema files
	@cp schemas/*.xml $(BUILD_DIR)/schemas/
	@glib-compile-schemas $(BUILD_DIR)/schemas/
	
	# Copy additional files
	@for file in $(EXTRA_FILES); do \
		[ -f $$file ] && cp $$file $(BUILD_DIR)/ || true; \
	done
	
	# Copy icon files
	@for file in $(ICON_FILES); do \
		[ -f $$file ] && cp $$file $(BUILD_DIR)/icons/ || true; \
	done
	
	@echo "✓  Extension built in $(BUILD_DIR)/"

# Create distributable package
package: build
	@echo "==> Creating package..."
	@zip -r $(UUID)-v$(VERSION).zip $(BUILD_DIR)
	@echo "✓  Package created: $(UUID)-v$(VERSION).zip"

# Install the extension
install: build
	@echo "==> Installing extension..."
	@rm -rf $(EXTDIR)/$(UUID)
	@cp -r $(BUILD_DIR) $(EXTDIR)/
	@echo "✓  Extension installed to $(EXTDIR)/$(UUID)"
	@echo ""
	@echo "To enable the extension, run:"
	@echo "  gnome-extensions enable $(UUID)"
	@echo ""
	@echo "Or restart GNOME Shell:"
	@echo "  - X11: Alt+F2, type 'r', press Enter"
	@echo "  - Wayland: Log out and log back in"

# Clean build artifacts
clean:
	@echo "==> Cleaning build artifacts..."
	@rm -rf $(BUILD_DIR) $(DIST_DIR) *.zip
	@echo "✓  Build artifacts removed"

# Development helpers
watch:
	@echo "==> Starting TypeScript watch mode..."
	@npm run watch

lint:
	@echo "==> Running linter..."
	@npm run lint

# Help target
help:
	@echo "Simple-Tiling Extension - Build System"
	@echo ""
	@echo "Available targets:"
	@echo "  make build    - Build the extension"
	@echo "  make package  - Create distributable ZIP"
	@echo "  make install  - Install to local GNOME Shell"
	@echo "  make clean    - Remove build artifacts"
	@echo "  make watch    - Start TypeScript watch mode"
	@echo "  make lint     - Run code linter"
	@echo "  make help     - Show this help message"