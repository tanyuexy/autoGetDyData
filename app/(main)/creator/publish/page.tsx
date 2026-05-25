"use client";

import { EditTaskModal } from "@/components/creator-publish/EditTaskModal";
import { MaterialPreviewModal } from "@/components/creator-publish/MaterialPreviewModal";
import { PublishPageTabs } from "@/components/creator-publish/PublishPageTabs";
import { useCreatorPublishPage } from "@/lib/creator-publish/hooks/useCreatorPublishPage";

export default function CreatorPublishPage() {
  const vm = useCreatorPublishPage();

  return (
    <>
      <PublishPageTabs vm={vm} />
      <MaterialPreviewModal
        task={vm.materialPreviewTask}
        onClose={vm.closeMaterialPreview}
        materialPreviewUrl={vm.materialPreviewUrl}
      />
      <EditTaskModal
        editingTask={vm.editingTask}
        editState={vm.editState}
        setEditState={vm.setEditState}
        editAccountSelectOptions={vm.editAccountSelectOptions}
        loadingAccounts={vm.loadingAccounts}
        editScheduleTimeOptions={vm.editScheduleTimeOptions}
        schedulePresets={vm.schedulePresets}
        savingEdit={vm.savingEdit}
        onClose={vm.closeEditTask}
        onSave={() => void vm.handleSaveEditTask()}
      />
    </>
  );
}
