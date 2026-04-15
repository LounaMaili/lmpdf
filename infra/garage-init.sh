#!/bin/bash
# Initialize Garage: layout, bucket, and access key
# Run after first `docker compose up` when garage is running
set -euo pipefail

CONTAINER=lmpdf-garage

echo "⏳ Waiting for Garage to be ready..."
sleep 3

echo "📋 Getting node ID..."
NODE_ID=$(docker exec $CONTAINER /garage node id -q 2>/dev/null | cut -c1-64)
echo "   Node: $NODE_ID"

echo "🔧 Configuring layout..."
docker exec $CONTAINER garage layout assign -z dc1 -c 1G "$NODE_ID" 2>/dev/null || true
docker exec $CONTAINER garage layout apply --version 1 2>/dev/null || true

echo "🪣 Creating bucket 'lmpdf'..."
docker exec $CONTAINER garage bucket create lmpdf 2>/dev/null || echo "   (bucket already exists)"

echo "🔑 Creating API key..."
KEY_OUTPUT=$(docker exec $CONTAINER garage key create lmpdf-key 2>/dev/null || docker exec $CONTAINER /garage key info lmpdf-key 2>/dev/null)
echo "$KEY_OUTPUT"

ACCESS_KEY=$(echo "$KEY_OUTPUT" | grep -i "Key ID" | awk '{print $NF}')
SECRET_KEY=$(echo "$KEY_OUTPUT" | grep -i "Secret" | awk '{print $NF}')

echo "🔗 Granting bucket access..."
docker exec $CONTAINER garage bucket allow --read --write --owner lmpdf --key lmpdf-key 2>/dev/null || true

echo ""
echo "✅ Garage initialized!"
echo ""
echo "Add these to your .env:"
echo "  GARAGE_ACCESS_KEY=$ACCESS_KEY"
echo "  GARAGE_SECRET_KEY=$SECRET_KEY"
