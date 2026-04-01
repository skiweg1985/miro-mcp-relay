FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src
COPY .env.example ./
RUN mkdir -p /app/data
EXPOSE 8787
CMD ["npm","start"]
