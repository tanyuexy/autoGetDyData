const path = require("path");
const { parseArgs } = require("./parse-args");
const { PUBLISH_DEBUG_DIR, saveDebugArtifacts } = require("./debug");
const { waitVisible, setTextLikeInput } = require("./dom");
const { fillTitleAndDescription } = require("./editor");
const { selectSelfDeclaration, setScheduleIfNeeded } = require("./publish-form");
const {
  ensureLoggedIn,
  closeCreatorGuides,
  scrollPublishFormToBottom,
  optimizePublishPageForViewing,
  clickPublishButton,
} = require("./runtime");

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
  PUBLISH_DEBUG_DIR,
  ARTICLE_POST_URL,
  VIDEO_POST_URL,
  parseArgs,
  saveDebugArtifacts,
  waitVisible,
  setTextLikeInput,
  fillTitleAndDescription,
  selectSelfDeclaration,
  setScheduleIfNeeded,
  ensureLoggedIn,
  closeCreatorGuides,
  scrollPublishFormToBottom,
  optimizePublishPageForViewing,
  clickPublishButton,
};
