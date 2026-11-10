import Navbar from "@/components/layout/Navbar";
import WorldEditor from "@/components/admin/WorldEditor";

// The admin route composes shared navigation with the editable world surface.
export default function AdminPage() {
    return (
        <>
            <Navbar />
            <WorldEditor />
        </>
    );
}