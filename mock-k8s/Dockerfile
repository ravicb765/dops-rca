# mock-k8s/Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package.json server.js ./
RUN npm install express
EXPOSE 8080
CMD ["node", "server.js"]
