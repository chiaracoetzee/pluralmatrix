#!/bin/bash
# docs-preview-stop.sh

echo "🛑 Stopping Jekyll Documentation Preview..."
sudo docker stop pluralmatrix-docs-preview 2>/dev/null || echo "No preview server running."
