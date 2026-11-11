import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import { nextCookies } from "better-auth/next-js";
import { PostgresDialect } from "kysely";
import { pool } from "@/lib/db";

// Better Auth stores users, sessions, accounts, and verification records in PostgreSQL.
export const auth = betterAuth({
    database: new PostgresDialect({ pool }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    // Development uses both localhost and the Mac's LAN address for phone testing.
    trustedOrigins: [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://192.168.0.29:3000",
        ...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : []),
    ],
    emailAndPassword: {
        enabled: true,
        // Accounts are created by a trusted CLI flow, not by public registration.
        disableSignUp: process.env.BETTER_AUTH_ALLOW_SIGNUP !== "true",
    },
    plugins: [
        admin({
            defaultRole: "user",
            adminRoles: ["admin"],
        }),
        nextCookies(),
    ],
});
