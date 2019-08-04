#!/bin/sh
echo "Waiting for consul leader election..."
while ! curl --request GET --url http://consul:8500/v1/status/leader | grep -q :8300; do
 	sleep 1
done
echo "...good to go"
node node_modules/node-red/red.js --userDir /data --settings /home/node-red/settings.js -v
