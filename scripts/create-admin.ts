import { createInterface } from "node:readline/promises";

function readHiddenPassword() {
    return new Promise<string>((resolve) => {
        const input = process.stdin;
        let password = "";

        process.stdout.write("Admin password: ");
        input.setRawMode?.(true);
        input.resume();

        function handleInput(chunk: Buffer) {
            for (const character of chunk.toString()) {
                if (character === "\r" || character === "\n") {
                    input.setRawMode?.(false);
                    input.pause();
                    input.removeListener("data", handleInput);
                    process.stdout.write("\n");
                    resolve(password);
                } else if (character === "\u007f") {
                    password = password.slice(0, -1);
                } else {
                    password += character;
                }
            }
        }

        input.on("data", handleInput);
    });
}

async function main() {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const email = (await prompt.question("Admin email: ")).trim();
    prompt.close();
    const password = await readHiddenPassword();

    if (!email || !password) {
        console.error("Email and password are required");
        process.exitCode = 1;
        return;
    }

    // Enable signup only inside this one-time local process.
    process.env.BETTER_AUTH_ALLOW_SIGNUP = "true";

    const [{ auth }, { pool }] = await Promise.all([
        import("../src/lib/auth"),
        import("../src/lib/db"),
    ]);

    try {
        const result = await auth.api.signUpEmail({
            body: {
                name: email.split("@")[0],
                email,
                password,
            },
        });

        await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', ["admin", result.user.id]);
        console.log(`Admin account created for ${result.user.email}`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : "Could not create admin account");
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

void main();
