FROM node:8

#WORKDIR <enter workdir path>

COPY . .

RUN npm install

EXPOSE 8082 8083
CMD [ "npm", "start" ]
