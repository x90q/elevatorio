import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

// Better Auth owns login, logout, session, password, and admin endpoints here.
export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(auth);
