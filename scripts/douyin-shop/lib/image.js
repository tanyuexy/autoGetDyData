const Jimp = require("jimp");

/**
 * 一维滑动平均，弱化噪点、避免单列随机尖峰误判为缺口。
 */
function smooth1d(arr, windowSize) {
  const w = Math.max(1, Math.floor(windowSize));
  const half = Math.floor(w / 2);
  const out = new Array(arr.length).fill(0);
  for (let i = 0; i < arr.length; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j += 1) {
      if (j >= 0 && j < arr.length) {
        sum += arr[j];
        count += 1;
      }
    }
    out[i] = count ? sum / count : 0;
  }
  return out;
}

/**
 * 在列能量曲线上取局部极大值（带平顶：允许 energy[x]===energy[x+1] 仍算峰顶）。
 */
function localMaximaIndices(energy, minX, maxX) {
  const peaks = [];
  for (let x = minX + 1; x < maxX - 1; x += 1) {
    const v = energy[x];
    if (v < energy[x - 1]) continue;
    if (v < energy[x + 1]) continue;
    peaks.push(x);
  }
  return peaks;
}

/**
 * 按分数从高到低做非极大抑制，避免相邻 10~20px 的重复峰。
 */
function pickCandidatesFromPeaks(peaks, energy, minSep) {
  const items = peaks
    .map((x) => ({ x, score: energy[x] || 0 }))
    .sort((a, b) => b.score - a.score);
  const picked = [];
  for (const item of items) {
    if (picked.some((p) => Math.abs(p.x - item.x) < minSep)) continue;
    picked.push(item);
    if (picked.length >= 8) break;
  }
  return picked;
}

/**
 * 在背景图中定位滑块「缺口」左沿的 x 坐标（像素，与截图 buffer 一致）。
 *
 * 改进点（相对旧版「全局单列能量最大」）：
 * - 只在图像垂直中部 ROI 统计，削弱上下边框/装饰带来的假峰；
 * - 列能量强调水平梯度（竖直割痕处 |dx| 更大）；
 * - 平滑后再取局部极大值 + NMS，得到多个候选，主结果取最高分；
 * - 仍支持 minStartX 跳过左侧拼图块区域。
 *
 * @param {Buffer} bgBuffer
 * @param {object} options
 * @param {number} [options.minStartX]
 * @param {number} [options.minEndPad]
 * @param {number} [options.pieceWidth]
 * @param {number} [options.yMarginRatio] 上下各裁掉比例，默认 0.12
 * @returns {Promise<{ gapX: number, width: number, height: number, candidates: { x: number, score: number }[] }>}
 */
async function detectGapX(bgBuffer, options = {}) {
  const image = await Jimp.read(bgBuffer);
  const { width, height } = image.bitmap;

  const minStartX = Math.max(
    options.minStartX || 60,
    options.pieceWidth ? options.pieceWidth + 5 : 0
  );
  const minEndPad = options.minEndPad || 10;
  const yMarginRatio = Math.min(
    0.35,
    Math.max(0.05, options.yMarginRatio ?? 0.12)
  );
  const y0 = Math.floor(height * yMarginRatio);
  const y1 = Math.ceil(height * (1 - yMarginRatio));

  const gray = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const r = image.bitmap.data[idx];
      const g = image.bitmap.data[idx + 1];
      const b = image.bitmap.data[idx + 2];
      gray[y * width + x] = (r * 299 + g * 587 + b * 114) / 1000;
    }
  }

  const columnEnergy = new Array(width).fill(0);
  for (let y = Math.max(1, y0); y < Math.min(height - 1, y1); y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const left = gray[y * width + (x - 1)];
      const right = gray[y * width + (x + 1)];
      const up = gray[(y - 1) * width + x];
      const down = gray[(y + 1) * width + x];
      const dx = right - left;
      const dy = down - up;
      // 缺口竖边以水平梯度为主，加大权重减少背景纹理假峰
      const mag = 2 * Math.abs(dx) + Math.abs(dy);
      columnEnergy[x] += mag;
    }
  }

  const smoothWin = Number.isFinite(options.smoothWindow)
    ? Math.max(3, Math.floor(options.smoothWindow))
    : 7;
  const smoothed = smooth1d(columnEnergy, smoothWin);

  const endX = Math.max(minStartX + 1, width - minEndPad);
  const pieceW = options.pieceWidth || 0;
  const minSep = Math.max(18, Math.min(48, pieceW > 0 ? pieceW - 4 : 24));

  const peaks = localMaximaIndices(smoothed, minStartX, endX);
  let candidates = pickCandidatesFromPeaks(peaks, smoothed, minSep);

  // 若没有局部峰（极少），退回区间最大值
  if (candidates.length === 0) {
    let bestX = minStartX;
    let bestScore = -1;
    for (let x = minStartX; x < endX; x += 1) {
      if (smoothed[x] > bestScore) {
        bestScore = smoothed[x];
        bestX = x;
      }
    }
    candidates = [{ x: bestX, score: bestScore }];
  }

  // 主结果：最高分；若与次高分接近且更靠左，有时真实缺口略偏左，可保留主为最高分（通常仍正确）
  const gapX = candidates[0].x;

  return {
    gapX,
    width,
    height,
    candidates
  };
}

module.exports = { detectGapX };
