"use client";

import { Space, Spin, Typography } from "antd";
import { AiVideoListTabs } from "@/components/ai-video/AiVideoListTabs";
import { AiVideoTableStyles } from "@/components/ai-video/AiVideoTableStyles";
import { GenerationFormSection } from "@/components/ai-video/GenerationFormSection";
import { GeneratePromptModal } from "@/components/ai-video/GeneratePromptModal";
import { GroupAssignModal } from "@/components/ai-video/GroupAssignModal";
import { PreviewModals } from "@/components/ai-video/PreviewModals";
import { useAiVideoPage } from "@/lib/ai-video/hooks/useAiVideoPage";
import { pageWrapStyle } from "@/lib/ai-video/styles";

export default function AiVideoPage() {
  const vm = useAiVideoPage();

  return (
    <div style={pageWrapStyle}>
      <AiVideoTableStyles />

      {!vm.pageReady ? (
        <div
          style={{
            width: "100%",
            minHeight: 560,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Spin size="large" description="加载中..." />
        </div>
      ) : (
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <div>
            <Typography.Title level={3} style={{ margin: 0, fontSize: 18 }}>
              AI 视频生成
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              接入火山 Seedance 模型；支持 MiniMax + seedance skill 生成提示词，生成片段后可组合成片
            </Typography.Text>
          </div>

          <GenerationFormSection
            mode={vm.mode}
            setMode={vm.setMode}
            model={vm.model}
            setModel={vm.setModel}
            modelOptions={vm.modelOptions}
            selectedModel={vm.selectedModel}
            hasServerApiKey={vm.hasServerApiKey}
            prompt={vm.prompt}
            promptTextAreaRef={vm.promptTextAreaRef}
            resourcePickerOpen={vm.resourcePickerOpen}
            resourcePickerActiveIndex={vm.resourcePickerActiveIndex}
            setResourcePickerActiveIndex={vm.setResourcePickerActiveIndex}
            setResourcePickerOpen={vm.setResourcePickerOpen}
            referenceResources={vm.referenceResources}
            draggingReferenceId={vm.draggingReferenceId}
            dragOverReferenceId={vm.dragOverReferenceId}
            onPromptChange={vm.handlePromptChange}
            onPromptKeyDown={vm.handlePromptKeyDown}
            onPromptBlur={vm.handlePromptBlur}
            onInsertReferenceTokenAtPrompt={vm.insertReferenceTokenAtPrompt}
            onInsertReferenceToken={vm.insertReferenceToken}
            onReferenceDragStart={vm.handleReferenceReorderDragStart}
            onReferenceDragOver={vm.handleReferenceReorderDragOver}
            onReferenceDragLeave={vm.handleReferenceReorderDragLeave}
            onReferenceDrop={vm.handleReferenceReorderDrop}
            onReferenceDragEnd={vm.handleReferenceReorderDragEnd}
            onRemoveReferenceResource={vm.removeReferenceResource}
            referenceUploadProps={vm.referenceUploadProps}
            uploadingReference={vm.uploadingReference}
            firstFrameUrl={vm.firstFrameUrl}
            lastFrameUrl={vm.lastFrameUrl}
            firstFrameFiles={vm.firstFrameFiles}
            lastFrameFiles={vm.lastFrameFiles}
            setFirstFrameFiles={vm.setFirstFrameFiles}
            setFirstFrameUrl={vm.setFirstFrameUrl}
            setLastFrameFiles={vm.setLastFrameFiles}
            setLastFrameUrl={vm.setLastFrameUrl}
            buildFrameUploadProps={vm.buildFrameUploadProps}
            clearFrameUpload={vm.clearFrameUpload}
            ratio={vm.ratio}
            setRatio={vm.setRatio}
            resolution={vm.resolution}
            setResolution={vm.setResolution}
            duration={vm.duration}
            setDuration={vm.setDuration}
            durationConfig={vm.durationConfig}
            generateAudio={vm.generateAudio}
            setGenerateAudio={vm.setGenerateAudio}
            watermark={vm.watermark}
            setWatermark={vm.setWatermark}
            seed={vm.seed}
            setSeed={vm.setSeed}
            showCallbackUrl={vm.showCallbackUrl}
            callbackUrl={vm.callbackUrl}
            setCallbackUrl={vm.setCallbackUrl}
            submitting={vm.submitting}
            onSubmitTask={() => void vm.submitTask()}
            onOpenGeneratePrompt={vm.openGeneratePromptModal}
            dragActive={vm.dragActive}
            onFrameDragEnter={vm.handleFrameDragEnter}
            onFrameDragLeave={vm.handleFrameDragLeave}
            onFrameDragOver={vm.handleFrameDragOver}
            onReferenceDropOverlay={vm.handleReferenceDrop}
            onFrameDrop={vm.handleFrameDrop}
          />

          <AiVideoListTabs
            listTab={vm.listTab}
            setListTab={vm.setListTab}
            clips={vm.clips}
            clipsHydrated={vm.clipsHydrated}
            clipColumns={vm.clipColumns}
            selectedClipIds={vm.selectedClipIds}
            onClipSelectionChange={vm.handleClipSelectionChange}
            selectedClips={vm.selectedClips}
            selectedDuration={vm.selectedDuration}
            assigningGroup={vm.assigningGroup}
            onOpenGroupAssignModal={vm.openGroupAssignModal}
            onClearSelectedComposeGroups={vm.clearSelectedComposeGroups}
            clipUploadProps={vm.clipUploadProps}
            uploadingClip={vm.uploadingClip}
            onOpenComposeModal={() => vm.setComposeModalOpen(true)}
            composedFilms={vm.composedFilms}
            filmsHydrated={vm.filmsHydrated}
            filmColumns={vm.filmColumns}
            composeModalOpen={vm.composeModalOpen}
            onCloseComposeModal={() => vm.setComposeModalOpen(false)}
            composing={vm.composing}
            onComposeSubmit={vm.handleComposeSubmit}
          />
        </Space>
      )}

      <GeneratePromptModal
        open={vm.generatePromptOpen}
        loading={vm.generatingPrompt}
        hasMiniMaxApiKey={vm.hasMiniMaxApiKey}
        llmModel={vm.promptLlmModel}
        mode={vm.mode}
        duration={vm.duration}
        ratio={vm.ratio}
        resolution={vm.resolution}
        referenceResources={vm.referenceResources}
        existingPrompt={vm.prompt}
        versions={vm.promptVersions}
        onCancel={() => vm.setGeneratePromptOpen(false)}
        onGenerate={vm.handleGeneratePrompt}
        onApply={vm.applyGeneratedPrompt}
      />

      <GroupAssignModal
        open={vm.groupAssignOpen}
        assigningGroup={vm.assigningGroup}
        selectedClips={vm.selectedClips}
        groupAssignName={vm.groupAssignName}
        composeGroupOptions={vm.composeGroupOptions}
        onCancel={() => vm.setGroupAssignOpen(false)}
        onGroupAssignNameChange={vm.setGroupAssignName}
        onConfirm={vm.handleGroupAssignConfirm}
      />

      <PreviewModals
        previewFilm={vm.previewFilm}
        previewClip={vm.previewClip}
        materialPreview={vm.materialPreview}
        onCloseFilm={() => vm.setPreviewFilm(null)}
        onCloseClip={() => vm.setPreviewClip(null)}
        onCloseMaterial={() => vm.setMaterialPreview(null)}
        onMaterialPreviewPrev={vm.handleMaterialPreviewPrev}
        onMaterialPreviewNext={vm.handleMaterialPreviewNext}
      />
    </div>
  );
}
