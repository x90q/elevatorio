import Navbar from "@/components/layout/Navbar";
import WorldEditor from "@/components/admin/WorldEditor";
import { requireAdmin } from "@/lib/require-auth";

// Session checks need a blocking request instead of an instant static shell.
export const instant = false;

// The admin route composes shared navigation with the editable world surface.
export default async function AdminPage() {
    await requireAdmin();

    return (
        <>
            <Navbar />
            <WorldEditor />
        </>
    );
}