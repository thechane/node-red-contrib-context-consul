FROM node:10-alpine
RUN mkdir -p /home/node-red && mkdir /data
WORKDIR /home/node-red
RUN apk update && apk add --purge python make g++ curl && \
  npm uninstall --verbose --unsafe-perm --global --save bcrypt && \
  npm install --verbose --unsafe-perm --build-from-source --global bcrypt && \
  apk del --purge python make g++
RUN adduser -H -D -h /home/node-red node-red && \
  chown -R node-red:node-red /data /home/node-red && \
  chmod g+s /home/node-red
USER node-red
RUN npm install --verbose --unsafe-perm node-red node-red-contrib-context-consul
COPY --chown=node-red:node-red ./settings.js /home/node-red/
COPY --chown=node-red:node-red ./flows.json /home/node-red/
COPY --chown=node-red:node-red ./startup.sh /home/node-red/
EXPOSE 1880
CMD ["/home/node-red/startup.sh"]
