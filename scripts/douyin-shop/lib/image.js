const Jimp = require("jimp");

/**
 * 在背景图中定位滑块"缺口"的 x 坐标。
 *
 * 策略：
 * 1) 将图片灰度化，计算每个像素与周围的梯度（简化版 Sobel），
 *    得到"边缘图"；
 * 2) 对每一列累加边缘强度，得到列能量；
 * 3) 典型字节跳动/抖店缺口边缘呈"左亮/右暗→左暗/右亮"的双峰；
 *    取列能量在搜索区间中的最高峰作为缺口左沿；
 * 4) 搜索区间起点跳过滑块 piece 本身所在的左侧区域。
 *
 * @param {Buffer} bgBuffer  背景图像二进制（通常是一张 PNG/JPG）
 * @param {object} options
 * @param {number} [options.minStartX]  允许搜索的最小 x（跳过 piece 起点），默认 60
 * @param {number} [options.minEndPad]  搜索的右侧留白，默认 10
 * @param {number} [options.pieceWidth]  已知 piece 宽度（若提供则 minStartX 覆盖为该值）
 * @returns {Promise<{ gapX: number, width: number, height: number, scores: number[] }>}
 */
async function detectGapX(bgBuffer, options = {}) {
  const image = await Jimp.read(bgBuffer);
  const { width, height } = image.bitmap;

  const minStartX = Math.max(
    options.minStartX || 60,
    options.pieceWidth ? options.pieceWidth + 5 : 0
  );
  const minEndPad = options.minEndPad || 10;

  // 灰度化
  const gray = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = image.bitmap.data[idx];
      const g = image.bitmap.data[idx + 1];
      const b = image.bitmap.data[idx + 2];
      gray[y * width + x] = (r * 299 + g * 587 + b * 114) / 1000;
    }
  }

  // 简化 Sobel：计算水平方向梯度 |I(x+1,y)-I(x-1,y)|
  const columnEnergy = new Array(width).fill(0);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const left = gray[y * width + (x - 1)];
      const right = gray[y * width + (x + 1)];
      const up = gray[(y - 1) * width + x];
      const down = gray[(y + 1) * width + x];
      // 水平 + 垂直梯度平方和
      const dx = right - left;
      const dy = down - up;
      const mag = Math.abs(dx) + Math.abs(dy);
      columnEnergy[x] += mag;
    }
  }

  // 在搜索区间中找峰值
  let gapX = minStartX;
  let bestScore = -1;
  const endX = Math.max(minStartX + 1, width - minEndPad);
  for (let x = minStartX; x < endX; x++) {
    if (columnEnergy[x] > bestScore) {
      bestScore = columnEnergy[x];
      gapX = x;
    }
  }

  return {
    gapX,
    width,
    height,
    scores: columnEnergy
  };
}

module.exports = { detectGapX };
