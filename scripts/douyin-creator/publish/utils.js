const path = require("path");

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      i += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}
const { saveDebugArtifacts, saveRunFailedArtifacts } = require("./debug");
const { waitVisible, setTextLikeInput } = require("./dom");
const { fillTitleAndDescription } = require("./editor");
const { selectSelfDeclaration, setScheduleIfNeeded } = require("./publish-form");
const {
  scaledMs,
  waitForPageSettled,
  calibrateNetworkSpeed,
  getCalibratedMultiplier,
  ensureLoggedIn,
  closeCreatorGuides,
  scrollPublishFormToBottom,
  optimizePublishPageForViewing,
  clickPublishButton,
  isPublishSmsVerificationVisible,
  handlePublishSmsVerification,
  checkPublishSmsVerificationCompleted,
  checkPublishSubmitted,
  checkVideoUploaded,
  checkImagesUploaded,
  checkCoverSelected,
  checkTitleFilled,
  checkBodyFilled,
  checkHashtagsSet,
  checkScheduleSet,
  checkProductLinkSet,
  checkProductLinkAbsent,
  checkSelfDeclarationSet,
  checkMusicSelected,
} = require("./runtime");
const { normalizeDescriptionForPublish, splitDescription } = require("./editor");
const { createPublishStepRunner, shouldSaveStepDebug } = require("./step-runner");

const MAX_HASHTAGS = 5;

const MATERIALS_DIR = path.resolve(
  process.env.CREATOR_MATERIALS_DIR ||
    path.join(process.cwd(), "storage/creator-materials")
);
const ARTICLE_POST_URL =
  "https://creator.douyin.com/creator-micro/content/post/image?default-tab=3&enter_from=publish_page&media_type=image&type=new";
const VIDEO_POST_URL =
  "https://creator.douyin.com/creator-micro/content/post/video";

module.exports = {
  MATERIALS_DIR,
  ARTICLE_POST_URL,
  VIDEO_POST_URL,
  parseArgs,
  saveDebugArtifacts,
  saveRunFailedArtifacts,
  waitVisible,
  setTextLikeInput,
  fillTitleAndDescription,
  selectSelfDeclaration,
  setScheduleIfNeeded,
  scaledMs,
  waitForPageSettled,
  calibrateNetworkSpeed,
  getCalibratedMultiplier,
  ensureLoggedIn,
  closeCreatorGuides,
  scrollPublishFormToBottom,
  optimizePublishPageForViewing,
  clickPublishButton,
  isPublishSmsVerificationVisible,
  handlePublishSmsVerification,
  checkPublishSmsVerificationCompleted,
  checkPublishSubmitted,
  checkVideoUploaded,
  checkImagesUploaded,
  checkCoverSelected,
  checkTitleFilled,
  checkBodyFilled,
  checkHashtagsSet,
  checkScheduleSet,
  checkProductLinkSet,
  checkProductLinkAbsent,
  checkSelfDeclarationSet,
  checkMusicSelected,
  normalizeDescriptionForPublish,
  splitDescription,
  createPublishStepRunner,
  shouldSaveStepDebug,
  MAX_HASHTAGS,
};
