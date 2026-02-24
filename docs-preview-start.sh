#!/bin/bash
# docs-preview-start.sh

# Stop any existing Jekyll container
./docs-preview-stop.sh 2>/dev/null

echo "🚀 Starting Jekyll Documentation Preview..."
sudo docker run -d --rm \
  --name pluralmatrix-docs-preview \
  --volume="$PWD:/srv/jekyll" \
  -p 4000:4000 \
  jekyll/jekyll:4.2.0 \
  jekyll serve --force_polling --livereload

echo "⏳ Waiting for Jekyll to build (this can take a minute)..."
echo "URL: http://localhost:4000"
echo "Logs: sudo docker logs pluralmatrix-docs-preview"
