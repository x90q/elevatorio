"use client";

import { createAuthClient } from "better-auth/react";

// The browser uses this client to sign in, sign out, and read the current session.
export const authClient = createAuthClient();