/**
 * 人性化滑块拖动实现。
 * 字节跳动系风控会检测鼠标轨迹是否呈匀速直线；
 * 这里使用"先快后慢 + 轻微抖动 + 过冲再回退"的轨迹模拟。
 */

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * 使用 Playwright 的 page.mouse 把滑块从 (startX, startY) 水平拖到 startX + distance。
 *
 * @param {import('playwright').Page} page
 * @param {{ startX: number, startY: number, distance: number, durationMs?: number }} options
 */
async function humanDrag(page, options) {
  const {
    startX,
    startY,
    distance,
    durationMs = 900
  } = options;

  await page.mouse.move(startX, startY, { steps: 6 });
  await page.mouse.down();

  // 进入拖动前的小停顿
  await page.waitForTimeout(Math.floor(rand(80, 150)));

  // 将目标距离做一点"人类不精确"处理：先过冲 ~3-8 px，再回退修正
  const overshoot = Math.floor(rand(3, 8));
  const firstStageDistance = distance + overshoot;

  const extraByDistance = Math.min(22, Math.floor(Math.abs(distance) / 22));
  const steps = 28 + extraByDistance + Math.floor(rand(0, 10));
  const stepDelay = Math.max(8, Math.floor(durationMs / steps));
  let prevX = startX;

  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const eased = easeOutCubic(progress);
    const targetX = Math.round(startX + firstStageDistance * eased);
    // 垂直方向的小抖动（-2, +2）
    const jitterY = Math.round(rand(-2, 2));
    // 保证 x 单调递增；加一点"不连续"节奏
    if (targetX > prevX) {
      await page.mouse.move(targetX, startY + jitterY, { steps: 1 });
      prevX = targetX;
    }
    // 不规则延迟（节奏）
    const delay = stepDelay + Math.floor(rand(-4, 8));
    await page.waitForTimeout(Math.max(5, delay));
  }

  // 过冲修正：从 startX+distance+overshoot 回退到目标
  await page.waitForTimeout(Math.floor(rand(60, 120)));
  const fineSteps = 3 + Math.floor(rand(0, 3));
  for (let i = 1; i <= fineSteps; i++) {
    const fineX = Math.round(
      startX + firstStageDistance - (overshoot * i) / fineSteps
    );
    await page.mouse.move(fineX, startY + Math.round(rand(-1, 1)), {
      steps: 1
    });
    await page.waitForTimeout(Math.floor(rand(25, 55)));
  }

  // 释放前短暂停留
  await page.waitForTimeout(Math.floor(rand(80, 180)));
  await page.mouse.up();
}

module.exports = { humanDrag };
