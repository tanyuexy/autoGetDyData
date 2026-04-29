import AppLayout from "@/components/AppLayout";
import { TaskProvider } from "@/contexts/TaskContext";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TaskProvider>
      <AppLayout>{children}</AppLayout>
    </TaskProvider>
  );
}
