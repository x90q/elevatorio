"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import Navbar from "@/components/layout/Navbar";

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    // Send the form to Better Auth, then return the user to the protected area.
    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setIsLoading(true);

        try {
            const result = await authClient.signIn.email({ email, password });

            if (result.error) {
                setError(result.error.status === 401 ? "Invalid email or password" : "Unable to sign in. Check your connection and try again.");
                return;
            }

            setIsLoading(false);
            router.replace("/world");
            router.refresh();
        } catch {
            // Show a normal form error instead of leaving the button loading forever.
            setError("Unable to sign in. Check your connection and try again.");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="min-h-screen bg-emerald-100/10 pt-16 text-slate-950">
            <Navbar />
            <main className="flex items-center justify-center bg-[linear-gradient(to_right,rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.04)_1px,transparent_1px)] bg-size-[32px_32px] px-6 py-16 text-slate-950">
                <section className="w-full max-w-md border border-slate-200 bg-white p-8 shadow-2xl rounded-lg">
                    <Link href="/" className="text-sm font-bold uppercase tracking-[0.25em] text-emerald-600">
                        Elevatorio
                    </Link>
                    <h1 className="mt-8 text-3xl font-bold tracking-tight">Log in</h1>
                    <p className="mt-2 text-sm text-slate-500">Log in to enter the building.</p>

                    <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
                        <label className="block text-sm font-medium">
                            Email
                            <input
                                required
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                className="rounded-lg mt-2 w-full border border-slate-300 px-3 py-3 outline-none focus:border-emerald-600"
                            />
                        </label>

                        <label className="block text-sm font-medium">
                            Password
                            <input
                                required
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                className="rounded-lg mt-2 w-full border border-slate-300 px-3 py-3 outline-none focus:border-emerald-600"
                            />
                        </label>

                        {error && <p className="text-sm text-red-600">{error}</p>}

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="rounded-lg w-full bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isLoading ? "Signing in..." : "Log in"}
                        </button>
                    </form>
                </section>
            </main>
        </div>
    );
}