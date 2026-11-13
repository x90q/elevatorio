# Elevatorio

Elevatorio is a virtual office world built with Next.js. Users can open floors,
move through a 60 x 60 interactive map, inspect rooms and interact with the world.
Administrators can edit floor layouts, place image assets, define rooms and save
the result to PostgreSQL.

## Tech Stack

- Next.js 16 App Router
- React 19 and TypeScript
- Tailwind CSS 4
- Better Auth for email/password authentication and admin roles
- PostgreSQL 16
- Kysely and `pg` for server-side database access
- Docker Compose for the local database

## Getting Started

Requirements:

- Node.js 22+
- npm
- Docker Desktop or Docker Engine

Install dependencies:

```bash
npm install
```

Start the local PostgreSQL database:

```bash
docker compose up -d
```

Check the container:

```bash
docker compose ps
```

Create `.env` in the project root. Minimal local configuration:

```env
DATABASE_URL=postgresql://elevator_user:elevator_password@localhost:5432/elevator_dev
BETTER_AUTH_SECRET=replace-with-a-long-random-secret
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_ALLOW_SIGNUP=false
```

Start the application:

```bash
npm run dev
```

Open:

- public world: [http://localhost:3000/world](http://localhost:3000/world)
- login: [http://localhost:3000/login](http://localhost:3000/login)
- editor: [http://localhost:3000/admin](http://localhost:3000/admin)

Do not commit `.env` to Git. It is already ignored by `.gitignore`.

## Create the First Administrator

Public registration is disabled. Create the first administrator with the local CLI command:

```bash
npm run auth:create-admin
```

The command prompts for an email and password, creates the user, and assigns the `admin`
role. Then sign in through `/login` and open `/admin`.

## Commands

```bash
npm run dev             # development server
npm run lint            # ESLint
npm run build           # production build
npm run start           # start the production build
npm run auth:create-admin
```

Run these checks before submitting changes:

```bash
npm run lint && npm run build
git diff --check
```

## World Architecture

### `WorldViewport`

The public world loads a floor snapshot through:

```text
GET /api/map?floorId=<floor-id>
```

The snapshot contains:

- `blockedCells` — wall and blocked-cell coordinates;
- `placedObjects` — objects and their image data URLs;
- `rooms` — rooms assigned to cells.

After the API responds, the component follows this pipeline:

```text
API data -> React state -> 60 x 60 DOM grid -> image readiness -> ready
```

The loading overlay remains visible for at least one second. The grid is considered
ready only after it has a layout box and its images have finished loading. A failed
image does not block the entire floor.

The camera uses `translate` and `scale`. Fast drag, wheel, and pinch operations use
refs, direct DOM transforms, and `requestAnimationFrame` so 3,600 cells are not
recreated on every frame.

Player movement uses BFS across walkable cells. Changing floors resets the player
position, camera, and zoom. The selected floor is persisted in `localStorage`.

### `WorldEditor`

The admin editor uses the same grid and camera. Available tools:

- `collision` — add or remove a wall;
- `object` — place the selected image;
- `room` — create a room cell with an ID and name;
- `erase` — remove the cell data.

The editor changes React state instead of editing the DOM directly. The `Save map`
button sends the complete snapshot through:

```text
PUT /api/map?floorId=<floor-id>
```

The API stores it in the PostgreSQL `world_maps` table using an upsert.

## Authentication and Access

Better Auth stores users, sessions, and accounts in PostgreSQL.

- public registration is disabled;
- only administrator-created users can sign in;
- `/admin` requires authentication and the `admin` role;
- the map API requires an authenticated session;
- `PUT /api/map` additionally checks the `admin` role.

Use a long random `BETTER_AUTH_SECRET` and never publish `.env`, the PostgreSQL
password, or SSH keys.

## Local Database

Docker Compose creates PostgreSQL with these local settings:

```text
database: elevator_dev
user:     elevator_user
port:     localhost:5432
```

Inside Docker, the database hostname is `postgres`, not `localhost`.

Stop the local database:

```bash
docker compose down
```

Stop the container and delete the local data volume:

```bash
docker compose down -v
```

The last command deletes local PostgreSQL data. Use it only when you intentionally
want to start with a clean database.

## Project Structure

```text
src/app/                         pages and API routes
src/components/world/            public interactive world
src/components/admin/            map editor
src/components/layout/           navbar and shared layout
src/components/chat/             chat
src/components/profile/          user profile
src/lib/auth.ts                  Better Auth configuration
src/lib/db.ts                    PostgreSQL pool
src/lib/floors.ts                floor registry
src/lib/map-types.ts             map snapshot types
src/app/api/map/route.ts         map GET/PUT API
scripts/create-admin.ts          first admin creation
Dockerfile                       application image
docker-compose.yml               local PostgreSQL
```
