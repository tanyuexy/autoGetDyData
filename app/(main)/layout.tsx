import AppLayout from "@/components/AppLayout";
import { AuthProvider } from "@/contexts/AuthContext";
import { TaskProvider } from "@/contexts/TaskContext";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <TaskProvider>
      <AppLayout>{children}</AppLayout>
    </TaskProvider>
    </AuthProvider>
  );
}
