#!/bin/bash
cd /Users/javier/.openclaw/workspace/nightscout-meal-photos/uploads
API_KEY="6d207e02198a847aa98d0a2a901485a5"

declare -A url_map

upload_file() {
  local file=$1
  echo "Uploading $file..."
  local url=$(curl -s -X POST \
    -F "key=$API_KEY" \
    -F "source=@$file" \
    -F "format=json" \
    https://freeimage.host/api/1/upload | jq -r '.image.url')
  echo "  → $url"
  url_map["$file"]="$url"
  sleep 0.5
}

upload_file "7c08586f-286c-4da4-8018-f2a66b64abf7.jpg"
upload_file "d5afb3ee-eff2-4281-a355-34796d217b29.jpg"
upload_file "51c8ee3d-fed3-43f8-b00f-50439dd4bac6.jpg"
upload_file "d60c1ebe-cefb-4490-b75c-27ea3a294930.jpg"
upload_file "30d718c6-0d35-4c9d-8e0e-f6bcb56f28cb.jpg"
upload_file "35cdbb5c-b5a0-4553-893e-a476afc4d19e.jpg"
upload_file "28205df3-226e-4852-8b8e-8e6f9e461ed4.jpg"
upload_file "f53060b2-14d1-4466-919f-1d6cbaf359ec.jpg"
upload_file "d6b3cf3a-ae1f-4836-b3f3-73ecd6a89ee2.jpg"
upload_file "70e1c2c7-082b-486f-b6f0-99d2bae19f52.jpg"

echo ""
echo "URL Mapping:"
for key in "${!url_map[@]}"; do
  echo "  $key → ${url_map[$key]}"
done
