#!/bin/sh
#at some point I need to plug in logic to query consul rather than just waiting
sleep 45
node node_modules/node-red/red.js --userDir /data --settings /home/node-red/settings.js -v
