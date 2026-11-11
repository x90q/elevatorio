import { Pool } from "pg";

// Reuse a connection pool for all API requests instead of opening a new database connection each time.
// Environment configuration can override the local Docker development database.
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://elevator_user:elevator_password@localhost:5432/elevator_dev";

// Shared pool used by server-side API handlers.
export const pool = new Pool({ connectionString: databaseUrl });