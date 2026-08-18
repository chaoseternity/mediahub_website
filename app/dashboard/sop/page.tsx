import { auth } from "@/lib/auth";
import { getAllSOPDocuments, getUserByEmail } from "@/lib/db";
import { SOPManager } from "@/components/SOPManager";
import { redirect } from "next/navigation";

export const metadata = {
  title: "SOP & AI Assistant | MediaHub",
  description: "Standard Operating Procedures knowledge base and AI Assistant powered by Google Gemini",
};

export default async function SOPPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [documents, currentUser] = await Promise.all([
    getAllSOPDocuments(),
    getUserByEmail(session.user.email!),
  ]);

  return (
    <SOPManager
      initialDocuments={documents}
      role={session.user.role}
      userName={currentUser?.name || session.user.name || "User"}
    />
  );
}
