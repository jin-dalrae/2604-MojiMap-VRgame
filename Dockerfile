FROM node:20-slim
WORKDIR /app
RUN echo '{"type":"module","private":true}' > package.json && npm install ws
COPY server.js .
EXPOSE 8080
CMD ["node", "server.js"]
