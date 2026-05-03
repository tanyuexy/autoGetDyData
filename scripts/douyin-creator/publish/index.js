const { parseArgs } = require("./utils");
const { runPublishArticle } = require("./article");
const { runPublishVideo } = require("./video");

module.exports = { parseArgs, runPublishArticle, runPublishVideo };
