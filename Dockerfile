FROM node:8

WORKDIR /opt/virtuoso-compose

COPY . .

RUN npm install

EXPOSE 8082 8083
CMD [ "npm", "start" ]
