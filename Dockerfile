# Build the static site, then serve it from nginx.
#
# SAM is entirely static once built -- the world is generated in the browser --
# so there is no server to run. This image is just a web server with the built
# files in it.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
