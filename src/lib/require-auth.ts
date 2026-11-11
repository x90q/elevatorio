import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// Read the session from the request cookie on the server.
export async function getCurrentSession(requestHeaders: Headers) {
    return auth.api.getSession({ headers: requestHeaders });
}

// Pages use this helper so anonymous visitors are sent to the login page.
export async function requireUser() {
    const session = await getCurrentSession(await headers());

    if (!session) {
        redirect("/login");
    }

    return session;
}

// The editor is restricted to accounts with the admin role.
export async function requireAdmin() {
    const session = await requireUser();

    if (session.user.role !== "admin") {
        redirect("/");
    }

    return session;
}