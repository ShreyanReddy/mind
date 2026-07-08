# Manyam Mind — mind-api service. Plain Node/Express, no build step.
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
EXPOSE 8787

CMD ["npm", "start"]
