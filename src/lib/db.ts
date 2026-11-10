import { Pool } from "pg";

// Reuse a connection pool for all API requests instead of opening a new database connection each time.
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://elevator_user:elevator_password@localhost:5432/elevator_dev";

export const pool = new Pool({ connectionString: databaseUrl });